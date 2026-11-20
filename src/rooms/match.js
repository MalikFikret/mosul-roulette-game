// Matches on top of the Realtime Database: start a match, submit engine actions through a
// transaction, and watch the match as one seat sees it.
//
// rooms/{CODE}/match = { n, seq, stateJson, log: { [seq]: eventsJson } } (see match-helpers.js).
// meta.status is 'lobby' between matches and 'playing' while a match runs.
//
// Each device runs the pure engine itself: it parses stateJson, applies its own action and writes
// the next state. The engine player ids are seat ids, and this module always acts as the caller's
// own seat. The raw state, the raw log and stateJson never leave this module: callers only get
// viewFor(state, mySeat) and the events eventsFor lets that seat see. (The security rules let
// every member read the match node; hiding the other seats' secrets from a modified client is
// not part of this step.)
//
// Like the rest of src/rooms, this module never imports Firebase: the functions come in deps.

import { MAX_PLAYERS, MIN_PLAYERS, applyAction, createMatch, eventsFor, validateConfig, viewFor } from '../engine/index.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { buildPlayers, eventsSince, parseLog, playerIdIn } from './match-helpers.js';
import { LOBBY_STATUS, PLAYING_STATUS, paths } from './schema.js';

// System actions come with task 3.5b (timeouts and removing a player go through the host).
const NOT_YET_ALLOWED = ['timeout', 'removePlayer'];

function defaultRandomSeed() {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
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
 * Builds the match functions of createRoomApi.
 * @param {object} ctx shared helpers from api.js
 */
export function createMatchFunctions(ctx) {
  const { deps, db, ref, read, writeAll, requireUid, requireCode, currentSeat, traffic } = ctx;
  const randomSeed = typeof deps.randomSeed === 'function' ? deps.randomSeed : defaultRandomSeed;

  // The newer database functions are checked only where they are used.
  function requireDeps(...names) {
    for (const name of names) {
      if (typeof deps[name] !== 'function') {
        throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, `missing function: ${name} (needed for matches)`);
      }
    }
  }

  async function readMeta(roomCode) {
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    return meta;
  }

  async function requireOwnSeat(roomCode, uid) {
    const seatId = await currentSeat(roomCode, uid);
    if (seatId === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    return seatId;
  }

  /**
   * The host starts a match between matches. The players are all seated seats (present or
   * absent), sorted by seat id; the settings are checked with the engine's validateConfig. One
   * update sets meta.status to 'playing' and writes match = { n, seq: 0, stateJson, log: { 0 } }.
   * @param {{ uid: string, code: string }} input
   * @returns {Promise<{ n: number, players: string[] }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_IN_LOBBY (a match is
   *   running), NOT_MEMBER, WRITE_DENIED (not the host, or refused), NOT_ENOUGH_PLAYERS (fewer
   *   than 3 seats), INVALID_SETTINGS (validateConfig failed; `details` holds its errors)
   */
  async function startMatch({ uid, code } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await readMeta(roomCode);
    if (meta.status !== LOBBY_STATUS) throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match is already running');
    const mySeat = await requireOwnSeat(roomCode, uid);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can start a match');

    const players = buildPlayers(await read(paths.seats(roomCode)));
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new RoomError(ROOM_ERR.NOT_ENOUGH_PLAYERS, `a match needs ${MIN_PLAYERS} to ${MAX_PLAYERS} seated players`);
    }
    const checked = validateConfig((await read(paths.settings(roomCode))) ?? {});
    if (!checked.ok) {
      const error = new RoomError(ROOM_ERR.INVALID_SETTINGS, 'the room settings are not a valid match config');
      error.details = checked.errors;
      throw error;
    }
    const created = createMatch(checked.config, players, randomSeed());
    if (!created.ok) {
      const error = new RoomError(ROOM_ERR.INVALID_SETTINGS, `the engine refused to start: ${created.error.code}`);
      error.details = [created.error];
      throw error;
    }

    const previousN = await read(paths.matchN(roomCode));
    const n = typeof previousN === 'number' ? previousN + 1 : 1;
    const values = {
      [paths.metaStatus(roomCode)]: PLAYING_STATUS,
      [paths.match(roomCode)]: { n, seq: 0, stateJson: JSON.stringify(created.state), log: { 0: JSON.stringify(created.events) } },
    };
    traffic.addWritten(values);
    try {
      await writeAll(values);
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      const now = await read(paths.meta(roomCode));
      if (now !== null && now.status !== LOBBY_STATUS) {
        throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match was started meanwhile', error);
      }
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused to start the match', error);
    }
    return { n, players: players.map((p) => p.id) };
  }

  /**
   * Submits an engine action as the caller's own seat (any playerId in `action` is replaced).
   * The action is applied in a transaction on the match node, so concurrent submissions are
   * serialised: each attempt runs the engine on the latest state, and the result returned is the
   * one of the final attempt.
   * @param {{ uid: string, code: string, action: { type: string } }} input
   * @returns {Promise<{ ok: true, events: object[] } | { ok: false, error: { code: string, message?: string } }>}
   *   `events`: the events of this action that the caller's seat may see; `error.code`: the
   *   engine's code (e.g. NOT_YOUR_TURN) when the engine refuses the action
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_ACTION, ACTION_NOT_ALLOWED (timeout
   *   and removePlayer are not available yet), ROOM_NOT_FOUND, NO_MATCH, NOT_MEMBER,
   *   WRITE_DENIED, INVALID_DEPENDENCIES
   */
  async function submitAction({ uid, code, action } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    if (action === null || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') {
      throw new RoomError(ROOM_ERR.INVALID_ACTION, 'an action is an object with a string type');
    }
    if (NOT_YET_ALLOWED.includes(action.type)) {
      throw new RoomError(ROOM_ERR.ACTION_NOT_ALLOWED, `${action.type} cannot be submitted by a player`);
    }
    requireDeps('runTransaction');
    const meta = await readMeta(roomCode);
    if (meta.status !== PLAYING_STATUS) throw new RoomError(ROOM_ERR.NO_MATCH, 'no match is running in this room');
    const mySeat = await requireOwnSeat(roomCode, uid);
    const move = { ...action, playerId: mySeat };

    // The outcome of the latest attempt of the update function (it may run several times).
    let outcome = null;
    const updateMatch = (current) => {
      // Without a cached value the SDK first calls with null; returning it unchanged makes the
      // server answer with the real value and the SDK call again.
      if (current === null) {
        outcome = null;
        return null;
      }
      let state;
      try {
        state = JSON.parse(current.stateJson);
      } catch {
        outcome = { ok: false, error: { code: 'INVALID_STATE', message: 'the stored match state is unreadable' } };
        return undefined;
      }
      const result = applyAction(state, move);
      if (!result.ok) {
        outcome = { ok: false, error: result.error };
        return undefined; // abort: nothing is written
      }
      const seq = current.seq + 1;
      const next = {
        n: current.n,
        seq,
        stateJson: JSON.stringify(result.state),
        log: { ...(current.log ?? {}), [seq]: JSON.stringify(result.events) },
      };
      outcome = { ok: true, events: result.events };
      traffic.addWritten(next);
      return next;
    };

    try {
      await deps.runTransaction(ref(db, paths.match(roomCode)), updateMatch, { applyLocally: false });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      const now = await read(paths.meta(roomCode));
      if (now === null || now.status !== PLAYING_STATUS) throw new RoomError(ROOM_ERR.NO_MATCH, 'the match is no longer running', error);
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the move', error);
    }
    if (outcome === null) throw new RoomError(ROOM_ERR.NO_MATCH, 'no match is running in this room');
    if (!outcome.ok) return outcome;
    return { ok: true, events: eventsFor(outcome.events, mySeat) };
  }

  /**
   * Watches the match as the caller's seat sees it. Every change delivers
   * { n, seq, view, events, initial }: `view` is viewFor(state, mySeat) (the spectator view for a
   * member who is not a player of this match), `events` the new log entries since the previous
   * delivery as eventsFor lets that seat see them. The first delivery of a match (the first one,
   * or after a new match started) has initial: true and all of its log entries. Nothing is
   * delivered while the room has no match.
   * @param {{ uid: string, code: string, onUpdate: (update: object) => void, onError?: (error: unknown) => void }} input
   * @returns {() => void} unsubscribe
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_DEPENDENCIES
   */
  function watchMatch({ uid, code, onUpdate, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    requireDeps('onValue');
    if (typeof onUpdate !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'watchMatch needs onUpdate');
    const report = reporter(onError);

    let stopped = false;
    let unsubscribe = null;
    let lastN = null;
    let lastSeq = -1;

    (async () => {
      const seatId = await currentSeat(roomCode, uid);
      if (stopped) return;
      unsubscribe = deps.onValue(
        ref(db, paths.match(roomCode)),
        (snapshot) => {
          const value = snapshot.val();
          traffic.addReceived(value);
          if (stopped || value === null || typeof value !== 'object') return;
          let state;
          try {
            state = JSON.parse(value.stateJson);
          } catch (error) {
            report(error);
            return;
          }
          const playerId = playerIdIn(state, seatId);
          const initial = value.n !== lastN;
          const update = {
            n: value.n,
            seq: value.seq,
            view: viewFor(state, playerId),
            events: eventsSince(parseLog(value.log), initial ? -1 : lastSeq, playerId),
            initial,
          };
          lastN = value.n;
          lastSeq = value.seq;
          try {
            onUpdate(update);
          } catch (error) {
            report(error);
          }
        },
        // The match is members-only: a refused listener means this device has no seat (any more).
        (error) => {
          stopped = true;
          report(new RoomError(ROOM_ERR.NOT_MEMBER, `only a member of room ${roomCode} can watch the match`, error));
        },
      );
      if (stopped) unsubscribe();
    })().catch(report);

    return function stop() {
      stopped = true;
      if (unsubscribe) unsubscribe();
    };
  }

  return {
    startMatch,
    submitAction,
    watchMatch,
    /** Approximate traffic of startMatch, submitAction and watchMatch (see createTrafficCounter). */
    getTrafficStats: () => traffic.stats(),
    resetTrafficStats: () => traffic.reset(),
  };
}
