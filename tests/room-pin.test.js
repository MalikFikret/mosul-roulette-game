// Seat PIN format (src/rooms/schema.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isValidPin } from '../src/rooms/index.js';

test('room pin: every 4-digit string from 0000 to 9999 is a valid PIN, weak ones included', () => {
  for (let n = 0; n <= 9999; n += 1) {
    const pin = String(n).padStart(4, '0');
    assert.equal(isValidPin(pin), true, pin);
  }
});

test('room pin: anything else is refused (length, letters, spaces, numbers, null)', () => {
  for (const bad of ['123', '12345', '12a4', ' 1234', '1234 ', '12 4', '١٢٣٤', '+123', '-123', '1.23', '', 1234, 0, null, undefined, ['1234'], {}]) {
    assert.equal(isValidPin(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('room pin: database.rules.json checks secrets and claims with the same 4-digit pattern', () => {
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  const room = rules.rules.rooms.$code;
  const pattern = 'newData.val().matches(/^[0-9]{4}$/)';
  assert.ok(room.secrets.$seatId['.validate'].includes(pattern));
  assert.ok(room.claims.$seatId.pin['.validate'].includes(pattern));
  assert.equal(room.secrets['.read'], undefined);
  assert.equal(room.secrets.$seatId['.read'], undefined);
  assert.equal(room.claims['.read'], undefined);
  assert.equal(room.claims.$seatId['.read'], undefined);
});
