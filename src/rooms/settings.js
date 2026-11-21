// updateSettings: the current host replaces the room's match settings between matches.
//
// The new settings are checked with the engine's validateConfig before anything is written
// (the security rules check only keys and types, and the mode must stay meta.mode). The whole
// settings node is replaced in one write, so a reader never sees half of a change.

import { validateConfig } from '../engine/index.js';
import { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
import { LOBBY_STATUS, paths, toDbValue } from './schema.js';

/**
 * @param {object} ctx shared helpers from api.js
 */
export function createSettingsFunctions({ read, writeAll, requireUid, requireCode, currentSeat }) {
  /**
   * Replaces the settings of the room. Only the host (the valid member on meta.hostSeat), only
   * while no match runs. Fields left out take the engine's default for the mode.
   * @param {{ uid: string, code: string, settings: object }} input  settings: a match config
   *   (validateConfig input); its mode must be the room's mode
   * @returns {Promise<{ settings: object }>} the normalized config as written
   * @throws {RoomError} INVALID_UID, INVALID_CODE, ROOM_NOT_FOUND, NOT_IN_LOBBY (a match is
   *   running), NOT_MEMBER, WRITE_DENIED (not the host, or refused), INVALID_SETTINGS
   *   (validateConfig failed or another mode; `details` holds the errors)
   */
  async function updateSettings({ uid, code, settings } = {}) {
    requireUid(uid);
    const roomCode = requireCode(code);
    const meta = await read(paths.meta(roomCode));
    if (meta === null) throw new RoomError(ROOM_ERR.ROOM_NOT_FOUND, `no room with code ${roomCode}`);

    const checked = validateConfig(settings);
    if (!checked.ok || checked.config.mode !== meta.mode) {
      const error = new RoomError(ROOM_ERR.INVALID_SETTINGS, 'not a valid match config for this room');
      error.details = checked.ok ? [{ field: 'mode', message: `the room's mode is ${meta.mode}` }] : checked.errors;
      throw error;
    }
    if (meta.status !== LOBBY_STATUS) throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'settings change only between matches');
    const mySeat = await currentSeat(roomCode, uid);
    if (mySeat === null) throw new RoomError(ROOM_ERR.NOT_MEMBER, `this user has no seat in room ${roomCode}`);
    if (meta.hostSeat !== mySeat) throw new RoomError(ROOM_ERR.WRITE_DENIED, 'only the host can change the settings');

    const value = toDbValue(checked.config);
    try {
      await writeAll({ [paths.settings(roomCode)]: value });
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      // Refused: a match started or the host role moved meanwhile.
      const now = await read(paths.meta(roomCode));
      if (now !== null && now.status !== LOBBY_STATUS) {
        throw new RoomError(ROOM_ERR.NOT_IN_LOBBY, 'a match was started meanwhile', error);
      }
      throw new RoomError(ROOM_ERR.WRITE_DENIED, 'the database refused the settings', error);
    }
    return { settings: value };
  }

  return { updateSettings };
}
