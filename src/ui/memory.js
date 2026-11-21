// What the browser remembers between page loads: the table code ONLY. Never the Şifre, never a
// name. Storage can be missing or throw (private windows, blocked site data); the game then
// simply forgets.

import { isValidRoomCode } from '../rooms/index.js';
import { REMEMBER_PER_TAB } from './firebase.js';

const KEY = 'sonCay.tableCode';

function storage() {
  try {
    return REMEMBER_PER_TAB ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** @returns {string | null} the remembered table code, if it is still a valid code */
export function rememberedCode() {
  try {
    const code = storage()?.getItem(KEY) ?? null;
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function rememberCode(code) {
  if (!isValidRoomCode(code)) return;
  try {
    storage()?.setItem(KEY, code);
  } catch {
    // Not remembered: a refresh then shows Giriş.
  }
}

export function forgetCode() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
