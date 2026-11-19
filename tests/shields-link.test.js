// The two shields, the link, and their interactions
// (document: "The two shields", "Double", "Link", safety rule example).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, one, player, hpOf, edit } from './helpers.js';

// Gives players already-active shields / links without playing the turns.
function withShields(state, shields = {}, links = []) {
  return edit(state, (d) => {
    for (const id of Object.keys(shields)) {
      const p = d.players.find((q) => q.id === id);
      for (const kind of shields[id]) p.shields[kind].push(0);
    }
    for (const link of links) d.links.push(link.slice());
  });
}

// --- Shot shield ---------------------------------------------------------------

test('shot shield: blocks the first live shot that hits you and sends it back at the shooter', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), { p2: ['shot'] });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 5 });
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.reflected, true);
  assert.deepEqual(shot.hits, [
    { player: 'p2', result: 'reflected', via: 'direct' },
    { player: 'p1', result: 'damage', amount: 1, hp: 4, via: 'reflect' },
  ]);
  assert.deepEqual(player(state, 'p2').shields.shot, [], 'a shield blocks once and is gone');
  assert.equal(state.turn.playerId, 'p2', 'the turn passes as after any live shot');
});

test('shot shield: starts working only from the next turn (no protection against the player whose turn it is)', () => {
  const s0 = setup({ chambers: 'LLBB', hands: { p2: ['shotShield'] } });
  // Raised during p1's turn: p1's shot still goes through.
  const raised = act(s0, use('p2', 'shotShield')).state;
  assert.deepEqual(viewFor(raised, 'p2').self.shields.shot, [{ active: false }]);
  const hit = act(raised, shoot('p1', 'p2'));
  assert.equal(player(hit.state, 'p2').hp, 4);
  assert.equal(one(pubs(hit.events, 'shot')).reflected, false);
  // The turn has now ended, so the shield is active and reflects p3's shot.
  assert.deepEqual(viewFor(hit.state, 'p2').self.shields.shot, [{ active: true }]);
  const blanked = act(hit.state, shoot('p2', 'p3')).state; // second chamber is live: p3 loses 1
  assert.equal(player(blanked, 'p3').hp, 4);
  const s1 = edit(blanked, (d) => {
    d.round.chambers[d.round.cursor] = { type: 'live', flipped: false };
    d.round.announced = { total: 4, live: 3, blank: 1 };
  });
  const reflected = act(s1, shoot('p3', 'p2'));
  assert.equal(player(reflected.state, 'p2').hp, 4);
  assert.equal(player(reflected.state, 'p3').hp, 3);
});

test('shot shield: raised in your own turn, it does not cover that same turn', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['shotShield'] } });
  const { state } = play(s0, use('p1', 'shotShield'), shoot('p1', 'p1'));
  assert.equal(player(state, 'p1').hp, 4, 'the self shot of the same turn is not absorbed');
  assert.deepEqual(viewFor(state, 'p1').self.shields.shot, [{ active: true }]);
});

test('shot shield: a blank does not use it up', () => {
  const s0 = withShields(setup({ chambers: 'BLB' }), { p2: ['shot'] });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').shields.shot.length, 1);
});

test('shot shield: ends with the reload if it was not used', () => {
  const s0 = withShields(setup({ chambers: 'B' }), { p2: ['shot', 'tool'] });
  const { state } = act(s0, shoot('p1', 'p3'));
  assert.equal(state.round.index, 2);
  assert.deepEqual(player(state, 'p2').shields, { shot: [], tool: [] });
});

test('shot shield: raising it is invisible; others only learn of it when an attack is wasted', () => {
  const s0 = setup({ chambers: 'BLB', hands: { p2: ['shotShield'] } });
  const before = viewFor(s0, 'p1');
  const raised = act(s0, use('p2', 'shotShield'));
  assert.deepEqual(pubs(raised.events), []);
  assert.deepEqual(viewFor(raised.state, 'p1'), before);
  // Other players' entries never carry shield information.
  for (const p of viewFor(raised.state, 'p1').players) assert.equal('shields' in p, false);
  assert.ok(!JSON.stringify(viewFor(raised.state, null)).includes('shields'));
});

test('ricochet happens once: if the shooter is shielded too, both shields are used up and nobody is hurt', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), { p1: ['shot'], p2: ['shot'] });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 5 });
  assert.deepEqual(player(state, 'p1').shields.shot, []);
  assert.deepEqual(player(state, 'p2').shields.shot, []);
  assert.deepEqual(one(pubs(events, 'shot')).hits, [
    { player: 'p2', result: 'reflected', via: 'direct' },
    { player: 'p1', result: 'absorbed', via: 'reflect' },
  ]);
});

test('shot shield on a self shot: the shield absorbs it, nobody is hit back, the turn passes', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), { p1: ['shot'] });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 5, p3: 5 });
  assert.deepEqual(player(state, 'p1').shields.shot, []);
  assert.equal(state.turn.playerId, 'p2');
  assert.deepEqual(one(pubs(events, 'shot')).hits, [{ player: 'p1', result: 'absorbed', via: 'direct' }]);
});

test('double against a shot shield: the whole shot is blocked and comes back in full (shooter loses 2)', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['double'] } }), { p2: ['shot'] });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 3, p2: 5, p3: 5 });
});

test('shot shield: each shield blocks one shot (two shields block two)', () => {
  const s0 = withShields(setup({ chambers: 'LLLB' }), { p3: ['shot', 'shot'] });
  const { state } = play(s0, shoot('p1', 'p3'), shoot('p2', 'p3'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 4, p3: 5 });
  assert.equal(player(act(state, shoot('p3', 'p3')).state, 'p3').hp, 4);
});

// --- Tool shield ---------------------------------------------------------------

test('tool shield: blocks the first tool used against you (jail), which is wasted', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['jail', 'jail'] } }), { p2: ['tool'] });
  const first = act(s0, use('p1', 'jail', { target: 'p2' }));
  assert.equal(player(first.state, 'p2').jailed, false);
  assert.deepEqual(player(first.state, 'p1').hand, ['jail'], 'the tool is spent');
  assert.deepEqual(one(pubs(first.events, 'toolBlocked')), {
    type: 'toolBlocked',
    tool: 'jail',
    by: 'p1',
    blockedBy: ['p2'],
    visibility: 'public',
  });
  // Only the first one: the second jail lands.
  const second = act(first.state, use('p1', 'jail', { target: 'p2' }));
  assert.equal(player(second.state, 'p2').jailed, true);
  assert.equal(pubs(second.events, 'toolBlocked').length, 0);
});

test('tool shield: blocks a link aimed at you', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['link'] } }), { p2: ['tool'] });
  const { state, events } = act(s0, use('p1', 'link', { targets: ['p2', 'p3'] }));
  assert.deepEqual(state.links, []);
  assert.deepEqual(one(pubs(events, 'toolBlocked')).blockedBy, ['p2']);
});

test('tool shield: blocks a hand swap aimed at you', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['handSwap', 'probe'], p2: ['heal'] } }), {
    p2: ['tool'],
  });
  const { state, events } = play(s0, use('p1', 'handSwap'), { type: 'handSwapTarget', playerId: 'p1', target: 'p2' });
  assert.deepEqual(player(state, 'p1').hand, ['probe']);
  assert.deepEqual(player(state, 'p2').hand, ['heal']);
  assert.equal(one(pubs(events, 'toolBlocked')).tool, 'handSwap');
});

test('tool shield: blocks a steal aimed at you (the thief sees nothing)', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['steal', 'probe'], p2: ['heal'] } }), {
    p2: ['tool'],
  });
  const { state, events } = act(s0, use('p1', 'steal', { target: 'p2' }));
  assert.deepEqual(state.phase, { type: 'turn' });
  assert.equal(one(pubs(events, 'toolBlocked')).tool, 'steal');
  assert.ok(!JSON.stringify(events).includes('heal'));
  assert.equal(viewFor(state, 'p1').self.pending, null);
});

test('tool shield: works from the next turn only, and ends with the reload', () => {
  const s0 = setup({ chambers: 'BBB', hands: { p1: ['jail'], p2: ['toolShield'], p3: ['jail'] } });
  const raised = act(s0, use('p2', 'toolShield')).state;
  const jailed = act(raised, use('p1', 'jail', { target: 'p2' }));
  assert.equal(player(jailed.state, 'p2').jailed, true, 'no protection during the turn it was raised in');
  assert.equal(player(jailed.state, 'p2').shields.tool.length, 1);
  // p1 fires; p2 is skipped (jailed); now it is p3's turn and the shield is active.
  const p3turn = act(jailed.state, shoot('p1', 'p3')).state;
  assert.equal(p3turn.turn.playerId, 'p3');
  const blocked = act(p3turn, use('p3', 'jail', { target: 'p2' }));
  assert.equal(player(blocked.state, 'p2').jailed, false);
  assert.equal(pubs(blocked.events, 'toolBlocked').length, 1);
});

test('tool shield: covers only tools used against you by others (link, jail, hand swap, steal)', () => {
  const s0 = withShields(
    setup({ chambers: 'LBBB', hands: { p1: ['shuffle', 'reverse', 'double', 'link'] }, config: { toolsPerTurn: 9 } }),
    { p1: ['tool'], p2: ['tool'] },
  );
  const { state, events } = play(
    s0,
    use('p1', 'shuffle'),
    use('p1', 'reverse'),
    use('p1', 'double'),
    // Linking yourself to someone unshielded: your own shield is not triggered.
    use('p1', 'link', { targets: ['p1', 'p3'] }),
  );
  assert.equal(pubs(events, 'toolBlocked').length, 0);
  assert.equal(player(state, 'p1').shields.tool.length, 1);
  assert.equal(player(state, 'p2').shields.tool.length, 1);
  assert.deepEqual(state.links, [['p1', 'p3']]);
});

test('tool shield: a link aimed at two shielded players uses up both shields', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['link'] } }), { p2: ['tool'], p3: ['tool'] });
  const { state, events } = act(s0, use('p1', 'link', { targets: ['p2', 'p3'] }));
  assert.deepEqual(one(pubs(events, 'toolBlocked')).blockedBy, ['p2', 'p3']);
  assert.deepEqual(player(state, 'p2').shields.tool, []);
  assert.deepEqual(player(state, 'p3').shields.tool, []);
  assert.deepEqual(state.links, []);
});

test('tool shield: does not react to shots, and a shot shield does not react to tools', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['jail'] } }), { p2: ['tool'], p3: ['shot'] });
  const jailed = act(s0, use('p1', 'jail', { target: 'p3' })).state;
  assert.equal(player(jailed, 'p3').jailed, true);
  assert.equal(player(jailed, 'p3').shields.shot.length, 1);
  const shot = act(jailed, shoot('p1', 'p2')).state;
  assert.equal(player(shot, 'p2').hp, 4);
  assert.equal(player(shot, 'p2').shields.tool.length, 1);
});

// --- Link ----------------------------------------------------------------------

test('link: ties two players, is announced with both names, and may include yourself', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['link', 'link'] } });
  const first = act(s0, use('p1', 'link', { targets: ['p2', 'p3'] }));
  assert.deepEqual(one(pubs(first.events, 'toolUsed')), {
    type: 'toolUsed',
    tool: 'link',
    by: 'p1',
    targets: ['p2', 'p3'],
    visibility: 'public',
  });
  const second = act(first.state, use('p1', 'link', { targets: ['p1', 'p4'] }));
  assert.deepEqual(second.state.links, [
    ['p2', 'p3'],
    ['p1', 'p4'],
  ]);
  assert.deepEqual(viewFor(second.state, 'p4').links, second.state.links);
});

test('link: needs two different living players', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['link'] } });
  s0 = edit(s0, (d) => {
    d.players[3].alive = false;
    d.players[3].hp = 0;
  });
  fails(s0, use('p1', 'link', { targets: ['p2', 'p2'] }), ERR.INVALID_TARGET);
  fails(s0, use('p1', 'link', { targets: ['p2'] }), ERR.INVALID_TARGET);
  fails(s0, use('p1', 'link', { targets: ['p2', 'p4'] }), ERR.INVALID_TARGET);
  fails(s0, use('p1', 'link', { target: 'p2' }), ERR.INVALID_TARGET);
});

test('link: what hits one hits the other, when a third player shoots', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), {}, [['p2', 'p3']]);
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 4 });
  assert.deepEqual(one(pubs(events, 'shot')).hits, [
    { player: 'p2', result: 'damage', amount: 1, hp: 4, via: 'direct' },
    { player: 'p3', result: 'damage', amount: 1, hp: 4, via: 'link' },
  ]);
});

test('link: what hits one hits the other, when one of them shoots themself', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), {}, [['p1', 'p3']]);
  const { state } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 4 });
});

test('link: one linked player shooting the other hurts both', () => {
  const s0 = withShields(setup({ chambers: 'LBB' }), {}, [['p1', 'p2']]);
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 4, p3: 5 });
});

test('link: a blank hurts nobody', () => {
  const s0 = withShields(setup({ chambers: 'BLB' }), {}, [['p2', 'p3']]);
  assert.deepEqual(hpOf(act(s0, shoot('p1', 'p2')).state), { p1: 5, p2: 5, p3: 5 });
});

test('double + link: the damage is copied as is - two points each, four in one shot', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['double'] } }), {}, [['p2', 'p3']]);
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 3, p3: 3 });
});

test('link: lasts until the end of the reload', () => {
  const s0 = withShields(setup({ chambers: 'BL' }), {}, [['p2', 'p3']]);
  const mid = act(s0, shoot('p1', 'p1')).state;
  assert.equal(mid.links.length, 1);
  const { state, events } = act(mid, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 4 });
  assert.equal(pubs(events, 'reloaded').length, 1);
  assert.deepEqual(state.links, []);
  assert.deepEqual(viewFor(state, 'p1').links, []);
});

test('link + shield: a reflected shot is ordinary damage - the shooter\'s linked partner is hurt too', () => {
  const s0 = withShields(setup({ n: 4, chambers: 'LBBB' }), { p2: ['shot'] }, [['p1', 'p3']]);
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 4, p4: 5 });
  assert.deepEqual(one(pubs(events, 'shot')).hits, [
    { player: 'p2', result: 'reflected', via: 'direct' },
    { player: 'p1', result: 'damage', amount: 1, hp: 4, via: 'reflect' },
    { player: 'p3', result: 'damage', amount: 1, hp: 4, via: 'link' },
  ]);
});

test('link + shield: damage reaching a shielded partner through the link is bounced at the shooter; the unshielded target is still hurt', () => {
  const s0 = withShields(setup({ n: 4, chambers: 'LBBB' }), { p3: ['shot'] }, [['p2', 'p3']]);
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 4, p3: 5, p4: 5 });
  assert.deepEqual(player(state, 'p3').shields.shot, []);
  const shot = one(pubs(events, 'shot'));
  assert.equal(shot.reflected, false, 'the aimed target itself was hit, so this is not a bounced shot');
  assert.deepEqual(shot.hits, [
    { player: 'p2', result: 'damage', amount: 1, hp: 4, via: 'direct' },
    { player: 'p3', result: 'reflected', via: 'link' },
    { player: 'p1', result: 'damage', amount: 1, hp: 4, via: 'reflect' },
  ]);
});

test('safety rule example: two linked players, one shielded; the unshielded one fires a live at themself', () => {
  // "He loses one point only. The shielded one is unharmed and his shield is used up."
  const s0 = withShields(setup({ chambers: 'LBB' }), { p2: ['shot'] }, [['p1', 'p2']]);
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 5, p3: 5 });
  assert.deepEqual(player(state, 'p2').shields.shot, []);
  assert.deepEqual(one(pubs(events, 'shot')).hits, [
    { player: 'p1', result: 'damage', amount: 1, hp: 4, via: 'direct' },
    { player: 'p2', result: 'reflected', via: 'link' },
  ]);
});

test('safety rule: one shot never hits the same player twice, even through a ring of links', () => {
  const s0 = withShields(setup({ n: 4, chambers: 'LBBB' }), {}, [
    ['p2', 'p3'],
    ['p3', 'p4'],
    ['p4', 'p2'],
  ]);
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 4, p4: 4 });
});

test('several links: damage travels along a chain of links (A-B and B-C)', () => {
  const s0 = withShields(setup({ n: 5, chambers: 'LBBBB' }), {}, [
    ['p2', 'p3'],
    ['p3', 'p4'],
  ]);
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 4, p4: 4, p5: 5 });
});

test('shield + link combo: a shielded player linked to another bounces every shot that hits the other', () => {
  // Document note: "the protected one who links himself to another player
  // reflects every shot that hits that other".
  const s0 = withShields(setup({ n: 4, chambers: 'LBBB' }), { p4: ['shot'] }, [['p4', 'p2']]);
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 4, p2: 4, p3: 5, p4: 5 });
});

test('link: a shielded shooter is safe from a shot bounced through a link', () => {
  const s0 = withShields(setup({ n: 4, chambers: 'LBBB' }), { p1: ['shot'], p3: ['shot'] }, [['p2', 'p3']]);
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 5, p4: 5 });
  assert.deepEqual(player(state, 'p1').shields.shot, []);
  assert.deepEqual(player(state, 'p3').shields.shot, []);
});

test('link: linking the same pair twice changes nothing', () => {
  const s0 = withShields(setup({ chambers: 'LBB', hands: { p1: ['link'] } }), {}, [['p2', 'p3']]);
  const { state } = play(s0, use('p1', 'link', { targets: ['p3', 'p2'] }), shoot('p1', 'p2'));
  assert.deepEqual(hpOf(state), { p1: 5, p2: 4, p3: 4 });
});
