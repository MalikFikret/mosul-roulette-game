// Seat names and their names/ key (src/rooms/schema.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, normalizeName } from '../src/rooms/index.js';

test('room names: the six characters illegal in database keys are refused anywhere in a name', () => {
  for (const ch of ['.', '$', '#', '[', ']', '/']) {
    for (const name of [`a${ch}b`, `${ch}ab`, `ab${ch}`, ch]) assert.equal(normalizeName(name), null, JSON.stringify(name));
  }
});

test('room names: trimming, limits and control characters are unchanged', () => {
  assert.equal(normalizeName('  Ali  '), 'Ali');
  assert.equal(normalizeName('x'.repeat(20)), 'x'.repeat(20));
  assert.equal(normalizeName('x'.repeat(21)), null);
  assert.equal(normalizeName('   '), null);
  assert.equal(normalizeName('two\nlines'), null);
  assert.equal(normalizeName('tab\there'), null);
  assert.equal(normalizeName(42), null);
  for (const name of ['محمد علي', 'İstanbul', 'Élodie', 'Ali 😀', 'a-b_c (d)', "O'Neil", 'a,b;c:d!?']) {
    assert.equal(normalizeName(name), name, name);
  }
});

test('room names: the key is the name in lower case (JavaScript toLowerCase)', () => {
  assert.equal(nameKey('Ali'), 'ali');
  assert.equal(nameKey('ALI'), nameKey('ali'));
  assert.equal(nameKey('İstanbul'), 'i̇stanbul'); // dotted capital I -> i + combining dot
  assert.equal(nameKey('IRMAK'), 'irmak');
  assert.notEqual(nameKey('ırmak'), nameKey('IRMAK')); // dotless i stays distinct
  assert.equal(nameKey('محمد'), 'محمد');
});
