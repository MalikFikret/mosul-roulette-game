// General tool rules and the simple tools (document: "Tools: general rules",
// "Tools table", "Double", "Flip", "Skip").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor, validateConfig, defaultConfig } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, hpOf, edit } from './helpers.js';

const types = (state) => state.round.chambers.map((c) => (c.type === 'live' ? 'L' : 'B')).join('');

// --- General rules -----------------------------------------------------------

test('tools: a tool must be in your hand, and using it consumes it', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['detector', 'detector'] } });
  fails(s0, use('p1', 'probe'), ERR.TOOL_NOT_IN_HAND);
  fails(s0, use('p1', 'laser'), ERR.UNKNOWN_TOOL);
  fails(s0, use('p1'), ERR.UNKNOWN_TOOL);
  const { state } = act(s0, use('p1', 'detector'));
  assert.deepEqual(player(state, 'p1').hand, ['detector']);
});

test('tools: "your turn" tools are rejected outside your turn', () => {
  const turnTools = [
    'detector',
    'probe',
    'counter',
    'skip',
    'swap',
    'flip',
    'shuffle',
    'double',
    'reverse',
    'link',
    'jail',
    'handSwap',
    'steal',
  ];
  const s0 = setup({ chambers: 'LBB', hands: { p2: turnTools } });
  for (const tool of turnTools) {
    fails(s0, use('p2', tool, { target: 'p1', targets: ['p1', 'p3'] }), ERR.NOT_YOUR_TURN);
  }
});

test('tools: "anytime" tools work during other players\' turns', () => {
  const s0 = setup({ chambers: 'LBB', hp: { p2: 3 }, hands: { p2: ['shotShield', 'toolShield', 'heal'] } });
  const { state } = play(s0, use('p2', 'shotShield'), use('p2', 'toolShield'), use('p2', 'heal'));
  assert.deepEqual(player(state, 'p2').hand, []);
  assert.equal(player(state, 'p2').hp, 4);
  assert.equal(state.turn.playerId, 'p1');
});

test('tools: at most 3 tools per turn by default', () => {
  const s0 = setup({ chambers: 'LBBB', hands: { p1: ['detector', 'probe', 'counter', 'flip'] } });
  const { state } = play(s0, use('p1', 'detector'), use('p1', 'probe'), use('p1', 'counter'));
  fails(state, use('p1', 'flip'), ERR.TOOL_LIMIT_REACHED);
  assert.equal(viewFor(state, 'p1').self.toolsUsedThisTurn, 3);
});

test('tools: the per-turn limit is a host setting', () => {
  const s0 = setup({ config: { toolsPerTurn: 1 }, chambers: 'LBBB', hands: { p1: ['detector', 'probe'] } });
  const { state } = act(s0, use('p1', 'detector'));
  fails(state, use('p1', 'probe'), ERR.TOOL_LIMIT_REACHED);
  const none = setup({ config: { toolsPerTurn: 0 }, chambers: 'LBBB', hands: { p1: ['detector'] } });
  fails(none, use('p1', 'detector'), ERR.TOOL_LIMIT_REACHED);
});

test('tools: the limit covers the whole turn (a blank on self does not reset it) and resets next turn', () => {
  const s0 = setup({ chambers: 'BBBBBBBB', hands: { p1: ['detector', 'probe', 'counter', 'flip', 'flip'] } });
  const midTurn = play(s0, use('p1', 'detector'), use('p1', 'probe'), shoot('p1', 'p1'), use('p1', 'counter')).state;
  assert.equal(midTurn.turn.playerId, 'p1');
  fails(midTurn, use('p1', 'flip'), ERR.TOOL_LIMIT_REACHED);
  // Around the table and back to p1: a fresh allowance.
  const nextTurn = play(midTurn, shoot('p1', 'p2'), shoot('p2', 'p3'), shoot('p3', 'p1')).state;
  assert.equal(nextTurn.turn.playerId, 'p1');
  assert.equal(nextTurn.turn.toolsUsed, 0);
  act(nextTurn, use('p1', 'flip'));
});

test('tools: anytime tools used outside your turn do not count against your limit', () => {
  const s0 = setup({
    config: { toolsPerTurn: 1 },
    chambers: 'BBBBBB',
    hp: { p2: 1 },
    hands: { p2: ['heal', 'heal', 'shotShield', 'toolShield', 'detector'] },
  });
  // Four anytime tools during p1's turn...
  const during = play(s0, use('p2', 'heal'), use('p2', 'heal'), use('p2', 'shotShield'), use('p2', 'toolShield')).state;
  assert.equal(during.turn.toolsUsed, 0, "p1's counter is untouched by p2's tools");
  // ...and p2 still has the full allowance in their own turn.
  const own = act(during, shoot('p1', 'p3')).state;
  assert.equal(own.turn.playerId, 'p2');
  act(own, use('p2', 'detector'));
});

test('tools: anytime tools used in your own turn DO count against your limit', () => {
  const s0 = setup({
    config: { toolsPerTurn: 2 },
    chambers: 'BBBBBB',
    hp: { p1: 1 },
    hands: { p1: ['heal', 'shotShield', 'heal'] },
  });
  const { state } = play(s0, use('p1', 'heal'), use('p1', 'shotShield'));
  fails(state, use('p1', 'heal'), ERR.TOOL_LIMIT_REACHED);
});

test('tools: hidden tools are completely silent (no public event, nothing changes for the others)', () => {
  const hidden = ['detector', 'probe', 'counter', 'skip', 'swap', 'flip', 'shotShield', 'toolShield'];
  for (const tool of hidden) {
    const s0 = setup({ chambers: 'LBLB', hands: { p1: [tool] } });
    const before = { p2: viewFor(s0, 'p2'), p3: viewFor(s0, 'p3'), spectator: viewFor(s0, null) };
    const { state, events } = act(s0, use('p1', tool));
    assert.deepEqual(pubs(events), [], `${tool} must not produce a public event`);
    for (const e of events) assert.deepEqual(e.to, ['p1'], `${tool} events go to the user only`);
    assert.ok(events.length >= 1, 'the user gets a private receipt');
    assert.deepEqual(viewFor(state, 'p2'), before.p2, `${tool} must not change another player's view`);
    assert.deepEqual(viewFor(state, 'p3'), before.p3);
    assert.deepEqual(viewFor(state, null), before.spectator);
  }
});

test('tools: announced tools produce a public event naming the user', () => {
  const cases = [
    ['shuffle', {}],
    ['double', {}],
    ['reverse', {}],
    ['link', { targets: ['p2', 'p3'] }],
    ['jail', { target: 'p2' }],
    ['steal', { target: 'p2' }],
    ['heal', {}],
  ];
  for (const [tool, extra] of cases) {
    const s0 = setup({ chambers: 'LBLB', hp: { p1: 3 }, hands: { p1: [tool] } });
    const { events } = act(s0, use('p1', tool, extra));
    const e = one(pubs(events, 'toolUsed'));
    assert.equal(e.tool, tool);
    assert.equal(e.by, 'p1');
  }
});

// --- Detector / probe / counter ----------------------------------------------

test('detector: reveals the type of the current chamber to the user only', () => {
  for (const [order, expected] of [
    ['LBB', 'live'],
    ['BLL', 'blank'],
  ]) {
    const s0 = setup({ chambers: order, hands: { p1: ['detector'] } });
    const { state, events } = act(s0, use('p1', 'detector'));
    const e = one(events);
    assert.deepEqual(e, { type: 'toolUsed', tool: 'detector', by: 'p1', chamber: expected, visibility: 'private', to: ['p1'] });
    assert.equal(state.round.cursor, 0, 'looking does not consume the chamber');
  }
});

test('probe: tells whether the current chamber and the next are the same kind or different', () => {
  const result = (order) => {
    const s0 = setup({ chambers: order, hands: { p1: ['probe'] } });
    return one(act(s0, use('p1', 'probe')).events).result;
  };
  assert.equal(result('LLB'), 'same');
  assert.equal(result('BBL'), 'same');
  assert.equal(result('LBL'), 'different');
  assert.equal(result('BLL'), 'different');
});

test('probe: on the last chamber of a reload there is no next chamber to compare', () => {
  let s0 = setup({ chambers: 'BL', hands: { p1: ['probe'] } });
  s0 = edit(s0, (d) => {
    d.round.cursor = 1;
  });
  const { state, events } = act(s0, use('p1', 'probe'));
  assert.equal(one(events).result, 'noNext');
  assert.deepEqual(player(state, 'p1').hand, [], 'the tool is still spent');
});

test('counter: tells how many live chambers are among the next three', () => {
  const count = (order, cursor = 0) => {
    let s0 = setup({ chambers: order, hands: { p1: ['counter'] } });
    s0 = edit(s0, (d) => {
      d.round.cursor = cursor;
    });
    const e = one(act(s0, use('p1', 'counter')).events);
    return [e.live, e.examined];
  };
  assert.deepEqual(count('LLLB'), [3, 3]);
  assert.deepEqual(count('LBLL'), [2, 3]);
  assert.deepEqual(count('BBBL'), [0, 3]);
  assert.deepEqual(count('BBLLB', 1), [2, 3]);
});

test('counter: with fewer than three chambers left it counts what remains', () => {
  const run = (order, cursor) => {
    let s0 = setup({ chambers: order, hands: { p1: ['counter'] } });
    s0 = edit(s0, (d) => {
      d.round.cursor = cursor;
    });
    const e = one(act(s0, use('p1', 'counter')).events);
    return [e.live, e.examined];
  };
  assert.deepEqual(run('BBLL', 2), [2, 2]);
  assert.deepEqual(run('BBLB', 3), [0, 1]);
  assert.deepEqual(run('BL', 1), [1, 1]);
});

// --- Skip ----------------------------------------------------------------------

test('skip: passes over the current chamber without firing; the turn stays; the type is revealed to the user only', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['skip'] } });
  const { state, events } = act(s0, use('p1', 'skip'));
  assert.equal(state.round.cursor, 1);
  assert.equal(state.round.shots, 0, 'a skipped chamber is not a shot');
  assert.equal(state.turn.playerId, 'p1');
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 5 });
  assert.deepEqual(one(events), { type: 'toolUsed', tool: 'skip', by: 'p1', chamber: 'live', visibility: 'private', to: ['p1'] });
  assert.equal(state.clock.seq, s0.clock.seq, 'skipping does not restart the shot timer');
  // The next shot uses the following chamber.
  const next = act(state, shoot('p1', 'p2'));
  assert.equal(one(pubs(next.events, 'shot')).effect, 'blank');
});

test('skip on the last chamber: the roulette reloads at once and the same player keeps the turn', () => {
  const s0 = setup({ chambers: 'L', hands: { p1: ['skip'] } });
  const { state, events } = act(s0, use('p1', 'skip'));
  assert.equal(state.round.index, 2);
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, 1);
  assert.equal(one(pubs(events, 'roundEnded')).shots, 0);
  assert.equal(pubs(events, 'reloaded').length, 1);
  assert.equal(pubs(events, 'toolUsed').length, 0, 'still no trace of the skip itself');
});

test('skip: a pending double is kept for the next real shot', () => {
  const s0 = setup({ chambers: 'BLB', hands: { p1: ['double', 'skip'] } });
  const { state } = play(s0, use('p1', 'double'), use('p1', 'skip'));
  assert.equal(state.doublePending, true);
  assert.equal(player(act(state, shoot('p1', 'p2')).state, 'p2').hp, 3);
});

// --- Swap ----------------------------------------------------------------------

test('swap: exchanges the current chamber with the next one and reveals neither', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['swap'] } });
  const { state, events } = act(s0, use('p1', 'swap'));
  assert.equal(types(state), 'BLB');
  const e = one(events);
  assert.deepEqual(e, { type: 'toolUsed', tool: 'swap', by: 'p1', swapped: true, visibility: 'private', to: ['p1'] });
  assert.equal(state.round.cursor, 0);
});

test('swap: on the last chamber there is nothing to swap with (the tool is spent)', () => {
  let s0 = setup({ chambers: 'BL', hands: { p1: ['swap'] } });
  s0 = edit(s0, (d) => {
    d.round.cursor = 1;
  });
  const { state, events } = act(s0, use('p1', 'swap'));
  assert.equal(types(state), 'BL');
  assert.equal(one(events).swapped, false);
  assert.deepEqual(player(state, 'p1').hand, []);
});

// --- Flip ----------------------------------------------------------------------

test('flip: a live chamber acts as a blank', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['flip'] } });
  const { state, events } = play(s0, use('p1', 'flip'), shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 5);
  assert.equal(one(pubs(events, 'shot')).effect, 'blank');
});

test('flip: a blank chamber acts as a live one', () => {
  const s0 = setup({ chambers: 'BLL', hands: { p1: ['flip'] } });
  const { state, events } = play(s0, use('p1', 'flip'), shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 4);
  assert.equal(one(pubs(events, 'shot')).effect, 'live');
});

test('flip: everyone is shown the effect, never the original type', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['flip'] } });
  const { events } = play(s0, use('p1', 'flip'), shoot('p1', 'p2'));
  const publicJson = JSON.stringify(pubs(events));
  assert.ok(!publicJson.includes('flip'), 'no public trace of the flip');
  assert.ok(!publicJson.includes('chamberType'));
  // The true type exists only in the audit record addressed to nobody.
  const audit = one(privs(events, 'shotAudit'));
  assert.deepEqual(audit.to, []);
  assert.equal(audit.chamberType, 'live');
  assert.equal(audit.flipped, true);
});

test('flip: the real remaining live/blank counts do not change', () => {
  const s0 = setup({ chambers: 'LBBL', hands: { p1: ['flip'] } });
  const { state } = play(s0, use('p1', 'flip'), shoot('p1', 'p2'));
  assert.equal(types(state), 'LBBL');
  assert.deepEqual(state.round.announced, { total: 4, live: 2, blank: 2 });
  // The detector still reports the true type of a flipped chamber.
  const s1 = setup({ chambers: 'LBB', hands: { p1: ['flip', 'detector'] } });
  const seen = play(s1, use('p1', 'flip'), use('p1', 'detector')).events;
  assert.equal(seen[1].chamber, 'live');
});

test('flip: a flipped live on yourself behaves as a blank (no damage, the turn stays)', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['flip'] } });
  const { state } = play(s0, use('p1', 'flip'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').hp, 5);
  assert.equal(state.turn.playerId, 'p1');
});

test('flip: a flipped blank on yourself behaves as a live (damage, the turn passes)', () => {
  const s0 = setup({ chambers: 'BLL', hands: { p1: ['flip'] } });
  const { state } = play(s0, use('p1', 'flip'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
});

test('flip: using it twice on the same chamber cancels out', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['flip', 'flip'] } });
  const { state, events } = play(s0, use('p1', 'flip'), use('p1', 'flip'), shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 4);
  assert.equal(one(pubs(events, 'shot')).effect, 'live');
});

test('flip: the mark belongs to the chamber (a skipped flipped chamber takes the flip with it)', () => {
  const s0 = setup({ chambers: 'LLB', hands: { p1: ['flip', 'skip'] } });
  const { state, events } = play(s0, use('p1', 'flip'), use('p1', 'skip'), shoot('p1', 'p2'));
  assert.equal(one(pubs(events, 'shot')).effect, 'live');
  assert.equal(player(state, 'p2').hp, 4);
  // ...and it travels with the chamber when swapped.
  const s1 = setup({ chambers: 'LLB', hands: { p1: ['flip', 'swap'] } });
  const swapped = play(s1, use('p1', 'flip'), use('p1', 'swap')).state;
  assert.deepEqual(
    swapped.round.chambers.map((c) => c.flipped),
    [false, true, false],
  );
});

// --- Shuffle -------------------------------------------------------------------

test('shuffle: randomly reorders the remaining chambers only, and is announced', () => {
  let changed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    let s0 = setup({ chambers: 'LBLLBBLBLB', hands: { p1: ['shuffle'] }, seed });
    s0 = edit(s0, (d) => {
      d.round.cursor = 3;
    });
    const { state, events } = act(s0, use('p1', 'shuffle'));
    assert.deepEqual(one(pubs(events, 'toolUsed')), { type: 'toolUsed', tool: 'shuffle', by: 'p1', visibility: 'public' });
    assert.equal(types(state).slice(0, 3), 'LBL', 'chambers already played are untouched');
    assert.equal(types(state).slice(3).split('').sort().join(''), 'BBBBLLL', 'same chambers, new order');
    assert.equal(state.round.cursor, 3);
    if (types(state) !== types(s0)) changed += 1;
  }
  assert.ok(changed > 15, 'the order actually changes');
});

// --- Double --------------------------------------------------------------------

test('double: the next shot deals two points if the chamber is live', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['double'] } });
  const used = act(s0, use('p1', 'double'));
  assert.equal(used.state.doublePending, true);
  assert.equal(viewFor(used.state, 'p3').doublePending, true, 'announced');
  const { state, events } = act(used.state, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 3);
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.doubled, true);
  assert.equal(shot.hits[0].amount, 2);
  assert.equal(state.doublePending, false);
});

test('double: is consumed by the first shot after it whatever the result or target', () => {
  const s0 = setup({ chambers: 'BLL', hands: { p1: ['double'] } });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.equal(state.doublePending, false);
  assert.equal(player(state, 'p2').hp, 5);
  // The following live shot is back to one point.
  assert.equal(player(act(state, shoot('p2', 'p3')).state, 'p3').hp, 4);
});

test('double on yourself, live: you lose two points and the turn passes', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['double'] } });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').hp, 3);
  assert.equal(state.turn.playerId, 'p2');
  assert.equal(state.doublePending, false);
});

test('double on yourself, blank: no harm, you keep the turn, and the double is gone', () => {
  const s0 = setup({ chambers: 'BLB', hands: { p1: ['double'] } });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').hp, 5);
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.doublePending, false);
  assert.equal(player(act(state, shoot('p1', 'p2')).state, 'p2').hp, 4);
});

test('double: cannot be stacked on an already doubled shot', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['double', 'double'] } });
  const { state } = act(s0, use('p1', 'double'));
  fails(state, use('p1', 'double'), ERR.DOUBLE_ALREADY_ACTIVE);
});

test('double: a timeout shot consumes it too', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['double'] } });
  const { state } = play(s0, use('p1', 'double'), { type: 'timeout' });
  assert.equal(player(state, 'p1').hp, 3);
  assert.equal(state.doublePending, false);
});

test('double: never takes life points below zero', () => {
  const s0 = setup({ n: 4, chambers: 'LBB', hp: { p2: 1 }, hands: { p1: ['double'] } });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').hp, 0);
  assert.equal(player(state, 'p2').alive, false);
});

// --- Reverse -------------------------------------------------------------------

test('reverse: flips the direction of play and is announced', () => {
  const s0 = setup({ n: 4, chambers: 'BBBBBB', hands: { p1: ['reverse'], p4: ['reverse'] } });
  const used = act(s0, use('p1', 'reverse'));
  assert.equal(used.state.direction, -1);
  assert.equal(one(pubs(used.events, 'toolUsed')).direction, -1);
  assert.equal(viewFor(used.state, 'p2').direction, -1);
  const afterShot = act(used.state, shoot('p1', 'p2')).state;
  assert.equal(afterShot.turn.playerId, 'p4');
  const back = play(afterShot, use('p4', 'reverse'), shoot('p4', 'p2')).state;
  assert.equal(back.direction, 1);
  assert.equal(back.turn.playerId, 'p1');
});

// --- Heal ----------------------------------------------------------------------

test('heal: restores one life point, at any time, and is announced', () => {
  const s0 = setup({ chambers: 'LBB', hp: { p3: 2 }, hands: { p3: ['heal'] } });
  const { state, events } = act(s0, use('p3', 'heal'));
  assert.equal(player(state, 'p3').hp, 3);
  assert.deepEqual(one(pubs(events, 'toolUsed')), { type: 'toolUsed', tool: 'heal', by: 'p3', hp: 3, visibility: 'public' });
});

test('heal at full life is rejected (the tool is kept)', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['heal'] } });
  fails(s0, use('p1', 'heal'), ERR.HP_FULL);
  // One below full: heals back to the starting value, never above.
  const hurt = edit(s0, (d) => {
    d.players[0].hp = 4;
  });
  const healed = act(hurt, use('p1', 'heal')).state;
  assert.equal(player(healed, 'p1').hp, 5);
  fails(healed, use('p1', 'heal'), ERR.TOOL_NOT_IN_HAND);
});

test('heal: healCanExceedStartHp is rejected as an unknown config field', () => {
  const res = validateConfig({ healCanExceedStartHp: true });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, [{ field: 'healCanExceedStartHp', message: 'unknown config field' }]);
  assert.equal('healCanExceedStartHp' in defaultConfig('classic'), false);
  assert.equal('healCanExceedStartHp' in defaultConfig('custom'), false);
});

test('heal: an eliminated player cannot heal', () => {
  let s0 = setup({ n: 4, chambers: 'LBB' });
  s0 = edit(s0, (d) => {
    d.players[3].alive = false;
    d.players[3].hp = 0;
    d.players[3].hand = ['heal'];
  });
  fails(s0, use('p4', 'heal'), ERR.PLAYER_ELIMINATED);
});
