// Shared test utilities. Tests build exact situations by editing a COPY of a
// real match state (the state is plain JSON, so this is safe and explicit).

import assert from 'node:assert/strict';
import { createMatch, applyAction } from '../src/engine/index.js';

export function ids(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`p${i}`);
  return out;
}

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// 'LBBL' or ['live','blank',...] -> chamber objects.
export function chambersFrom(spec) {
  const list = typeof spec === 'string' ? spec.split('') : spec;
  return list.map((c) => ({ type: c === 'L' || c === 'live' ? 'live' : 'blank', flipped: false }));
}

// A real match created through createMatch (random seats, random first player).
export function newMatch({ mode = 'classic', n = 3, config = {}, seed = 1, confirm = true } = {}) {
  const res = createMatch(
    { mode, ...config },
    ids(n).map((id) => ({ id, confirmShot: confirm })),
    seed,
  );
  assert.equal(res.ok, true, JSON.stringify(res.error));
  return res;
}

// A controlled situation: seats p1..pn in order, empty hands unless given,
// a chosen chamber order, and a chosen turn player. Confirmation is off by
// default so `chooseTarget` fires immediately.
export function setup({
  mode = 'classic',
  n = 3,
  config = {},
  chambers = null,
  hands = {},
  hp = {},
  coins = {},
  turn = 'p1',
  seed = 1,
  confirm = false,
} = {}) {
  const res = createMatch(
    { mode, randomizeSeats: false, ...config },
    ids(n).map((id) => ({ id, confirmShot: confirm })),
    seed,
  );
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const s = structuredClone(res.state);
  for (const p of s.players) {
    p.hand = hands[p.id] ? hands[p.id].slice() : [];
    if (hp[p.id] !== undefined) p.hp = hp[p.id];
    if (coins[p.id] !== undefined) p.coins = coins[p.id];
    if (chambers) p.privateInfo = null;
  }
  if (chambers) {
    s.round.chambers = chambersFrom(chambers);
    s.round.cursor = 0;
    const live = s.round.chambers.filter((c) => c.type === 'live').length;
    s.round.announced = { total: s.round.chambers.length, live, blank: s.round.chambers.length - live };
  }
  s.turn = { playerId: turn, number: 1, toolsUsed: 0 };
  s.clock = { seq: s.clock.seq, kind: 'shot', playerId: turn };
  return deepFreeze(s);
}

// Applies an action that must be accepted.
export function act(state, action) {
  const res = applyAction(state, action);
  assert.equal(res.ok, true, `expected ${JSON.stringify(action)} to be accepted, got ${JSON.stringify(res.error)}`);
  deepFreeze(res.state);
  return res;
}

// Applies several actions in a row; returns the last state and all events.
export function play(state, ...actions) {
  let current = state;
  const events = [];
  for (const action of actions) {
    const res = act(current, action);
    current = res.state;
    events.push(...res.events);
  }
  return { state: current, events };
}

// Asserts that an action is rejected with the given code and changes nothing.
export function fails(state, action, code) {
  const before = JSON.stringify(state);
  const res = applyAction(state, action);
  assert.equal(res.ok, false, `expected ${JSON.stringify(action)} to be rejected`);
  assert.equal(res.error.code, code);
  assert.equal(res.state, state, 'a rejected action must return the same state object');
  assert.equal(JSON.stringify(state), before, 'a rejected action must not change the state');
  assert.deepEqual(res.events, []);
  return res;
}

export function player(state, id) {
  return state.players.find((p) => p.id === id);
}

export function hpOf(state) {
  const out = {};
  for (const p of state.players) out[p.id] = p.hp;
  return out;
}

export const shoot = (playerId, target) => ({ type: 'chooseTarget', playerId, target });
export const use = (playerId, tool, extra = {}) => ({ type: 'useTool', playerId, tool, ...extra });

export function pubs(events, type) {
  return events.filter((e) => e.visibility === 'public' && (type === undefined || e.type === type));
}

export function privs(events, type, to) {
  return events.filter(
    (e) => e.visibility === 'private' && (type === undefined || e.type === type) && (to === undefined || e.to.includes(to)),
  );
}

export function one(list) {
  assert.equal(list.length, 1, `expected exactly one item, got ${list.length}`);
  return list[0];
}

// Sets fields on a copy of a frozen state: edit(state, (s) => { ... }).
export function edit(state, fn) {
  const copy = structuredClone(state);
  fn(copy);
  return deepFreeze(copy);
}
