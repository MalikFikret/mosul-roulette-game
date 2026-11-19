// Room creation and joining on top of the Firebase Realtime Database.
//
// This module never imports Firebase. The caller injects the database functions
// (dependency injection): the browser passes the functions of the SDK loaded from the
// official CDN, the tests pass the ones of the npm `firebase` package. It also never signs in:
// the caller passes the uid of the (anonymous) user the database instance is signed in as.
//
// The security rules in database.rules.json are the real guard; the checks here only give
// clear error codes before a write that the rules would refuse anyway.

import { defaultConfig } from '../engine/index.js';
import { generateRoomCode, normalizeRoomCode } from './code.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import {
  HOST_SEAT,
  LOBBY_STATUS,
  ROOM_MODES,
  SEAT_IDS,
  VISIBILITIES,
  isSeatId,
  isValidUid,
  normalizeName,
  paths,
  toDbValue,
} from './schema.js';

const DEFAULT_MAX_CODE_ATTEMPTS = 10;

/**
 * @typedef {object} RoomApiDeps
 * @property {unknown} db                       a modular `Database` instance (getDatabase())
 * @property {(db: unknown, path?: string) => unknown} ref       firebase/database `ref`
 * @property {(ref: unknown) => Promise<{ val(): unknown }>} get  firebase/database `get`
 * @property {(ref: unknown, values: object) => Promise<void>} update  firebase/database `update`
 * @property {() => object} serverTimestamp     firebase/database `serverTimestamp`
 * @property {() => string} [generateCode]      room code source (default: generateRoomCode)
 * @property {number} [maxCodeAttempts]         codes to try before CODE_GENERATION_FAILED (default 10)
 */

/**
 * Creates the room API bound to one database instance.
 * @param {RoomApiDeps} deps
 */
export function createRoomApi(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'createRoomApi needs an object of database functions');
  }
  const { db, ref, get, update, serverTimestamp } = deps;
  for (const [key, fn] of Object.entries({ ref, get, update, serverTimestamp })) {
    if (typeof fn !== 'function') throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, `missing function: ${key}`);
  }
  if (db === undefined || db === null) throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'missing db');
  const generateCode = deps.generateCode ?? (() => generateRoomCode());
  const maxCodeAttempts = deps.maxCodeAttempts ?? DEFAULT_MAX_CODE_ATTEMPTS;
  if (typeof generateCode !== 'function' || !Number.isInteger(maxCodeAttempts) || maxCodeAttempts < 1) {
    throw new RoomError(ROOM_ERR.INVALID_DEPENDENCIES, 'invalid generateCode or maxCodeAttempts');
  }

  async function read(path) {
    const snapshot = await get(ref(db, path));
    const value = snapshot.val();
    return value === undefined ? null : value;
  }

  // One atomic multi-path update from the database root: every path is checked by the
  // rules against the same resulting tree, and either all of them are written or none.
  function writeAll(values) {
    return update(ref(db), values);
  }

  function seatEntry(uid, name) {
    return { uid, name, joinedAt: serverTimestamp() };
  }

  function requireUid(uid) {
    if (!isValidUid(uid)) throw new RoomError(ROOM_ERR.INVALID_UID, 'uid must be the signed-in user id');
  }

  function requireName(name) {
    const trimmed = normalizeName(name);
    if (trimmed === null) throw new RoomError(ROOM_ERR.INVALID_NAME, 'name must be 1-20 characters after trimming');
    return trimmed;
  }

  /**
   * Creates a new room in the lobby state. The creator takes seat s01 and is the host.
   * Settings are the engine's default config for the mode.
   * @param {{ uid: string, name: string, visibility: 'public' | 'private', mode: 'classic' | 'custom' }} input
   * @returns {Promise<{ code: string, seatId: 's01' }>}
   * @throws {RoomError} INVALID_UID, INVALID_NAME, INVALID_VISIBILITY, INVALID_MODE,
   *   CODE_GENERATION_FAILED (every generated code was taken), WRITE_DENIED
   */
  async function createRoom({ uid, name, visibility, mode } = {}) {
    requireUid(uid);
    const playerName = requireName(name);
    if (!VISIBILITIES.includes(visibility)) {
      throw new RoomError(ROOM_ERR.INVALID_VISIBILITY, `visibility must be one of: ${VISIBILITIES.join(', ')}`);
    }
    if (!ROOM_MODES.includes(mode)) {
      throw new RoomError(ROOM_ERR.INVALID_MODE, `mode must be one of: ${ROOM_MODES.join(', ')}`);
    }

    for (let attempt = 0; attempt < maxCodeAttempts; attempt += 1) {
      const code = generateCode();
      if (normalizeRoomCode(code) !== code) {
        throw new RoomError(ROOM_ERR.INVALID_CODE, `generated code is not a valid room code: ${String(code)}`);
      }
      if ((await read(paths.meta(code))) !== null) continue; // taken: try another code

      try {
        await writeAll({
          [paths.meta(code)]: {
            visibility,
            mode,
            status: LOBBY_STATUS,
            hostSeat: HOST_SEAT,
            createdAt: serverTimestamp(),
          },
          [paths.settings(code)]: toDbValue(defaultConfig(mode)),
          [paths.seat(code, HOST_SEAT)]: seatEntry(uid, playerName),
          [paths.member(code, uid)]: HOST_SEAT,
        });
        return { code, seatId: HOST_SEAT };
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        // Someone created a room with this code between the check and the write.
        if ((await read(paths.meta(code))) !== null) continue;
        throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused to create the room', error);
      }
    }
    throw new RoomError(
      ROOM_ERR.CODE_GENERATION_FAILED,
      `no free room code found in ${maxCodeAttempts} attempts`,
    );
  }

  /**
   * Joins an existing room, taking the first free seat in the order s01..s15.
   * A user who is already a member gets their existing seat back and nothing is written.
   * @param {{ uid: string, code: string, name: string }} input
   *   `code` may be typed in lower case or with surrounding spaces
   * @returns {Promise<{ seatId: string }>}
   * @throws {RoomError} INVALID_UID, INVALID_CODE, INVALID_NAME, ROOM_NOT_FOUND, ROOM_FULL
   */
  async function joinRoom({ uid, code, name } = {}) {
    requireUid(uid);
    const roomCode = normalizeRoomCode(code);
    if (roomCode === null) throw new RoomError(ROOM_ERR.INVALID_CODE, 'not a valid room code');
    const playerName = requireName(name);

    if ((await read(paths.meta(roomCode))) === null) {
      throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);
    }

    const existing = await read(paths.member(roomCode, uid));
    if (isSeatId(existing)) return { seatId: existing };

    // A non-member cannot read the seats, so try each one: the rules refuse a seat that is
    // taken, and the seat plus the members entry are written in one atomic update, so two
    // players can never end up on the same seat.
    for (const seatId of SEAT_IDS) {
      try {
        await writeAll({
          [paths.seat(roomCode, seatId)]: seatEntry(uid, playerName),
          [paths.member(roomCode, uid)]: seatId,
        });
        return { seatId };
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
      }
    }

    // The same user may have joined from another device while we were trying seats.
    const late = await read(paths.member(roomCode, uid));
    if (isSeatId(late)) return { seatId: late };
    throw new RoomError(ROOM_ERR.ROOM_FULL, `room ${roomCode} has no free seat`);
  }

  return { createRoom, joinRoom };
}
