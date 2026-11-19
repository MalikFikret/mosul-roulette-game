// Jail (with ransom), hand swap, and steal
// (document: "Jail", "Hand swap", "Steal at a price").

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR, viewFor } from '../src/engine/index.js';
import { setup, act, play, fails, shoot, use, pubs, privs, one, player, hpOf, edit } from './helpers.js';

// --- Jail ----------------------------------------------------------------------

test('jail: the jailed player misses their next turn, and it is announced with their name', () => {
  const s0 = setup({ n: 4, chambers: 'BBBBBB', hands: { p1: ['jail'] } });
  const used = act(s0, use('p1', 'jail', { target: 'p2' }));
  assert.deepEqual(one(pubs(used.events, 'toolUsed')), {
    type: 'toolUsed',
    tool: 'jail',
    by: 'p1',
    target: 'p2',
    visibility: 'public',
  });
  assert.equal(viewFor(used.state, 'p4').players[1].jailed, true);
  const { state, events } = act(used.state, shoot('p1', 'p3'));
  assert.deepEqual(one(pubs(events, 'turnSkipped')), { type: 'turnSkipped', player: 'p2', reason: 'jail', visibility: 'public' });
  assert.equal(state.turn.playerId, 'p3');
});

test('jail: it happens once - the player plays normally when the turn comes back', () => {
  const s0 = setup({ n: 3, chambers: 'BBBBBB', hands: { p1: ['jail'] } });
  const { state } = play(s0, use('p1', 'jail', { target: 'p2' }), shoot('p1', 'p3'), shoot('p3', 'p1'), shoot('p1', 'p3'));
  assert.equal(player(state, 'p2').jailed, false);
  assert.equal(state.turn.playerId, 'p2');
  act(state, shoot('p2', 'p1'));
});

test('jail: one missed turn only, however many times the tool is used before release', () => {
  const s0 = setup({ n: 3, chambers: 'BBBBBBBB', hands: { p1: ['jail', 'jail'], p3: ['jail'] } });
  const twice = play(s0, use('p1', 'jail', { target: 'p2' }), use('p1', 'jail', { target: 'p2' })).state;
  assert.deepEqual(player(twice, 'p1').hand, [], 'both tools are spent');
  // p1 fires, p2 is skipped, p3 jails p2 again while p2 is free, fires, p1 fires...
  const round1 = act(twice, shoot('p1', 'p3')).state;
  assert.equal(round1.turn.playerId, 'p3');
  assert.equal(player(round1, 'p2').jailed, false);
  const back = play(round1, shoot('p3', 'p1'), shoot('p1', 'p3')).state;
  assert.equal(back.turn.playerId, 'p2', 'only one turn was lost for the two jails');
});

test('jail: the jailed player stays a target for shots and tools, and their shields keep working', () => {
  let s0 = setup({ n: 3, chambers: 'LLBB', hands: { p1: ['jail', 'link'], p3: [] } });
  s0 = edit(s0, (d) => {
    d.players[1].shields.shot.push(0);
  });
  const jailed = play(s0, use('p1', 'jail', { target: 'p2' }), use('p1', 'link', { targets: ['p2', 'p3'] })).state;
  assert.deepEqual(jailed.links, [['p2', 'p3']]);
  // Shooting the jailed, shielded player: the shield reflects.
  const shot = act(jailed, shoot('p1', 'p2')).state;
  assert.deepEqual(hpOf(shot), { p1: 4, p2: 5, p3: 5 });
  // Next shooter is p3 (p2 skipped); the jailed player can be hit now.
  assert.equal(shot.turn.playerId, 'p3');
  assert.deepEqual(hpOf(act(shot, shoot('p3', 'p2')).state), { p1: 4, p2: 4, p3: 4 });
});

test('jail: you cannot jail yourself or a dead player', () => {
  let s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['jail'] } });
  s0 = edit(s0, (d) => {
    d.players[3].alive = false;
    d.players[3].hp = 0;
  });
  fails(s0, use('p1', 'jail', { target: 'p1' }), ERR.INVALID_TARGET);
  fails(s0, use('p1', 'jail', { target: 'p4' }), ERR.INVALID_TARGET);
  fails(s0, use('p1', 'jail'), ERR.INVALID_TARGET);
});

test('jail with two players left: the other player is skipped and the jailer plays again', () => {
  let s0 = setup({ n: 3, chambers: 'BBBB', hands: { p1: ['jail'] } });
  s0 = edit(s0, (d) => {
    d.players[2].alive = false;
    d.players[2].hp = 0;
  });
  const { state, events } = play(s0, use('p1', 'jail', { target: 'p2' }), shoot('p1', 'p2'));
  assert.equal(state.turn.playerId, 'p1');
  assert.equal(state.turn.number, 2);
  assert.equal(pubs(events, 'turnSkipped').length, 1);
});

// --- Ransom --------------------------------------------------------------------

function jailedState(extra = {}) {
  const s0 = setup({ n: 4, chambers: 'BBBBBB', hands: { p1: ['jail'], p2: ['heal', 'probe'] }, ...extra });
  return act(s0, use('p1', 'jail', { target: 'p2' })).state;
}

test('ransom: if any player accepts one tool from the jailed player, they are released', () => {
  const s = jailedState();
  const offered = act(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } });
  assert.deepEqual(pubs(offered.events), [], 'the negotiation is private');
  const offer = one(privs(offered.events, 'ransomOffered'));
  assert.deepEqual(offer.to, ['p2', 'p3']);
  assert.deepEqual(viewFor(offered.state, 'p3').self.incomingRansomOffers, [
    { from: 'p2', to: 'p3', kind: 'tool', tool: 'heal' },
  ]);
  assert.deepEqual(viewFor(offered.state, 'p4').self.incomingRansomOffers, []);

  const accepted = act(offered.state, { type: 'ransomAccept', playerId: 'p3', from: 'p2' });
  assert.equal(player(accepted.state, 'p2').jailed, false);
  assert.deepEqual(player(accepted.state, 'p2').hand, ['probe']);
  assert.deepEqual(player(accepted.state, 'p3').hand, ['heal']);
  // The release is public; who was paid and what is not.
  assert.deepEqual(pubs(accepted.events), [{ type: 'jailReleased', player: 'p2', reason: 'ransom', visibility: 'public' }]);
  assert.deepEqual(one(privs(accepted.events, 'ransomPaid')).to, ['p2', 'p3']);
  // Released: p2 plays their turn normally.
  const next = act(accepted.state, shoot('p1', 'p3'));
  assert.equal(next.state.turn.playerId, 'p2');
  assert.equal(pubs(next.events, 'turnSkipped').length, 0);
});

test('ransom: a jailed player with no tool cannot offer one and stays jailed', () => {
  const s0 = setup({ n: 4, chambers: 'BBBBBB', hands: { p1: ['jail'] } });
  const s = act(s0, use('p1', 'jail', { target: 'p2' })).state;
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } }, ERR.TOOL_NOT_IN_HAND);
  // Classic has no coins to offer either.
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'coins', amount: 1 } }, ERR.NOT_CUSTOM_MODE);
  assert.equal(act(s, shoot('p1', 'p3')).state.turn.playerId, 'p3');
});

test('ransom: only a jailed player can offer, only to another living player', () => {
  const s = jailedState();
  fails(s, { type: 'ransomOffer', playerId: 'p3', to: 'p1', offer: { kind: 'tool', tool: 'heal' } }, ERR.NOT_JAILED);
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'p2', offer: { kind: 'tool', tool: 'heal' } }, ERR.INVALID_TARGET);
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'zz', offer: { kind: 'tool', tool: 'heal' } }, ERR.INVALID_TARGET);
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'gold' } }, ERR.INVALID_ACTION);
  fails(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3' }, ERR.INVALID_ACTION);
});

test('ransom: the offer can be rejected, withdrawn or replaced; only its addressee can accept', () => {
  const s = jailedState();
  const offered = act(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } }).state;
  fails(offered, { type: 'ransomAccept', playerId: 'p4', from: 'p2' }, ERR.NO_OFFER);
  fails(offered, { type: 'ransomAccept', playerId: 'p3', from: 'p1' }, ERR.NO_OFFER);
  fails(offered, { type: 'ransomReject', playerId: 'p4', from: 'p2' }, ERR.NO_OFFER);

  const rejected = act(offered, { type: 'ransomReject', playerId: 'p3', from: 'p2' });
  assert.equal(player(rejected.state, 'p2').ransomOffer, null);
  assert.equal(player(rejected.state, 'p2').jailed, true);
  assert.equal(one(privs(rejected.events, 'ransomClosed')).reason, 'rejected');
  assert.deepEqual(pubs(rejected.events), []);

  const withdrawn = act(offered, { type: 'ransomWithdraw', playerId: 'p2' });
  assert.equal(player(withdrawn.state, 'p2').ransomOffer, null);
  fails(withdrawn.state, { type: 'ransomWithdraw', playerId: 'p2' }, ERR.NO_OFFER);

  const replaced = act(offered, { type: 'ransomOffer', playerId: 'p2', to: 'p4', offer: { kind: 'tool', tool: 'probe' } });
  assert.deepEqual(player(replaced.state, 'p2').ransomOffer, { to: 'p4', kind: 'tool', tool: 'probe' });
  fails(replaced.state, { type: 'ransomAccept', playerId: 'p3', from: 'p2' }, ERR.NO_OFFER);
});

test('ransom: an unanswered offer lapses when the jailed turn is skipped', () => {
  const s = jailedState();
  const offered = act(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } }).state;
  const { state, events } = act(offered, shoot('p1', 'p3'));
  assert.equal(player(state, 'p2').ransomOffer, null);
  assert.equal(player(state, 'p2').jailed, false);
  assert.equal(one(privs(events, 'ransomClosed')).reason, 'jailEnded');
  fails(state, { type: 'ransomAccept', playerId: 'p3', from: 'p2' }, ERR.NO_OFFER);
});

test('ransom: accepting fails if the offered tool is no longer in the hand', () => {
  const s = jailedState();
  let offered = act(s, { type: 'ransomOffer', playerId: 'p2', to: 'p3', offer: { kind: 'tool', tool: 'heal' } }).state;
  offered = edit(offered, (d) => {
    d.players[1].hand = ['probe'];
  });
  fails(offered, { type: 'ransomAccept', playerId: 'p3', from: 'p2' }, ERR.OFFER_NOT_FUNDED);
});

// --- Hand swap -------------------------------------------------------------------

test('hand swap: the user first sees how many tools each player holds - counts, not the tools', () => {
  const s0 = setup({
    n: 4,
    chambers: 'LBBB',
    hands: { p1: ['handSwap', 'probe'], p2: ['heal', 'heal', 'jail'], p3: [], p4: ['link'] },
  });
  const { state, events } = act(s0, use('p1', 'handSwap'));
  assert.deepEqual(pubs(events), [], 'nothing is public until a target is named');
  const peek = one(events);
  assert.deepEqual(peek, { type: 'handCounts', by: 'p1', counts: { p2: 3, p3: 0, p4: 1 }, visibility: 'private', to: ['p1'] });
  assert.deepEqual(viewFor(state, 'p1').self.pending, { type: 'handSwap', counts: { p2: 3, p3: 0, p4: 1 } });
  assert.ok(!JSON.stringify(peek).includes('jail'));
  // For everybody else this still looks like an ordinary turn.
  assert.deepEqual(viewFor(state, 'p2').phase, { type: 'turn' });
  assert.equal(viewFor(state, 'p2').self.pending, null);
});

test('hand swap: exchanges ALL your tools with the chosen player, announced with their name', () => {
  const s0 = setup({
    n: 4,
    chambers: 'LBBB',
    hands: { p1: ['handSwap', 'probe'], p2: ['heal', 'heal', 'jail'] },
  });
  const { state, events } = play(s0, use('p1', 'handSwap'), { type: 'handSwapTarget', playerId: 'p1', target: 'p2' });
  assert.deepEqual(player(state, 'p1').hand, ['heal', 'heal', 'jail']);
  assert.deepEqual(player(state, 'p2').hand, ['probe']);
  assert.deepEqual(pubs(events), [{ type: 'toolUsed', tool: 'handSwap', by: 'p1', target: 'p2', visibility: 'public' }]);
  assert.deepEqual(state.phase, { type: 'turn' });
  assert.equal(state.turn.playerId, 'p1');
  // Each side privately learns their new hand; nobody else does.
  const mine = privs(events, 'handSwapped', 'p1');
  assert.deepEqual(one(mine).hand, ['heal', 'heal', 'jail']);
  assert.deepEqual(one(privs(events, 'handSwapped', 'p2')).hand, ['probe']);
  assert.equal(privs(events, 'handSwapped', 'p3').length, 0);
});

test('hand swap: hoarding is risky - swapping with an empty hand takes everything', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['handSwap'], p2: ['heal', 'jail', 'link', 'double'] } });
  const { state } = play(s0, use('p1', 'handSwap'), { type: 'handSwapTarget', playerId: 'p1', target: 'p2' });
  assert.deepEqual(player(state, 'p1').hand, ['heal', 'jail', 'link', 'double']);
  assert.deepEqual(player(state, 'p2').hand, []);
});

test('hand swap: while choosing, the player can do nothing else; invalid targets are refused', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['handSwap', 'detector'] } });
  const pending = act(s0, use('p1', 'handSwap')).state;
  fails(pending, shoot('p1', 'p2'), ERR.WRONG_PHASE);
  fails(pending, use('p1', 'detector'), ERR.WRONG_PHASE);
  fails(pending, { type: 'handSwapTarget', playerId: 'p1', target: 'p1' }, ERR.INVALID_TARGET);
  fails(pending, { type: 'handSwapTarget', playerId: 'p2', target: 'p1' }, ERR.NOT_YOUR_TURN);
  fails(s0, { type: 'handSwapTarget', playerId: 'p1', target: 'p2' }, ERR.WRONG_PHASE);
});

test('hand swap: a timeout while choosing wastes the tool and fires at the player', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['handSwap', 'probe'], p2: ['heal'] } });
  const { state, events } = play(s0, use('p1', 'handSwap'), { type: 'timeout' });
  assert.deepEqual(player(state, 'p1').hand, ['probe']);
  assert.deepEqual(player(state, 'p2').hand, ['heal']);
  assert.equal(player(state, 'p1').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
  assert.deepEqual(one(pubs(events, 'toolUsed')), { type: 'toolUsed', tool: 'handSwap', by: 'p1', target: null, visibility: 'public' });
});

// --- Steal -----------------------------------------------------------------------

test('steal: the victim\'s tools are revealed to the thief only; the public sees just the victim\'s name', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['steal', 'probe'], p2: ['heal', 'jail'] } });
  const { state, events } = act(s0, use('p1', 'steal', { target: 'p2' }));
  assert.deepEqual(pubs(events), [{ type: 'toolUsed', tool: 'steal', by: 'p1', target: 'p2', visibility: 'public' }]);
  assert.deepEqual(one(privs(events, 'stealPeek')), {
    type: 'stealPeek',
    by: 'p1',
    victim: 'p2',
    tools: ['heal', 'jail'],
    visibility: 'private',
    to: ['p1'],
  });
  assert.deepEqual(viewFor(state, 'p1').self.pending, { type: 'steal', victim: 'p2', tools: ['heal', 'jail'] });
  for (const other of ['p2', 'p3', 'p4', null]) {
    const view = viewFor(state, other);
    assert.deepEqual(view.phase, { type: 'steal', thief: 'p1', victim: 'p2' });
    if (other) assert.equal(view.self.pending, null, 'only the thief gets the look');
    if (other && other !== 'p2') assert.deepEqual(view.self.hand, []);
  }
});

test('steal: the thief takes one tool and gives one of their own in exchange; which ones stays between the two', () => {
  const s0 = setup({ n: 4, chambers: 'LBBB', hands: { p1: ['steal', 'probe'], p2: ['heal', 'jail'] } });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  const { state, events } = act(peek, { type: 'stealChoice', playerId: 'p1', take: 'jail', give: 'probe' });
  assert.deepEqual(player(state, 'p1').hand, ['jail']);
  assert.deepEqual(player(state, 'p2').hand, ['heal', 'probe']);
  assert.deepEqual(pubs(events), [], 'the taken and the given tool are not announced');
  const result = one(privs(events, 'stealResult'));
  assert.deepEqual(result.to, ['p1', 'p2']);
  assert.deepEqual({ taken: result.taken, given: result.given }, { taken: 'jail', given: 'probe' });
  assert.deepEqual(state.phase, { type: 'turn' });
  assert.equal(state.turn.playerId, 'p1');
});

test('steal: the tool is spent by the look itself - the thief may leave empty-handed', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['steal', 'probe'], p2: ['heal'] } });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' }));
  assert.deepEqual(player(peek.state, 'p1').hand, ['probe']);
  const { state, events } = act(peek.state, { type: 'stealChoice', playerId: 'p1', take: null, give: null });
  assert.deepEqual(player(state, 'p1').hand, ['probe']);
  assert.deepEqual(player(state, 'p2').hand, ['heal']);
  assert.deepEqual(pubs(events), []);
  assert.deepEqual(one(events).to, ['p1']);
});

test('steal: it is an exchange - with nothing to give, nothing can be taken', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['steal'], p2: ['heal'] } });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  fails(peek, { type: 'stealChoice', playerId: 'p1', take: 'heal', give: null }, ERR.INVALID_CHOICE);
  fails(peek, { type: 'stealChoice', playerId: 'p1', take: 'heal', give: 'probe' }, ERR.TOOL_NOT_IN_HAND);
  fails(peek, { type: 'stealChoice', playerId: 'p1', take: 'jail', give: 'heal' }, ERR.INVALID_CHOICE);
  act(peek, { type: 'stealChoice', playerId: 'p1' });
});

test('steal: while choosing, the thief can do nothing else; others cannot choose for them', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['steal', 'detector'], p2: ['heal'] } });
  fails(s0, use('p1', 'steal', { target: 'p1' }), ERR.INVALID_TARGET);
  fails(s0, { type: 'stealChoice', playerId: 'p1', take: null, give: null }, ERR.WRONG_PHASE);
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  fails(peek, shoot('p1', 'p2'), ERR.WRONG_PHASE);
  fails(peek, use('p1', 'detector'), ERR.WRONG_PHASE);
  fails(peek, { type: 'stealChoice', playerId: 'p2', take: null, give: null }, ERR.NOT_YOUR_TURN);
});

test('steal: a timeout while choosing takes nothing and fires at the thief', () => {
  const s0 = setup({ chambers: 'LBB', hands: { p1: ['steal', 'probe'], p2: ['heal'] } });
  const { state } = play(s0, use('p1', 'steal', { target: 'p2' }), { type: 'timeout' });
  assert.deepEqual(player(state, 'p1').hand, ['probe']);
  assert.deepEqual(player(state, 'p2').hand, ['heal']);
  assert.equal(player(state, 'p1').hp, 4);
  assert.equal(state.turn.playerId, 'p2');
});

test('steal: the look shows the victim\'s hand as it is at that moment, even if it changes while choosing', () => {
  const s0 = setup({ chambers: 'LBB', hp: { p2: 2 }, hands: { p1: ['steal', 'probe'], p2: ['heal'] } });
  const peek = act(s0, use('p1', 'steal', { target: 'p2' })).state;
  const healed = act(peek, use('p2', 'heal')).state; // the victim spends the tool meanwhile
  assert.deepEqual(viewFor(healed, 'p1').self.pending.tools, []);
  fails(healed, { type: 'stealChoice', playerId: 'p1', take: 'heal', give: 'probe' }, ERR.INVALID_CHOICE);
});
