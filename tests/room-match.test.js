// Pure match-layer helpers (src/rooms/match-helpers.js). Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../src/engine/index.js';
import { buildPlayers, createTrafficCounter, eventsSince, jsonSize, parseLog, playerIdIn } from '../src/rooms/index.js';

const seat = (name) => ({ uid: `u-${name}`, name, joinedAt: 1 });

test('room match: players are all seated seats, sorted by seat id, ids only', () => {
  const seats = { s07: seat('g'), s01: seat('a'), s12: seat('l'), s02: seat('b') };
  assert.deepEqual(buildPlayers(seats), [{ id: 's01' }, { id: 's02' }, { id: 's07' }, { id: 's12' }]);
  assert.deepEqual(buildPlayers(null), []);
  assert.deepEqual(buildPlayers({}), []);
  // Only real seat ids with a seat object count.
  assert.deepEqual(buildPlayers({ s01: seat('a'), x01: seat('x'), s16: seat('y'), s03: null, s04: 'bad' }), [{ id: 's01' }]);
  // The list is accepted by the engine.
  const started = createMatch({ mode: 'classic' }, buildPlayers({ s03: seat('c'), s01: seat('a'), s02: seat('b') }), 7);
  assert.equal(started.ok, true);
  assert.deepEqual(started.state.players.map((p) => p.id).sort(), ['s01', 's02', 's03']);
});

test('room match: parseLog reads object or array logs in seq order and skips bad entries', () => {
  const e = (n) => JSON.stringify([{ type: `e${n}`, visibility: 'public' }]);
  assert.deepEqual(parseLog({ 2: e(2), 0: e(0), 1: e(1) }).map((x) => x.seq), [0, 1, 2]);
  assert.deepEqual(parseLog([e(0), e(1)]).map((x) => x.seq), [0, 1]);
  assert.deepEqual(parseLog({ 0: e(0), 1: 'not json', 2: 5, '03': e(3), x: e(4), 4: JSON.stringify({}) }).map((x) => x.seq), [0]);
  assert.deepEqual(parseLog(null), []);
  assert.deepEqual(parseLog(undefined), []);
});

test('room match: eventsSince filters per seat and only returns new entries', () => {
  const log = {
    0: JSON.stringify([{ type: 'a', visibility: 'public' }, { type: 'secretA', visibility: 'private', to: ['s01'] }]),
    1: JSON.stringify([{ type: 'secretB', visibility: 'private', to: ['s02'] }]),
    2: JSON.stringify([{ type: 'b', visibility: 'public' }, { type: 'both', visibility: 'private', to: ['s01', 's02'] }]),
  };
  const entries = parseLog(log);
  const types = (events) => events.map((x) => x.type);
  assert.deepEqual(types(eventsSince(entries, -1, 's01')), ['a', 'secretA', 'b', 'both']);
  assert.deepEqual(types(eventsSince(entries, -1, 's02')), ['a', 'secretB', 'b', 'both']);
  assert.deepEqual(types(eventsSince(entries, -1, null)), ['a', 'b']);
  assert.deepEqual(types(eventsSince(entries, 0, 's01')), ['b', 'both']);
  assert.deepEqual(types(eventsSince(entries, 2, 's01')), []);
});

test('room match: playerIdIn maps a seat to its player id, or null outside the match', () => {
  const state = { players: [{ id: 's01' }, { id: 's03' }] };
  assert.equal(playerIdIn(state, 's03'), 's03');
  assert.equal(playerIdIn(state, 's02'), null);
  assert.equal(playerIdIn(state, null), null);
  assert.equal(playerIdIn({}, 's01'), null);
});

test('room match: traffic counters add JSON lengths and reset', () => {
  const counter = createTrafficCounter();
  assert.deepEqual(counter.stats(), { bytesWritten: 0, bytesReceived: 0, writes: 0, snapshots: 0 });
  counter.addWritten({ a: 1 }); // {"a":1} = 7
  counter.addWritten('xyz'); // "xyz" = 5
  counter.addReceived([1, 2]); // [1,2] = 5
  counter.addReceived(null); // null = 4
  assert.deepEqual(counter.stats(), { bytesWritten: 12, bytesReceived: 9, writes: 2, snapshots: 2 });
  counter.reset();
  assert.deepEqual(counter.stats(), { bytesWritten: 0, bytesReceived: 0, writes: 0, snapshots: 0 });
  assert.equal(jsonSize(undefined), 0);
  assert.equal(jsonSize('محمد'), 6);
});

test('room match: legalActionsFor only ever offers the caller\'s own seat actions', async () => {
  const { applyAction, createMatch: start, listLegalActions } = await import('../src/engine/index.js');
  const { legalActionsFor } = await import('../src/rooms/index.js');
  const seats = ['s01', 's02', 's03', 's04'];
  for (const mode of ['classic', 'custom']) {
    let { state } = start({ mode }, seats.map((id) => ({ id })), 4242);
    for (let step = 0; step < 80 && state.status !== 'ended'; step += 1) {
      for (const seat of seats) {
        const offered = legalActionsFor(state, seat);
        for (const action of offered) {
          assert.equal(action.playerId, seat, `${mode}: ${JSON.stringify(action)} offered to ${seat}`);
          assert.ok(!['timeout', 'removePlayer'].includes(action.type));
        }
        // Exactly the engine's list for that seat (minus system actions).
        assert.equal(offered.length, listLegalActions(state, seat).filter((a) => a.playerId === seat).length);
      }
      assert.deepEqual(legalActionsFor(state, null), [], 'a spectator gets no actions');
      // Move on: a real action if any seat has one, else let the clock run out.
      const actor = seats.find((s) => legalActionsFor(state, s).some((a) => a.type !== 'setPreference' && a.type !== 'chooseTarget'));
      const action = actor ? legalActionsFor(state, actor).find((a) => a.type !== 'setPreference' && a.type !== 'chooseTarget') : { type: 'timeout', seq: state.clock.seq };
      const next = applyAction(state, action);
      state = next.ok ? next.state : applyAction(state, { type: 'timeout', seq: state.clock.seq }).state;
    }
  }
});

test('room match: waiting seats are players of the next match', () => {
  const seats = { s01: seat('a'), s02: { ...seat('b'), waiting: true }, s03: seat('c') };
  assert.deepEqual(buildPlayers(seats), [{ id: 's01' }, { id: 's02' }, { id: 's03' }]);
});
