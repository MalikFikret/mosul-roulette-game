// Room codes: 6 characters from an alphabet without look-alike characters
// (no 0/O, no 1/I/L), so a code can be read out loud or copied by hand.
// database.rules.json accepts exactly this format; keep the two in sync
// (tests/room-code.test.js checks it).

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

// Bytes at or above this value are discarded, so every alphabet character is equally likely.
const BYTE_LIMIT = 256 - (256 % CODE_ALPHABET.length);

function defaultGetRandomValues(array) {
  return globalThis.crypto.getRandomValues(array);
}

/**
 * Generates a random room code with the platform's cryptographic random source
 * (crypto.getRandomValues, available in browsers and Node). Never Math.random.
 * @param {(array: Uint8Array) => Uint8Array} [getRandomValues] injectable for tests
 * @returns {string}
 */
export function generateRoomCode(getRandomValues = defaultGetRandomValues) {
  let code = '';
  while (code.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH * 2);
    getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= BYTE_LIMIT) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * @param {unknown} code
 * @returns {boolean} true if `code` is exactly a well-formed room code
 */
export function isValidRoomCode(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

/**
 * Normalizes typed input (surrounding spaces, lower case) to a room code.
 * @param {unknown} input
 * @returns {string | null} the code, or null if it is not a valid code
 */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return isValidRoomCode(code) ? code : null;
}
