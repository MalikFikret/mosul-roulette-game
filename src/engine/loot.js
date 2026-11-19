// Loot after an elimination. The looter secretly sees the eliminated player's
// tools and takes one (Custom: or coins up to the cap, chosen blind). Loot is
// a blocking pending state with its own timer; a timeout forfeits the loot.

import { ERR } from './constants.js';
import { getPlayer, isPlainObject, reject, removeOne, requireAlivePlayer } from './util.js';
import { pub, priv } from './events.js';
import { advanceTurn, setClock } from './turn.js';

// queue: [{ looter, victim }, ...] in elimination order.
export function beginLoot(ctx, queue) {
  ctx.state.phase = { type: 'loot', queue };
  announceHead(ctx);
}

function announceHead(ctx) {
  const s = ctx.state;
  const head = s.phase.queue[0];
  const victim = getPlayer(s, head.victim);
  setClock(s, 'loot', head.looter);
  // That a loot is happening is public by rule; its content is not.
  pub(ctx, 'lootStarted', { looter: head.looter, victim: head.victim });
  priv(ctx, head.looter, 'lootOffer', {
    looter: head.looter,
    victim: head.victim,
    tools: victim.hand.slice(),
    coinsOption: s.config.mode === 'custom',
  });
}

// Closes the head entry. Whatever was not taken leaves the game.
function finishHead(ctx, result) {
  const s = ctx.state;
  const head = s.phase.queue.shift();
  const victim = getPlayer(s, head.victim);
  victim.hand = [];
  victim.coins = 0;
  priv(ctx, head.looter, 'lootResult', { looter: head.looter, victim: head.victim, ...result });
  pub(ctx, 'lootResolved', { looter: head.looter, victim: head.victim });
  if (s.phase.queue.length > 0) announceHead(ctx);
  else advanceTurn(ctx);
}

export function handleLootChoice(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  if (s.phase.type !== 'loot') reject(ERR.WRONG_PHASE, 'there is no loot to choose right now');
  const head = s.phase.queue[0];
  if (head.looter !== player.id) reject(ERR.NOT_LOOTER, 'this loot is not yours');
  const victim = getPlayer(s, head.victim);
  const choice = action.choice;
  if (!isPlainObject(choice)) reject(ERR.INVALID_ACTION, 'choice must be an object');

  if (choice.kind === 'tool') {
    if (typeof choice.tool !== 'string' || !removeOne(victim.hand, choice.tool)) {
      reject(ERR.INVALID_CHOICE, 'that tool is not among the eliminated player\'s tools');
    }
    player.hand.push(choice.tool);
    finishHead(ctx, { taken: 'tool', tool: choice.tool });
  } else if (choice.kind === 'coins') {
    if (s.config.mode !== 'custom') reject(ERR.INVALID_CHOICE, 'coins can be looted only in custom mode');
    // Chosen blind: the looter gets what is there, up to the cap.
    const amount = Math.min(victim.coins, s.config.custom.lootCoinCap);
    player.coins += amount;
    finishHead(ctx, { taken: 'coins', amount, coins: player.coins });
  } else if (choice.kind === 'none') {
    finishHead(ctx, { taken: 'none' });
  } else {
    reject(ERR.INVALID_CHOICE, "choice.kind must be 'tool', 'coins' or 'none'");
  }
}

// A looter was removed from the match: their loot steps are dropped. The
// victims' tools and coins leave the game. If the dropped step was the one in
// progress, the next step starts (or, with none left, the turn passes).
export function dropLootsOf(ctx, looterId) {
  const s = ctx.state;
  const queue = s.phase.queue;
  const head = queue[0];
  const kept = [];
  for (const entry of queue) {
    if (entry.looter !== looterId) {
      kept.push(entry);
      continue;
    }
    const victim = getPlayer(s, entry.victim);
    victim.hand = [];
    victim.coins = 0;
  }
  if (kept.length === queue.length) return;
  s.phase.queue = kept;
  if (head.looter === looterId) pub(ctx, 'lootResolved', { looter: head.looter, victim: head.victim });
  if (kept.length === 0) advanceTurn(ctx);
  else if (head.looter === looterId) announceHead(ctx);
}

// Timeout while a loot is pending: the looter loses this loot.
export function forfeitLoot(ctx) {
  finishHead(ctx, { taken: 'none', forfeited: true });
}
