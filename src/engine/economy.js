// Custom mode economy: the shop and secret coin transfers.

import { ERR } from './constants.js';
import { isInt, reject, requireAlivePlayer, requireTarget } from './util.js';
import { pub, priv } from './events.js';

function requireCustom(state) {
  if (state.config.mode !== 'custom') reject(ERR.NOT_CUSTOM_MODE, 'coins and the shop exist only in custom mode');
}

// Buying is allowed at any moment and is secret. With limited stock everyone
// sees the remaining count drop, but never who bought.
export function handleBuy(ctx, action) {
  const s = ctx.state;
  requireCustom(s);
  const player = requireAlivePlayer(s, action.playerId);
  const tool = action.tool;
  if (typeof tool !== 'string' || !s.config.enabledTools.includes(tool)) {
    reject(ERR.TOOL_NOT_FOR_SALE, 'that tool is not sold in this match');
  }
  const price = s.config.custom.prices[tool];
  const left = s.shop.stock[tool];
  if (left !== null && left <= 0) reject(ERR.OUT_OF_STOCK, 'that tool is sold out until the next reload');
  if (player.coins < price) reject(ERR.INSUFFICIENT_COINS, 'not enough coins');

  player.coins -= price;
  player.hand.push(tool);
  priv(ctx, player.id, 'purchased', { player: player.id, tool, price, coins: player.coins });
  if (left !== null) {
    s.shop.stock[tool] = left - 1;
    pub(ctx, 'shopStockChanged', { tool, remaining: left - 1 });
  }
}

// Only the sender and the receiver ever learn about a transfer.
export function handleTransfer(ctx, action) {
  const s = ctx.state;
  requireCustom(s);
  const player = requireAlivePlayer(s, action.playerId);
  const recipient = requireTarget(s, action.to, player.id);
  if (!isInt(action.amount) || action.amount < 1) reject(ERR.INVALID_AMOUNT, 'amount must be a positive integer');
  if (action.amount > player.coins) reject(ERR.INSUFFICIENT_COINS, 'not enough coins');
  player.coins -= action.amount;
  recipient.coins += action.amount;
  priv(ctx, player.id, 'transferSent', { from: player.id, recipient: recipient.id, amount: action.amount, coins: player.coins });
  priv(ctx, recipient.id, 'transferReceived', {
    from: player.id,
    recipient: recipient.id,
    amount: action.amount,
    coins: recipient.coins,
  });
}
