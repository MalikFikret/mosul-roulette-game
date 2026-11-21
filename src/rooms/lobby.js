// watchLobby: everything the waiting room shows, live, for a member of the room.
//
// It listens to meta, settings, seats, presence and results (all members-only, except meta) and
// delivers one combined snapshot whenever any of them changes, with the session points
// computed from results (computeSessionScores). Reading only: nothing is written.

import { ROOM_ERR, RoomError } from './errors.js';
import { computeSessionScores } from './match-helpers.js';
import { paths } from './schema.js';

const PARTS = Object.freeze(['meta', 'settings', 'seats', 'presence', 'results']);

function safeCall(fn, value) {
  if (typeof fn !== 'function') return;
  try {
    fn(value);
  } catch {
    // A callback must never break a listener.
  }
}

/**
 * @param {object} ctx shared helpers from api.js
 */
export function createLobbyFunctions({ deps, db, ref, requireUid, requireCode }) {
  /**
   * Watches the room for the waiting room. `onUpdate` receives
   * `{ meta, settings, seats, presence, scores, initial }` once every part has arrived and then
   * after every change (`seats` and `presence` are {} when empty; `scores` has every current
   * seat, 0 without points; `initial` is true for the first delivery only).
   * Errors go to `onError`, never thrown from a listener. If this device has or loses no seat in
   * the room (left, kicked, recovered elsewhere), the watch stops by itself and reports one
   * RoomError: SEAT_LOST (it had delivered data) or NOT_MEMBER (never could read); if the room
   * disappears, ROOM_NOT_FOUND.
   * @param {{ uid: string, code: string, onUpdate: (lobby: object) => void,
   *   onError?: (error: unknown) => void }} input
   * @returns {() => void} stop()
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_DEPENDENCIES
   */
  function watchLobby({ uid, code, onUpdate, onError } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    if (typeof deps.onValue !== 'function') {
      throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'missing function: onValue (needed for watchLobby)');
    }
    if (typeof onUpdate !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'watchLobby needs onUpdate');

    const values = {};
    let stopped = false;
    let delivered = false;
    const unsubscribers = [];

    function fail(error) {
      if (stopped) return;
      stop();
      safeCall(onError, error);
    }

    function emit() {
      if (stopped || PARTS.some((part) => !(part in values))) return;
      if (values.meta === null) {
        fail(new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `room ${roomCode} no longer exists`));
        return;
      }
      const seats = values.seats ?? {};
      const lobby = {
        meta: values.meta,
        settings: values.settings,
        seats,
        presence: values.presence ?? {},
        scores: computeSessionScores(values.results, seats),
        initial: !delivered,
      };
      delivered = true;
      safeCall(onUpdate, lobby);
    }

    const pathOf = {
      meta: paths.meta(roomCode),
      settings: paths.settings(roomCode),
      seats: paths.seats(roomCode),
      presence: paths.presence(roomCode),
      results: paths.results(roomCode),
    };
    for (const part of PARTS) {
      unsubscribers.push(
        deps.onValue(
          ref(db, pathOf[part]),
          (snapshot) => {
            const value = snapshot.val();
            values[part] = value === undefined ? null : value;
            emit();
          },
          // Members-only data: a refused (or revoked) listener means no seat (any more).
          (error) => {
            fail(
              delivered
                ? new RoomError(ROOM_ERR.SEAT_LOST, `this device no longer has a seat in room ${roomCode}`, error)
                : new RoomError(ROOM_ERR.NOT_MEMBER, `only a member of room ${roomCode} can watch it`, error),
            );
          },
        ),
      );
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {
          // Already gone.
        }
      }
    }
    // A listener may have failed synchronously while subscribing.
    if (stopped) for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    return stop;
  }

  return { watchLobby };
}
