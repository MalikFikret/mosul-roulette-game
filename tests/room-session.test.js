// Session scores and match results (src/rooms/match-helpers.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createMatch, scoreMatch, DEFAULT_SCORING } from '../src/engine/index.js';
import { buildResult, computeSessionScores } from '../src/rooms/index.js';

// A stored result entry: per-seat totals and the joinedAt of each seat at that match.
function result(totals, joinedAt) {
  const players = {};
  for (const [seatId, total] of Object.entries(totals)) players[seatId] = { total };
  return { scoreJson: JSON.stringify({ players }), joinedAt };
}
const seat = (joinedAt) => ({ uid: 'u', name: 'n', joinedAt });

test('room session: points add up over matches for the same people', () => {
  const results = { 1: result({ s01: 5, s02: 2 }, { s01: 10, s02: 20 }), 2: result({ s01: 1, s02: 7 }, { s01: 10, s02: 20 }) };
  assert.deepEqual(computeSessionScores(results, { s01: seat(10), s02: seat(20) }), { s01: 6, s02: 9 });
  // No results yet: everybody has 0.
  assert.deepEqual(computeSessionScores(null, { s01: seat(10), s03: seat(30) }), { s01: 0, s03: 0 });
});

test('room session: a freed and retaken seat starts at 0 (another person, another joinedAt)', () => {
  const results = { 1: result({ s01: 5, s02: 8 }, { s01: 10, s02: 20 }) };
  // s02 was left / kicked and taken by a newcomer, who joined later.
  assert.deepEqual(computeSessionScores(results, { s01: seat(10), s02: seat(99) }), { s01: 5, s02: 0 });
  // The newcomer's own later matches count.
  const more = { ...results, 2: result({ s01: 1, s02: 4 }, { s01: 10, s02: 99 }) };
  assert.deepEqual(computeSessionScores(more, { s01: seat(10), s02: seat(99) }), { s01: 6, s02: 4 });
});

test('room session: a seat recovered with its PIN keeps its points (same joinedAt)', () => {
  // Recovery only changes seats/{seatId}/uid; joinedAt stays, so the points stay.
  const results = { 1: result({ s02: 8 }, { s02: 20 }) };
  assert.deepEqual(computeSessionScores(results, { s02: { ...seat(20), uid: 'new-device' } }), { s02: 8 });
});

test('room session: results as an array (keys 1..n) and unreadable entries are handled', () => {
  const asArray = [undefined, result({ s01: 2 }, { s01: 10 }), result({ s01: 3 }, { s01: 10 })];
  assert.deepEqual(computeSessionScores(asArray, { s01: seat(10) }), { s01: 5 });
  const broken = { 1: { scoreJson: 'not json', joinedAt: {} }, 2: null, 3: result({ s01: 1 }, { s01: 10 }) };
  assert.deepEqual(computeSessionScores(broken, { s01: seat(10) }), { s01: 1 });
});

test('room session: buildResult scores all log events of a played match with DEFAULT_SCORING', () => {
  let { state, events } = createMatch({ mode: 'classic' }, [{ id: 's01' }, { id: 's02' }, { id: 's03' }], 99);
  const log = { 0: JSON.stringify(events) };
  const all = [...events];
  let seq = 0;
  // Let every countdown run out: each timeout makes the automatic shot, so the match ends.
  while (state.status !== 'ended' && seq < 2000) {
    const step = applyAction(state, { type: 'timeout', seq: state.clock.seq });
    assert.equal(step.ok, true, JSON.stringify(step.error));
    state = step.state;
    seq += 1;
    log[seq] = JSON.stringify(step.events);
    all.push(...step.events);
  }
  assert.equal(state.status, 'ended');
  const entry = buildResult(state, log, { s01: seat(1), s02: seat(2), s03: seat(3), s04: seat(4) });
  assert.deepEqual(JSON.parse(entry.scoreJson), scoreMatch(all, DEFAULT_SCORING));
  assert.deepEqual(entry.joinedAt, { s01: 1, s02: 2, s03: 3 });
});
