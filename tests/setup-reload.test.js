// Match setup and the reload rules (document: "Setup before start", "Reload").

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, applyAction, viewFor, chamberRange, liveRange, TOOL_IDS } from '../src/engine/index.js';
import { ids, newMatch, setup, act, play, shoot, use, pubs, privs, one, player, edit } from './helpers.js';

const players = (n) => ids(n).map((id) => ({ id }));

test('setup: the same seed always produces the same match', () => {
  const a = createMatch({}, players(7), 1234);
  const b = createMatch({}, players(7), 1234);
  assert.deepEqual(a, b);
  const c = createMatch({}, players(7), 1235);
  assert.notDeepEqual(a.state, c.state);
});

test('setup: seat order is random by default', () => {
  const orders = {};
  for (let seed = 0; seed < 40; seed++) {
    const s = createMatch({}, players(5), seed).state;
    assert.deepEqual(s.players.map((p) => p.id).sort(), ids(5));
    s.players.forEach((p, i) => assert.equal(p.seat, i));
    orders[s.players.map((p) => p.id).join(',')] = true;
  }
  assert.ok(Object.keys(orders).length > 10);
});

test('setup: the host can fix the seat order manually', () => {
  for (let seed = 0; seed < 10; seed++) {
    const s = createMatch({ randomizeSeats: false }, players(6), seed).state;
    assert.deepEqual(
      s.players.map((p) => p.id),
      ids(6),
    );
  }
});

test('setup: the first player is random and announced', () => {
  const firsts = {};
  for (let seed = 0; seed < 60; seed++) {
    const { state, events } = createMatch({ randomizeSeats: false }, players(4), seed);
    const started = one(pubs(events, 'turnStarted'));
    assert.equal(started.player, state.turn.playerId);
    assert.equal(started.turn, 1);
    firsts[state.turn.playerId] = true;
  }
  assert.deepEqual(Object.keys(firsts).sort(), ids(4));
});

test('setup: every player starts alive with the configured life points', () => {
  const s = createMatch({ hp: 4 }, players(5), 3).state;
  for (const p of s.players) {
    assert.equal(p.hp, 4);
    assert.equal(p.alive, true);
  }
  assert.equal(s.startingPlayers, 5);
  assert.equal(s.direction, 1);
});

test('setup: the state is plain JSON data', () => {
  for (const mode of ['classic', 'custom']) {
    const s = createMatch({ mode }, players(5), 11).state;
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  }
});

test('reload example: 6 living players -> 6 to 12 chambers; 9 chambers -> 3 to 6 live', () => {
  assert.deepEqual(chamberRange(6), { min: 6, max: 12 });
  assert.deepEqual(liveRange(9), { min: 3, max: 6 });
});

test('reload: chamber count is between the living players and twice that', () => {
  for (let n = 3; n <= 15; n++) {
    const seenTotals = {};
    for (let seed = 0; seed < 150; seed++) {
      const s = createMatch({}, players(n), seed * 31 + n).state;
      const total = s.round.chambers.length;
      assert.ok(total >= n && total <= 2 * n, `n=${n} total=${total}`);
      seenTotals[total] = true;
    }
    assert.ok(seenTotals[n] && seenTotals[2 * n], `both ends of the range occur for n=${n}`);
  }
});

test('reload: live count is between a third and two thirds, with at least one live and one blank', () => {
  for (let total = 2; total <= 30; total++) {
    const { min, max } = liveRange(total);
    assert.ok(min >= 1 && max <= total - 1 && min <= max, `total=${total}`);
    assert.ok(min >= total / 3 || min === 1);
    assert.ok(max <= (2 * total) / 3 || max === min);
  }
  for (let seed = 0; seed < 400; seed++) {
    const s = createMatch({}, players(3 + (seed % 13)), seed).state;
    const total = s.round.chambers.length;
    const live = s.round.chambers.filter((c) => c.type === 'live').length;
    const { min, max } = liveRange(total);
    assert.ok(live >= min && live <= max);
    assert.ok(live >= 1 && total - live >= 1);
  }
});

test('reload: live and blank counts are announced once, at the reload', () => {
  const { state, events } = newMatch({ n: 5, seed: 9 });
  const reloaded = one(pubs(events, 'reloaded'));
  const live = state.round.chambers.filter((c) => c.type === 'live').length;
  assert.deepEqual(
    { round: reloaded.round, total: reloaded.total, live: reloaded.live, blank: reloaded.blank },
    { round: 1, total: state.round.chambers.length, live, blank: state.round.chambers.length - live },
  );
});

test('reload: what remains is never shown afterwards (players must remember)', () => {
  const s0 = setup({ n: 3, chambers: 'LBLB' });
  const before = viewFor(s0, 'p2').round.announced;
  const { state, events } = play(s0, shoot('p1', 'p2'), shoot('p2', 'p3'));
  // The announced numbers are unchanged, and no event repeats or updates them.
  assert.deepEqual(viewFor(state, 'p2').round.announced, before);
  assert.equal(pubs(events, 'reloaded').length, 0);
  const view = JSON.stringify(viewFor(state, 'p2'));
  assert.ok(!view.includes('cursor') && !view.includes('chambers'));
});

test('reload: chambers are played until they run out, then a new reload is announced', () => {
  const s0 = setup({ n: 3, chambers: 'BB' });
  const first = act(s0, shoot('p1', 'p2'));
  assert.equal(pubs(first.events, 'reloaded').length, 0);
  assert.equal(first.state.round.index, 1);
  const second = act(first.state, shoot('p2', 'p3'));
  const ended = one(pubs(second.events, 'roundEnded'));
  assert.deepEqual(ended, { type: 'roundEnded', round: 1, shots: 2, survivors: ['p1', 'p2', 'p3'], visibility: 'public' });
  const reloaded = one(pubs(second.events, 'reloaded'));
  assert.equal(reloaded.round, 2);
  assert.equal(second.state.round.index, 2);
  assert.equal(second.state.round.cursor, 0);
  assert.equal(second.state.round.shots, 0);
  assert.equal(second.state.round.chambers.length, reloaded.total);
});

test('reload does not change the turn: if it was passing, the next player starts', () => {
  const s0 = setup({ n: 3, chambers: 'B' });
  const { state } = act(s0, shoot('p1', 'p3'));
  assert.equal(state.round.index, 2);
  assert.equal(state.turn.playerId, 'p2');
});

test('reload does not change the turn: a blank on self in the last chamber keeps the turn on the new reload', () => {
  const s0 = setup({ n: 3, chambers: 'B' });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.equal(state.round.index, 2);
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, 1);
  assert.equal(pubs(events, 'turnStarted').length, 0);
});

test('reload: the chamber count follows the LIVING players, not the starting players', () => {
  for (let seed = 0; seed < 60; seed++) {
    let s = setup({ n: 8, chambers: 'B', seed });
    s = edit(s, (d) => {
      for (const id of ['p5', 'p6', 'p7', 'p8']) {
        const p = d.players.find((q) => q.id === id);
        p.alive = false;
        p.hp = 0;
      }
    });
    const { state } = act(s, shoot('p1', 'p2'));
    assert.ok(state.round.chambers.length >= 4 && state.round.chambers.length <= 8);
  }
});

test('tools: with every reload, from the first, each living player draws random enabled tools', () => {
  const { state, events } = newMatch({ n: 5, seed: 21 });
  for (const p of state.players) {
    assert.equal(p.hand.length, 2);
    for (const tool of p.hand) assert.ok(TOOL_IDS.includes(tool));
    const dealt = one(privs(events, 'toolsDealt', p.id));
    assert.deepEqual(dealt.to, [p.id]);
    assert.deepEqual(dealt.tools, p.hand);
  }
});

test('tools: the next reload deals again, only to living players, and hands have no size limit', () => {
  let s = setup({ n: 4, chambers: 'B', hands: { p1: ['heal', 'heal', 'heal', 'heal', 'heal', 'heal'] } });
  s = edit(s, (d) => {
    d.players[3].alive = false;
    d.players[3].hp = 0;
  });
  const { state, events } = act(s, shoot('p1', 'p2'));
  assert.equal(player(state, 'p1').hand.length, 8);
  assert.equal(player(state, 'p2').hand.length, 2);
  assert.equal(player(state, 'p4').hand.length, 0);
  assert.equal(privs(events, 'toolsDealt').length, 3);
});

test('tools: the number dealt per reload and the enabled set are host settings', () => {
  const res = createMatch({ toolsPerReload: 5, enabledTools: ['probe', 'heal'] }, players(4), 77);
  for (const p of res.state.players) {
    assert.equal(p.hand.length, 5);
    for (const tool of p.hand) assert.ok(tool === 'probe' || tool === 'heal');
  }
  const none = createMatch({ toolsPerReload: 0 }, players(4), 77);
  for (const p of none.state.players) assert.equal(p.hand.length, 0);
});

test('tools: dealing is random across the enabled set', () => {
  const seen = {};
  for (let seed = 0; seed < 80; seed++) {
    for (const p of createMatch({}, players(6), seed).state.players) for (const t of p.hand) seen[t] = true;
  }
  assert.deepEqual(Object.keys(seen).sort(), TOOL_IDS.slice().sort());
});

test('reload: the round counter of shots ignores skipped chambers', () => {
  const s0 = setup({ n: 3, chambers: 'BBB', hands: { p1: ['skip'] } });
  const { state, events } = play(s0, use('p1', 'skip'), shoot('p1', 'p2'), shoot('p2', 'p3'));
  assert.equal(one(pubs(events, 'roundEnded')).shots, 2);
  assert.equal(state.round.index, 2);
  assert.ok(applyAction);
});
