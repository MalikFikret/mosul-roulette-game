// Per-seat presence and the automatic host takeover, on top of the Realtime Database.
//
// presence/{seatId} = { conns: { [connId]: true }, lastSeenAt: <server time> }. Every running
// startPresence() (one per tab or call) owns one connId, so closing one tab does not make a
// player absent while another tab is still open. The server removes a connection and stamps
// lastSeenAt by itself when the device disconnects (onDisconnect).
//
// The host role moves when the host seat has had no connection for more than 60 s of server
// time. Any present member's browser may make the move (watchHost / tryTakeOverHost); the rules
// only check that the host really has been absent long enough and that the new host is present.
//
// Like api.js, this module never imports Firebase: the functions arrive through createRoomApi.

import { HOST_ABSENCE_MS, chooseNewHost, isHostAbsentLongEnough, isSeatPresent } from './host.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { SEAT_IDS, isSeatId, paths } from './schema.js';

// watchHost fires this long after the 60 s are over, plus a random jitter of up to
// TAKEOVER_JITTER_MS, so that the present browsers do not all write at the same moment.
const TAKEOVER_MARGIN_MS = 1000;
const TAKEOVER_JITTER_MS = 2000;
// When the server still says "too early" (clock skew), watchHost tries again after this delay.
const TAKEOVER_RETRY_MS = 2000;

const CONN_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Random connection id (64 = 2^6 characters, so bytes map without bias).
function defaultConnId() {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += CONN_ID_ALPHABET[byte & 63];
  return id;
}

// Live startPresence() calls per database instance and lastSeenAt path. They share one
// connection, so the lastSeenAt onDisconnect handler is cancelled only by the last one to stop.
const seenHolders = new WeakMap();

// Running startPresence() and watchHost() calls per database instance and room code, so that
// leaveRoom can stop all of them before the seat is deleted (stopLiveFor).
const liveByDb = new WeakMap();

function liveSetFor(db, code) {
  let rooms = liveByDb.get(db);
  if (!rooms) {
    rooms = new Map();
    liveByDb.set(db, rooms);
  }
  let set = rooms.get(code);
  if (!set) {
    set = new Set();
    rooms.set(code, set);
  }
  return set;
}

function forgetLive(db, code, stop) {
  const rooms = liveByDb.get(db);
  const set = rooms?.get(code);
  if (!set) return;
  set.delete(stop);
  if (set.size === 0) rooms.delete(code);
}

function holdersFor(db) {
  let holders = seenHolders.get(db);
  if (!holders) {
    holders = new Map();
    seenHolders.set(db, holders);
  }
  return holders;
}

function reporter(onError) {
  return (error) => {
    if (typeof onError !== 'function') return;
    try {
      onError(error);
    } catch {
      // An error callback must never break a listener.
    }
  };
}

/**
 * Builds the presence and host functions of createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createPresenceFunctions(ctx) {
  const { deps, db, ref, read, writeAll, serverTimestamp, requireUid, requireCode, requireSeat, requireRoom } = ctx;

  // The newer database functions are checked only where they are used, so a caller that
  // passes just the original deps can still create, join and recover.
  function requireDeps(...names) {
    for (const name of names) {
      if (typeof deps[name] !== 'function') {
        throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, `missing function: ${name} (needed for presence and host)`);
      }
    }
  }

  const newConnId = typeof deps.newConnId === 'function' ? deps.newConnId : defaultConnId;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const random = typeof deps.random === 'function' ? deps.random : Math.random;
  const setTimer = typeof deps.setTimeout === 'function' ? deps.setTimeout : (fn, ms) => globalThis.setTimeout(fn, ms);
  const clearTimer = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : (id) => globalThis.clearTimeout(id);

  // Server time offset (server - local), read once from .info/serverTimeOffset.
  function readServerOffset() {
    return new Promise((resolve, reject) => {
      let done = false;
      let unsubscribe = null;
      unsubscribe = deps.onValue(
        ref(db, '.info/serverTimeOffset'),
        (snapshot) => {
          if (done) return;
          done = true;
          resolve(Number(snapshot.val()) || 0);
          if (unsubscribe) unsubscribe();
        },
        (error) => {
          if (done) return;
          done = true;
          reject(error);
        },
      );
      if (done) unsubscribe();
    });
  }

  async function readMembersOnly(path) {
    try {
      return await read(path);
    } catch (error) {
      if (isPermissionDenied(error)) {
        throw new RoomError(ROOM_ERR.NOT_MEMBER, 'only a member of this room can do this', error);
      }
      throw error;
    }
  }

  /**
   * Marks this device present on its seat while it is connected. On every (re)connection it
   * first registers the server-side cleanup (remove its connection, stamp lastSeenAt), then
   * adds its connection. Each call uses its own connection id, so two tabs keep the seat
   * present until both are closed. Errors (for example after the seat was recovered on
   * another device) go to `onError`; they are never thrown from the listener.
   * @param {{ uid: string, code: string, seatId: string, onError?: (error: unknown) => void }} input
   * @returns {() => Promise<void>} stop(): removes this connection, stamps lastSeenAt and stops
   *   listening
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, INVALID_DEPENDENCIES
   */
  function startPresence({ uid, code, seatId, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    requireDeps('onValue', 'onDisconnect');
    const report = reporter(onError);

    const connId = newConnId();
    const connPath = paths.presenceConn(roomCode, seatId, connId);
    const seenPath = paths.presenceSeen(roomCode, seatId);
    const holders = holdersFor(db);
    holders.set(seenPath, (holders.get(seenPath) ?? 0) + 1);

    // Connection events and stop() run one after the other, never interleaved.
    let chain = Promise.resolve();
    const enqueue = (task) => {
      chain = chain.then(task).catch(report);
      return chain;
    };
    let stopped = false;

    const unsubscribe = deps.onValue(
      ref(db, '.info/connected'),
      (snapshot) => {
        if (snapshot.val() !== true) return;
        enqueue(async () => {
          if (stopped) return;
          // Cleanup first: if the device drops right after the next write, the server
          // still removes the connection and marks the seat absent.
          await deps.onDisconnect(ref(db, connPath)).remove();
          await deps.onDisconnect(ref(db, seenPath)).set(serverTimestamp());
          if (stopped) return;
          await writeAll({ [connPath]: true });
        });
      },
      report,
    );

    const live = liveSetFor(db, roomCode);
    function stop() {
      if (stopped) return chain;
      stopped = true;
      forgetLive(db, roomCode, stop);
      unsubscribe();
      const left = (holders.get(seenPath) ?? 1) - 1;
      if (left > 0) holders.set(seenPath, left);
      else holders.delete(seenPath);
      return enqueue(async () => {
        await deps.onDisconnect(ref(db, connPath)).cancel();
        if (left === 0) await deps.onDisconnect(ref(db, seenPath)).cancel();
        await writeAll({ [connPath]: null, [seenPath]: serverTimestamp() });
      });
    }
    live.add(stop);
    return stop;
  }

  // The host decision with an already known server time offset (shared by tryTakeOverHost
  // and watchHost).
  async function takeOver(roomCode, { scores, random: pick = random, offset }) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    const hostSeat = meta.hostSeat;
    const presence = (await readMembersOnly(paths.presence(roomCode))) ?? {};
    const hostEntry = presence[hostSeat];
    if (isSeatPresent(hostEntry)) return { moved: false, hostSeat, reason: 'hostPresent' };

    const joinedAt = await readMembersOnly(paths.seatJoinedAt(roomCode, hostSeat));
    const serverNow = now() + offset;
    if (!isHostAbsentLongEnough(hostEntry, joinedAt, serverNow)) return { moved: false, hostSeat, reason: 'tooEarly' };

    const candidates = SEAT_IDS.filter((seatId) => seatId !== hostSeat && isSeatPresent(presence[seatId]));
    const chosen = chooseNewHost(candidates, { scores, random: pick });
    if (chosen === null) return { moved: false, hostSeat, reason: 'noCandidate' };

    try {
      await writeAll({ [paths.hostSeat(roomCode)]: chosen });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // The host came back, someone else moved the role first, or the clocks disagree.
      const current = await read(paths.hostSeat(roomCode));
      return { moved: false, hostSeat: current, reason: 'refused' };
    }
    return { moved: true, hostSeat: chosen };
  }

  /**
   * Moves the host role if the host seat has been absent for more than 60 s (server time):
   * the new host is chosen with chooseNewHost among the present seats. A refused move (the
   * host came back, or someone else moved the role first) is not an error.
   * @param {{ uid: string, code: string, scores?: Record<string, number>, random?: () => number }} input
   * @returns {Promise<{ moved: boolean, hostSeat: string, reason?: 'hostPresent' | 'tooEarly' | 'noCandidate' | 'refused' }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_MEMBER, INVALID_DEPENDENCIES
   */
  async function tryTakeOverHost({ uid, code, scores, random: pick } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireDeps('onValue');
    const offset = await readServerOffset();
    return takeOver(roomCode, { scores, random: pick ?? random, offset });
  }

  /**
   * Watches the host seat and its presence. When the host becomes absent, schedules
   * tryTakeOverHost for absent-since + 60 s + a margin + a random jitter (server time,
   * through .info/serverTimeOffset); cancels or reschedules when the host returns or the host
   * changes. Never throws from a listener: errors go to `onError`, results to `onResult`.
   * @param {{ uid: string, code: string, scores?: Record<string, number>,
   *   onError?: (error: unknown) => void,
   *   onResult?: (result: { moved: boolean, hostSeat: string, reason?: string }) => void }} input
   * @returns {() => void} stop()
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_DEPENDENCIES
   */
  function watchHost({ uid, code, scores, onError, onResult } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireDeps('onValue');
    const report = reporter(onError);

    let stopped = false;
    let hostSeat = null;
    let presence; // undefined until the first value arrives
    let offset = 0;
    let timer = null;
    let generation = 0;
    const joinedAtCache = new Map();
    const jitterCache = new Map();

    function cancelTimer() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    }

    function jitterFor(key) {
      if (!jitterCache.has(key)) jitterCache.set(key, random() * TAKEOVER_JITTER_MS);
      return jitterCache.get(key);
    }

    async function joinedAtOf(seatId) {
      if (!joinedAtCache.has(seatId)) joinedAtCache.set(seatId, await readMembersOnly(paths.seatJoinedAt(roomCode, seatId)));
      return joinedAtCache.get(seatId);
    }

    function fire() {
      timer = null;
      const mine = generation;
      takeOver(roomCode, { scores, random, offset })
        .then((result) => {
          if (stopped) return;
          try {
            if (typeof onResult === 'function') onResult(result);
          } catch (error) {
            report(error);
          }
          // The server clock is still behind ours: try again shortly.
          if (!result.moved && result.reason === 'tooEarly' && mine === generation) {
            timer = setTimer(fire, TAKEOVER_RETRY_MS);
          }
        })
        .catch(report);
    }

    function evaluate() {
      generation += 1;
      const mine = generation;
      cancelTimer();
      if (stopped || !isSeatId(hostSeat) || presence === undefined) return;
      const entry = presence[hostSeat];
      if (isSeatPresent(entry)) return;
      (async () => {
        let since = entry && typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null;
        if (since === null) since = await joinedAtOf(hostSeat);
        if (stopped || mine !== generation || typeof since !== 'number') return;
        const due = since + HOST_ABSENCE_MS + TAKEOVER_MARGIN_MS + jitterFor(`${hostSeat}@${since}`);
        timer = setTimer(fire, Math.max(0, due - (now() + offset)));
      })().catch(report);
    }

    const unsubscribers = [
      deps.onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => {
        offset = Number(snapshot.val()) || 0;
        evaluate();
      }, report),
      deps.onValue(ref(db, paths.hostSeat(roomCode)), (snapshot) => {
        hostSeat = snapshot.val();
        evaluate();
      }, report),
      deps.onValue(ref(db, paths.presence(roomCode)), (snapshot) => {
        presence = snapshot.val() ?? {};
        evaluate();
      }, report),
    ];

    function stop() {
      if (stopped) return;
      stopped = true;
      forgetLive(db, roomCode, stop);
      cancelTimer();
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch (error) {
          report(error);
        }
      }
    }
    liveSetFor(db, roomCode).add(stop);
    return stop;
  }

  /**
   * Stops every startPresence() and watchHost() running on this database instance for the room:
   * presence connections are removed and their onDisconnect handlers cancelled while the
   * caller is still a member. Used by leaveRoom before the seat is deleted. Errors of the
   * individual stops are not thrown (they went to each call's onError).
   * @param {string} roomCode
   * @returns {Promise<void>}
   */
  async function stopLiveFor(roomCode) {
    const set = liveByDb.get(db)?.get(roomCode);
    if (!set) return;
    await Promise.allSettled([...set].map((stop) => stop()));
  }

  /**
   * The current host hands the role to another occupied seat (used later by leaving the room
   * and by a manual ownership transfer).
   * @param {{ uid: string, code: string, seatId: string }} input the new host seat
   * @returns {Promise<{ hostSeat: string }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_SEAT, ROOM_NOT_FOUND,
   *   WRITE_DENIED (not the host, same seat, or the seat is empty)
   */
  async function handOverHost({ uid, code, seatId } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireSeat(seatId);
    await requireRoom(roomCode);
    try {
      await writeAll({ [paths.hostSeat(roomCode)]: seatId });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can hand the role to another occupied seat', error);
    }
    return { hostSeat: seatId };
  }

  return { startPresence, tryTakeOverHost, watchHost, handOverHost, stopLiveFor };
}
