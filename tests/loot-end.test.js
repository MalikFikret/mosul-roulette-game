// Elimination, loot ownership, and the end of the match
// (document: "Elimination and loot", "End of the match").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor, listLegalActions } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, edit } from './helpers.js';

const loot = (playerId, choice) => ({ type: 'lootChoice', playerId, choice });
const takeTool = (playerId, tool) => loot(playerId, { kind: 'tool', tool });

function prepared(state, { shields = {}, links = [] } = {}) {
  return edit(state, (d) => {
    for (const id of Object.keys(shields)) d.players.find((p) => p.id === id).shields.shot.push(0);
    for (const link of links) d.links.push(link.slice());
  });
}

// --- Elimination -----------------------------------------------------------------

test('elimination: a player whose life points run out leaves the match and becomes a spectator', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(player(state, 'p2').alive, false);
  assert.deepEqual(one(pubs(events, 'eliminated')), { type: 'eliminated', player: 'p2', by: 'p1', round: 1, visibility: 'public' });
  assert.equal(viewFor(state, 'p2').role, 'eliminated');
  assert.equal(viewFor(state, 'p2').self, null);
  assert.deepEqual(listLegalActions(state, 'p2'), []);
  fails(state, shoot('p2', 'p1'), ERR.PLAYER_ELIMINATED);
});

test('elimination: the spectator sees only what everyone sees - no chambers, hands or shields', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['flip'], p3: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].shields.shot.push(0);
  });
  const dead = play(s0, shoot('p1', 'p2'), loot('p1', { kind: 'none' })).state;
  const ghostView = viewFor(dead, 'p2');
  const outsider = viewFor(dead, null);
  assert.deepEqual({ ...ghostView, viewer: null, role: 'spectator' }, outsider);
});

// --- Loot ------------------------------------------------------------------------

test('loot: the shooter takes one tool from the player they eliminated; the rest leaves the game', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p1: ['probe'], p2: ['heal', 'jail', 'link'] } });
  const shot = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(shot.state.phase, { type: 'loot', queue: [{ looter: 'p1', victim: 'p2' }] });
  assert.deepEqual(viewFor(shot.state, 'p1').self.pending, {
    type: 'loot',
    victim: 'p2',
    tools: ['heal', 'jail', 'link'],
    coinsOption: false,
  });
  const { state } = act(shot.state, takeTool('p1', 'jail'));
  assert.deepEqual(player(state, 'p1').hand, ['probe', 'jail']);
  assert.deepEqual(player(state, 'p2').hand, [], 'the other tools are gone');
  assert.equal(state.turn.playerId, 'p3', 'the turn passes once the loot is settled (dead p2 is skipped)');
});

test('loot: it is secret - others learn neither what the victim held nor what was taken', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail', 'link'] } });
  const shot = act(s0, shoot('p1', 'p2'));
  const done = act(shot.state, takeTool('p1', 'link'));
  const publicJson = JSON.stringify(pubs([...shot.events, ...done.events]));
  for (const secret of ['heal', 'jail', 'link']) assert.ok(!publicJson.includes(secret));
  assert.deepEqual(pubs(done.events, 'lootResolved'), [{ type: 'lootResolved', looter: 'p1', victim: 'p2', visibility: 'public' }]);
  // Only the looter got the list and the result.
  assert.deepEqual(one(privs(shot.events, 'lootOffer')).to, ['p1']);
  assert.deepEqual(one(privs(done.events, 'lootResult')).to, ['p1']);
  for (const other of ['p2', 'p3', 'p4', null]) {
    const view = viewFor(shot.state, other);
    assert.deepEqual(view.phase, { type: 'loot', queue: [{ looter: 'p1', victim: 'p2' }] });
    if (view.self) assert.equal(view.self.pending, null);
  }
});

test('loot: an empty-handed victim still opens the loot step, so hand sizes are not revealed', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 } });
  const shot = act(s0, shoot('p1', 'p2'));
  assert.equal(shot.state.phase.type, 'loot');
  assert.deepEqual(viewFor(shot.state, 'p1').self.pending.tools, []);
  const { state } = act(shot.state, loot('p1', { kind: 'none' }));
  assert.equal(state.turn.playerId, 'p3');
});

test('loot: only the looter may choose, only among the victim\'s tools, only one', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  fails(pending, takeTool('p3', 'heal'), ERR.NOT_LOOTER);
  fails(pending, takeTool('p1', 'link'), ERR.INVALID_CHOICE);
  fails(pending, loot('p1', { kind: 'coins' }), ERR.INVALID_CHOICE);
  fails(pending, loot('p1', { kind: 'everything' }), ERR.INVALID_CHOICE);
  fails(pending, loot('p1'), ERR.INVALID_ACTION);
  fails(pending, shoot('p1', 'p3'), ERR.WRONG_PHASE);
  fails(s0, takeTool('p1', 'heal'), ERR.WRONG_PHASE);
  const done = act(pending, takeTool('p1', 'heal')).state;
  fails(done, takeTool('p1', 'jail'), ERR.WRONG_PHASE);
});

test('loot timeout: a looter who does not choose in time gets nothing', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal', 'jail'] } });
  const pending = act(s0, shoot('p1', 'p2')).state;
  assert.deepEqual({ kind: pending.clock.kind, playerId: pending.clock.playerId }, { kind: 'loot', playerId: 'p1' });
  const { state, events } = act(pending, { type: 'timeout' });
  assert.deepEqual(player(state, 'p1').hand, []);
  assert.deepEqual(player(state, 'p2').hand, []);
  assert.equal(pubs(events, 'shot').length, 0, 'a loot timeout fires nothing');
  assert.equal(one(pubs(events, 'timedOut')).kind, 'loot');
  assert.equal(one(privs(events, 'lootResult')).forfeited, true);
  assert.equal(state.turn.playerId, 'p3');
});

test('loot ownership: a death through a link belongs to the shooter, not to whoever made the link', () => {
  // p3 made the link (p2-p4); p1 fires at p2 and p4 dies through the link.
  const s0 = setup({ n: 5, chambers: 'LBBBB', hp: { p4: 1 }, hands: { p3: ['link'], p4: ['heal'] }, turn: 'p3' });
  const linked = play(s0, use('p3', 'link', { targets: ['p2', 'p4'] }), shoot('p3', 'p3')).state; // live on self, turn passes
  const s1 = edit(linked, (d) => {
    d.round.chambers[d.round.cursor] = { type: 'live', flipped: false };
    d.round.announced = { total: 5, live: 2, blank: 3 };
    d.turn.playerId = 'p1';
    d.clock.playerId = 'p1';
  });
  const { state, events } = act(s1, shoot('p1', 'p2'));
  assert.equal(one(pubs(events, 'eliminated')).by, 'p1');
  assert.deepEqual(state.phase.queue, [{ looter: 'p1', victim: 'p4' }]);
});

test('loot ownership: firing at yourself and killing your linked partner - you loot if you survive', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p3: 1 }, hands: { p3: ['heal'] } }), {
    links: [['p1', 'p3']],
  });
  const shot = act(s0, shoot('p1', 'p1'));
  assert.equal(player(shot.state, 'p1').hp, 4);
  assert.deepEqual(one(pubs(shot.events, 'eliminated')), { type: 'eliminated', player: 'p3', by: 'p1', round: 1, visibility: 'public' });
  assert.deepEqual(shot.state.phase.queue, [{ looter: 'p1', victim: 'p3' }]);
  const { state } = act(shot.state, takeTool('p1', 'heal'));
  assert.deepEqual(player(state, 'p1').hand, ['heal']);
  assert.equal(state.turn.playerId, 'p2');
});

test('loot ownership: firing at yourself and dying together with your partner - nobody loots', () => {
  const s0 = prepared(
    setup({ n: 4, chambers: 'LBBB', hp: { p1: 1, p3: 1 }, hands: { p1: ['probe'], p3: ['heal'] } }),
    { links: [['p1', 'p3']] },
  );
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(
    pubs(events, 'eliminated').map((e) => [e.player, e.by]),
    [
      ['p1', null],
      ['p3', 'p1'],
    ],
  );
  assert.equal(state.phase.type, 'turn', 'no loot step');
  assert.deepEqual(player(state, 'p1').hand, []);
  assert.deepEqual(player(state, 'p3').hand, []);
  assert.equal(state.turn.playerId, 'p2');
});

test('loot ownership: a reflected shot counts for the shield owner, who loots the shooter it killed', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 }, hands: { p1: ['jail', 'heal'] } }), {
    shields: { p3: true },
  });
  const shot = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(one(pubs(shot.events, 'eliminated')), { type: 'eliminated', player: 'p1', by: 'p3', round: 1, visibility: 'public' });
  assert.deepEqual(shot.state.phase.queue, [{ looter: 'p3', victim: 'p1' }]);
  assert.equal(shot.state.clock.playerId, 'p3');
  assert.deepEqual(viewFor(shot.state, 'p3').self.pending.tools, ['jail', 'heal']);
  const { state } = act(shot.state, takeTool('p3', 'jail'));
  assert.deepEqual(player(state, 'p3').hand, ['jail']);
  assert.equal(state.turn.playerId, 'p2', 'the turn passes from the dead shooter\'s seat');
});

test('loot ownership: a reflected shot that also kills the shooter\'s linked partner credits the shield owner for both', () => {
  const s0 = prepared(setup({ n: 5, chambers: 'LBBBB', hp: { p1: 1, p4: 1 }, hands: { p1: ['jail'], p4: ['heal'] } }), {
    shields: { p3: true },
    links: [['p1', 'p4']],
  });
  const shot = act(s0, shoot('p1', 'p3'));
  assert.deepEqual(shot.state.phase.queue, [
    { looter: 'p3', victim: 'p1' },
    { looter: 'p3', victim: 'p4' },
  ]);
  const { state } = play(shot.state, takeTool('p3', 'jail'), takeTool('p3', 'heal'));
  assert.deepEqual(player(state, 'p3').hand, ['jail', 'heal']);
});

test('loot ownership: a player who eliminates themself with their own shot - all their tools leave the game', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hp: { p1: 1 }, hands: { p1: ['heal', 'jail'] } });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.deepEqual(one(pubs(events, 'eliminated')), { type: 'eliminated', player: 'p1', by: null, round: 1, visibility: 'public' });
  assert.equal(state.phase.type, 'turn');
  assert.deepEqual(player(state, 'p1').hand, []);
  for (const p of state.players) if (p.alive) assert.deepEqual(p.hand, []);
  assert.equal(pubs(events, 'lootStarted').length, 0);
});

test('loot: one tool from EACH player killed by the shot (double + link kills two)', () => {
  const s0 = prepared(
    setup({
      n: 5,
      chambers: 'LBBBB',
      hp: { p2: 2, p3: 1 },
      hands: { p1: ['double'], p2: ['heal', 'probe'], p3: ['jail'] },
    }),
    { links: [['p2', 'p3']] },
  );
  const shot = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.deepEqual(shot.state.phase.queue, [
    { looter: 'p1', victim: 'p2' },
    { looter: 'p1', victim: 'p3' },
  ]);
  assert.equal(pubs(shot.events, 'eliminated').length, 2);
  const first = act(shot.state, takeTool('p1', 'probe'));
  assert.deepEqual(first.state.phase.queue, [{ looter: 'p1', victim: 'p3' }]);
  assert.deepEqual(viewFor(first.state, 'p1').self.pending.tools, ['jail']);
  assert.notEqual(first.state.clock.seq, shot.state.clock.seq, 'each loot gets its own timer');
  const { state } = act(first.state, takeTool('p1', 'jail'));
  assert.deepEqual(player(state, 'p1').hand, ['probe', 'jail']);
  assert.equal(state.turn.playerId, 'p4');
});

test('loot: a timeout shot can loot too (shooter survives, linked partner dies)', () => {
  const s0 = prepared(setup({ n: 4, chambers: 'LBBB', hp: { p3: 1 }, hands: { p3: ['heal'] } }), {
    links: [['p1', 'p3']],
  });
  const { state } = act(s0, { type: 'timeout' });
  assert.deepEqual(state.phase.queue, [{ looter: 'p1', victim: 'p3' }]);
});

test('loot: when the kill uses the last chamber, the reload happens first and the loot follows', () => {
  const s0 = setup({ n: 4, chambers: 'L', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.round.index, 2);
  assert.equal(state.phase.type, 'loot');
  assert.deepEqual(one(pubs(events, 'roundEnded')).survivors, ['p1', 'p3', 'p4']);
  const after = act(state, takeTool('p1', 'heal')).state;
  assert.equal(after.turn.playerId, 'p3');
  assert.equal(player(after, 'p2').hand.length, 0, 'the dead get no tools from the reload');
});

test('elimination: links, jail and offers of the dead are cleared', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.links.push(['p2', 'p3']);
    d.players[1].jailed = true;
    d.players[1].ransomOffer = { to: 'p3', kind: 'tool', tool: 'heal' };
  });
  const { state } = act(s0, shoot('p1', 'p2'));
  assert.deepEqual(state.links, []);
  assert.equal(player(state, 'p2').jailed, false);
  assert.equal(player(state, 'p2').ransomOffer, null);
  assert.equal(player(state, 'p3').hp, 4, 'the link still carried this last shot');
});

// --- End of the match --------------------------------------------------------------

test('match end: the last player alive wins', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p2: 1 }, hands: { p2: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state, events } = act(s0, shoot('p1', 'p2'));
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.result, { type: 'win', winner: 'p1' });
  assert.deepEqual(one(pubs(events, 'matchEnded')), {
    type: 'matchEnded',
    result: 'win',
    winner: 'p1',
    startingPlayers: 3,
    visibility: 'public',
  });
  assert.equal(pubs(events, 'lootStarted').length, 0, 'no loot once the match is over');
  assert.deepEqual(viewFor(state, 'p2').result, { type: 'win', winner: 'p1' });
});

test('match end: one shot eliminating the last living players together is a draw with no winner', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1, p2: 1 } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
    d.links.push(['p1', 'p2']);
  });
  const { state, events } = act(s0, shoot('p1', 'p1'));
  assert.equal(state.status, 'ended');
  assert.deepEqual(state.result, { type: 'draw', winner: null });
  assert.equal(one(pubs(events, 'matchEnded')).result, 'draw');
  assert.equal(pubs(events, 'eliminated').length, 2);
});

test('match end: a draw also happens when the shooter kills their linked partner and dies through the link', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1, p2: 1 }, hands: { p1: ['double'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
    d.links.push(['p1', 'p2']);
  });
  const { state } = play(s0, use('p1', 'double'), shoot('p1', 'p2'));
  assert.deepEqual(state.result, { type: 'draw', winner: null });
});

test('match end: nothing can be done after the match is over', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p2: 1 }, hands: { p1: ['heal'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state } = act(s0, shoot('p1', 'p2'));
  fails(state, shoot('p1', 'p1'), ERR.MATCH_ENDED);
  fails(state, use('p1', 'heal'), ERR.MATCH_ENDED);
  fails(state, { type: 'timeout' }, ERR.MATCH_ENDED);
  assert.deepEqual(listLegalActions(state, 'p1'), []);
});

test('match end: the winner can be decided by a timeout shot', () => {
  let s0 = setup({ n: 3, chambers: 'LBB', hp: { p1: 1 } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state } = act(s0, { type: 'timeout' });
  assert.deepEqual(state.result, { type: 'win', winner: 'p2' });
});
