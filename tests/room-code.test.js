// Room code generator (src/rooms/code.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../src/rooms/code.js';

test('room code: generated codes have 6 characters from the alphabet', () => {
  for (let i = 0; i < 2000; i += 1) {
    const code = generateRoomCode();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), `unexpected character ${ch} in ${code}`);
    assert.ok(isValidRoomCode(code));
  }
});

test('room code: the alphabet has no look-alike characters (0/O, 1/I/L) and no duplicates', () => {
  for (const ch of ['0', 'O', '1', 'I', 'L']) assert.ok(!CODE_ALPHABET.includes(ch), `alphabet contains ${ch}`);
  assert.equal(new Set(CODE_ALPHABET).size, CODE_ALPHABET.length);
  assert.match(CODE_ALPHABET, /^[A-Z2-9]+$/);
  assert.equal(CODE_ALPHABET, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
});

test('room code: every alphabet character occurs over many codes', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) for (const ch of generateRoomCode()) seen.add(ch);
  assert.equal(seen.size, CODE_ALPHABET.length);
});

test('room code: uses the injected random source and skips biased bytes', () => {
  // 248..255 would favour the first characters (256 is not a multiple of 31), so they are skipped.
  const feed = [255, 248, 0, 1, 30, 31, 61, 62, 250, 3, 4, 5];
  const source = (array) => {
    for (let i = 0; i < array.length; i += 1) array[i] = feed.length > 0 ? feed.shift() : 0;
    return array;
  };
  // 0->A, 1->B, 30->9, 31->A, 61->9, 62->A
  assert.equal(generateRoomCode(source), 'AB9A9A');
});

test('room code: the generator does not use Math.random', () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used');
  };
  try {
    assert.ok(isValidRoomCode(generateRoomCode()));
  } finally {
    Math.random = original;
  }
});

test('room code: validation and normalization of typed codes', () => {
  assert.ok(isValidRoomCode('ABC234'));
  for (const bad of ['ABC23', 'ABC2345', 'abc234', 'ABC230', 'ABCO23', 'ABC123', 'ABCI23', 'ABCL23', ' ABC234', '', null, 42]) {
    assert.equal(isValidRoomCode(bad), false, `accepted ${String(bad)}`);
  }
  assert.equal(normalizeRoomCode('  abc234 '), 'ABC234');
  assert.equal(normalizeRoomCode('abc 234'), null);
  assert.equal(normalizeRoomCode(undefined), null);
});

test('room code: database.rules.json accepts exactly the same format', () => {
  const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  const pattern = `$code.matches(/^[${CODE_ALPHABET}]{${CODE_LENGTH}}$/)`;
  const uses = rules.split('$code.matches(').length - 1;
  assert.ok(uses >= 4, 'rules should check the code on every room child');
  assert.equal(rules.split(pattern).length - 1, uses, 'every $code check in the rules must use the generator alphabet');
});
