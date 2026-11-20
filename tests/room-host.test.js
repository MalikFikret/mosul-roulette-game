// Host choice and host absence (src/rooms/host.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_ABSENCE_MS,
  absentSince,
  chooseNewHost,
  isHostAbsentLongEnough,
  isSeatPresent,
} from '../src/rooms/index.js';

// A deterministic `random` that returns the given values in turn.
const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('room host: chooseNewHost returns null for an empty or missing list', () => {
  assert.equal(chooseNewHost([]), null);
  assert.equal(chooseNewHost([], { scores: { s01: 3 } }), null);
  assert.equal(chooseNewHost(undefined), null);
});

test('room host: without scores the choice is uniform among the candidates only', () => {
  const candidates = ['s02', 's05', 's09'];
  assert.equal(chooseNewHost(candidates, { random: () => 0 }), 's02');
  assert.equal(chooseNewHost(candidates, { random: () => 0.34 }), 's05');
  assert.equal(chooseNewHost(candidates, { random: () => 0.999999 }), 's09');
  // An out-of-range random value never escapes the list.
  assert.equal(chooseNewHost(candidates, { random: () => 1 }), 's09');
  const counts = { s02: 0, s05: 0, s09: 0 };
  for (let i = 0; i < 3000; i += 1) counts[chooseNewHost(candidates)] += 1;
  assert.deepEqual(Object.keys(counts).sort(), candidates);
  for (const seatId of candidates) assert.ok(counts[seatId] > 800, `${seatId} chosen ${counts[seatId]} times`);
});

test('room host: with scores the highest wins, whatever random says', () => {
  const scores = { s02: 4, s05: 9, s09: 1 };
  for (const r of [0, 0.5, 0.99]) assert.equal(chooseNewHost(['s02', 's05', 's09'], { scores, random: () => r }), 's05');
  // A candidate without a score ranks below scored ones; a non-candidate's score is ignored.
  assert.equal(chooseNewHost(['s02', 's03'], { scores: { s03: 0, s07: 100 }, random: () => 0 }), 's03');
});

test('room host: ties on the highest score are broken uniformly at random', () => {
  const scores = { s02: 7, s05: 7, s09: 3 };
  const pick = (r) => chooseNewHost(['s02', 's05', 's09'], { scores, random: sequence(r) });
  assert.equal(pick(0), 's02');
  assert.equal(pick(0.6), 's05');
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(chooseNewHost(['s02', 's05', 's09'], { scores }));
  assert.deepEqual([...seen].sort(), ['s02', 's05']);
});

test('room host: presence and absent-since helpers', () => {
  assert.equal(isSeatPresent({ conns: { a: true }, lastSeenAt: 5 }), true);
  assert.equal(isSeatPresent({ lastSeenAt: 5 }), false);
  assert.equal(isSeatPresent({ conns: {} }), false);
  assert.equal(isSeatPresent(null), false);
  assert.equal(isSeatPresent(undefined), false);
  assert.equal(absentSince({ lastSeenAt: 500 }, 100), 500);
  assert.equal(absentSince(null, 100), 100);
  assert.equal(absentSince({ conns: { a: true } }, 100), 100);
  assert.equal(absentSince(undefined, undefined), null);
});

test('room host: absent long enough only after more than 60 s of absence', () => {
  const now = 1_000_000;
  assert.equal(HOST_ABSENCE_MS, 60000);
  // Present: never, however old lastSeenAt is.
  assert.equal(isHostAbsentLongEnough({ conns: { a: true }, lastSeenAt: now - 600000 }, now - 600000, now), false);
  assert.equal(isHostAbsentLongEnough({ lastSeenAt: now - 59000 }, now - 600000, now), false);
  assert.equal(isHostAbsentLongEnough({ lastSeenAt: now - 60000 }, now - 600000, now), false);
  assert.equal(isHostAbsentLongEnough({ lastSeenAt: now - 61000 }, now - 600000, now), true);
  // No presence entry: joinedAt is the absent-since time.
  assert.equal(isHostAbsentLongEnough(undefined, now - 61000, now), true);
  assert.equal(isHostAbsentLongEnough(null, now - 30000, now), false);
  assert.equal(isHostAbsentLongEnough(undefined, undefined, now), false);
});

test('room host: database.rules.json uses the same 60-second threshold', () => {
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'));
  const hostRule = rules.rules.rooms.$code.meta.hostSeat['.write'];
  const uses = hostRule.split(`+ ${HOST_ABSENCE_MS}`).length - 1;
  assert.equal(uses, 2, 'lastSeenAt and joinedAt branches');
  assert.ok(!/\+ (?!60000)\d+/.test(hostRule), 'no other time offset in the hostSeat rule');
});
