// Small helpers used across the engine. Everything here is pure.

import { ERR } from './constants.js';

// Deep copy of plain JSON data (objects, arrays, primitives).
export function clone(value) {
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clone(value[i]);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Own-property check, for objects used as lookup tables with outside keys.
export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

// Internal control flow for rejected actions. The reducer works on a private
// draft copy, so throwing simply discards the draft and the caller's state is
// returned untouched.
export class EngineError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export function reject(code, message) {
  throw new EngineError(code, message);
}

export function getPlayer(state, id) {
  for (const p of state.players) if (p.id === id) return p;
  return null;
}

export function alivePlayers(state) {
  return state.players.filter((p) => p.alive);
}

// Returns the player record or rejects with UNKNOWN_PLAYER.
export function requirePlayer(state, id) {
  if (typeof id !== 'string') reject(ERR.INVALID_ACTION, 'playerId must be a string');
  const p = getPlayer(state, id);
  if (!p) reject(ERR.UNKNOWN_PLAYER, `unknown player: ${id}`);
  return p;
}

export function requireAlivePlayer(state, id) {
  const p = requirePlayer(state, id);
  if (!p.alive) reject(ERR.PLAYER_ELIMINATED, `player is eliminated: ${id}`);
  return p;
}

// A valid target is any living player (optionally excluding one id).
export function requireTarget(state, id, excludeId) {
  if (typeof id !== 'string') reject(ERR.INVALID_TARGET, 'target must be a player id');
  const p = getPlayer(state, id);
  if (!p || !p.alive) reject(ERR.INVALID_TARGET, `target is not a living player: ${id}`);
  if (excludeId !== undefined && id === excludeId) reject(ERR.INVALID_TARGET, 'you cannot target yourself with this');
  return p;
}

export function removeOne(list, item) {
  const i = list.indexOf(item);
  if (i === -1) return false;
  list.splice(i, 1);
  return true;
}
