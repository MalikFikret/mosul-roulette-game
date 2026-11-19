// Smoke test for the emulator harness: with the starter rules everything is locked, and the
// rules-disabled path still works for seeding test data.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { useRulesTestEnv } from './helpers.js';

const rt = useRulesTestEnv();

const PATHS = ['/', 'anything', 'rooms/ABCD/players/p1'];

describe('starter rules deny everything', () => {
  for (const path of PATHS) {
    test(`unauthenticated read of "${path}" is denied`, async () => {
      await assertFails(rt.guestDb().ref(path).get());
    });
    test(`unauthenticated write of "${path}" is denied`, async () => {
      await assertFails(rt.guestDb().ref(path).set({ x: 1 }));
    });
    test(`authenticated read of "${path}" is denied`, async () => {
      await assertFails(rt.userDb('alice').ref(path).get());
    });
    test(`authenticated write of "${path}" is denied`, async () => {
      await assertFails(rt.userDb('alice').ref(path).set({ x: 1 }));
    });
  }
});

describe('rules-disabled access', () => {
  test('a write with rules disabled succeeds and reads back with rules disabled', async () => {
    const value = { code: 'ABCD', players: { p1: true } };
    await rt.withRulesDisabled((db) => assertSucceeds(db.ref('rooms/ABCD').set(value)));
    const snap = await rt.withRulesDisabled((db) => db.ref('rooms/ABCD').get());
    assert.deepEqual(snap.val(), value);
  });

  test('data seeded with rules disabled is still denied to clients', async () => {
    await rt.withRulesDisabled((db) => db.ref('rooms/ABCD').set({ code: 'ABCD' }));
    await assertFails(rt.userDb('alice').ref('rooms/ABCD').get());
  });

  test('the database is cleared between tests', async () => {
    const snap = await rt.withRulesDisabled((db) => db.ref('/').get());
    assert.equal(snap.exists(), false);
  });
});
