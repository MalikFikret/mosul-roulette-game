// Public API of the room layer. Import from this file only.
// Nothing here imports Firebase: database functions are injected into createRoomApi().

export { createRoomApi } from './api.js';
export { CODE_ALPHABET, CODE_LENGTH, generateRoomCode, isValidRoomCode, normalizeRoomCode } from './code.js';
export { ROOM_ERR, RoomError, isPermissionDenied } from './errors.js';
export { HOST_ABSENCE_MS, absentSince, chooseNewHost, isHostAbsentLongEnough, isSeatPresent } from './host.js';
export {
  HOST_SEAT,
  LOBBY_STATUS,
  NAME_MAX,
  NAME_MIN,
  ROOM_MODES,
  SEAT_IDS,
  VISIBILITIES,
  isSeatId,
  isValidPin,
  isValidUid,
  normalizeName,
  paths,
  toDbValue,
} from './schema.js';
