// Jail ransom: a jailed player may offer one tool (or, in Custom, coins) to
// any living player; if that player accepts, the jailed player is released.
// Offers are private to the two players and never block the game.

import { ERR } from './constants.js';
import { getPlayer, isInt, isPlainObject, reject, removeOne, requireAlivePlayer, requireTarget } from './util.js';
import { pub, priv } from './events.js';

// Drops a player's outgoing offer (if any) and tells both sides why.
export function closeOffer(ctx, offerer, reason) {
  if (!offerer.ransomOffer) return;
  const to = offerer.ransomOffer.to;
  offerer.ransomOffer = null;
  priv(ctx, [offerer.id, to], 'ransomClosed', { from: offerer.id, recipient: to, reason });
}

// Drops every offer addressed to a player (used when that player is eliminated).
export function closeOffersTo(ctx, recipientId, reason) {
  for (const p of ctx.state.players) {
    if (p.ransomOffer && p.ransomOffer.to === recipientId) closeOffer(ctx, p, reason);
  }
}

export function handleRansomOffer(ctx, action) {
  const s = ctx.state;
  const player = requireAlivePlayer(s, action.playerId);
  if (!player.jailed) reject(ERR.NOT_JAILED, 'only a jailed player can offer a ransom');
  const recipient = requireTarget(s, action.to, player.id);
  const offer = action.offer;
  if (!isPlainObject(offer)) reject(ERR.INVALID_ACTION, 'offer must be an object');

  let stored;
  if (offer.kind === 'tool') {
    if (typeof offer.tool !== 'string' || !player.hand.includes(offer.tool)) {
      reject(ERR.TOOL_NOT_IN_HAND, 'you can only offer a tool you hold');
    }
    stored = { to: recipient.id, kind: 'tool', tool: offer.tool };
  } else if (offer.kind === 'coins') {
    if (s.config.mode !== 'custom') reject(ERR.NOT_CUSTOM_MODE, 'coin ransom exists only in custom mode');
    if (!isInt(offer.amount) || offer.amount < 1) reject(ERR.INVALID_AMOUNT, 'amount must be a positive integer');
    if (offer.amount > player.coins) reject(ERR.INSUFFICIENT_COINS, 'you cannot offer more coins than you have');
    stored = { to: recipient.id, kind: 'coins', amount: offer.amount };
  } else {
    reject(ERR.INVALID_ACTION, "offer.kind must be 'tool' or 'coins'");
  }

  // A new offer replaces the previous one.
  closeOffer(ctx, player, 'replaced');
  player.ransomOffer = stored;
  const { to: _to, ...terms } = stored;
  priv(ctx, [player.id, recipient.id], 'ransomOffered', { from: player.id, recipient: recipient.id, ...terms });
}

export function handleRansomWithdraw(ctx, action) {
  const player = requireAlivePlayer(ctx.state, action.playerId);
  if (!player.ransomOffer) reject(ERR.NO_OFFER, 'you have no pending ransom offer');
  closeOffer(ctx, player, 'withdrawn');
}

function requireOfferFor(ctx, action) {
  const s = ctx.state;
  const recipient = requireAlivePlayer(s, action.playerId);
  if (typeof action.from !== 'string') reject(ERR.INVALID_ACTION, 'from must be a player id');
  const offerer = getPlayer(s, action.from);
  if (!offerer || !offerer.alive || !offerer.ransomOffer || offerer.ransomOffer.to !== recipient.id) {
    reject(ERR.NO_OFFER, 'there is no ransom offer from that player to you');
  }
  return { recipient, offerer };
}

export function handleRansomAccept(ctx, action) {
  const { recipient, offerer } = requireOfferFor(ctx, action);
  const offer = offerer.ransomOffer;
  if (offer.kind === 'tool') {
    // The offer is not escrowed: the tool may have left the hand meanwhile.
    if (!removeOne(offerer.hand, offer.tool)) reject(ERR.OFFER_NOT_FUNDED, 'the offered tool is no longer available');
    recipient.hand.push(offer.tool);
  } else {
    if (offerer.coins < offer.amount) reject(ERR.OFFER_NOT_FUNDED, 'the offered coins are no longer available');
    offerer.coins -= offer.amount;
    recipient.coins += offer.amount;
  }
  offerer.ransomOffer = null;
  offerer.jailed = false;
  const payment = offer.kind === 'tool' ? { kind: 'tool', tool: offer.tool } : { kind: 'coins', amount: offer.amount };
  priv(ctx, [offerer.id, recipient.id], 'ransomPaid', { from: offerer.id, recipient: recipient.id, ...payment });
  // Everyone learns the player is free again; who was paid and what stays secret.
  pub(ctx, 'jailReleased', { player: offerer.id, reason: 'ransom' });
}

export function handleRansomReject(ctx, action) {
  const { offerer } = requireOfferFor(ctx, action);
  closeOffer(ctx, offerer, 'rejected');
}
