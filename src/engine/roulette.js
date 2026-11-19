// The roulette: rounds (reloads), chamber helpers, and what every reload hands
// out (Classic: random tools; Custom: coins, private info, shop restock).

import { alivePlayers } from './util.js';
import { randInt, randRange, shuffleInPlace } from './rng.js';
import { pub, priv } from './events.js';
import { stockCopies } from './config.js';

// Chamber count is random between the number of living players and its double.
export function chamberRange(aliveCount) {
  return { min: aliveCount, max: aliveCount * 2 };
}

// Live count is random between a third and two thirds of the chambers
// (bounds rounded inward), always leaving at least one live and one blank.
export function liveRange(total) {
  const min = Math.max(1, Math.ceil(total / 3));
  const max = Math.max(min, Math.min(total - 1, Math.floor((2 * total) / 3)));
  return { min, max };
}

export function currentChamber(state) {
  return state.round.chambers[state.round.cursor];
}

// What the chamber DOES when fired: its type, inverted if it was flipped.
export function chamberEffect(chamber) {
  if (!chamber.flipped) return chamber.type;
  return chamber.type === 'live' ? 'blank' : 'live';
}

export function chambersLeft(state) {
  return state.round.chambers.length - state.round.cursor;
}

// Ends the running round: announces it (for session scoring) and expires
// everything that lasts "until the end of the reload".
export function endRound(ctx) {
  const s = ctx.state;
  pub(ctx, 'roundEnded', {
    round: s.round.index,
    shots: s.round.shots,
    survivors: alivePlayers(s).map((p) => p.id),
  });
  s.links = [];
  for (const p of s.players) {
    p.shields.shot = [];
    p.shields.tool = [];
  }
}

// Fills the roulette and announces the live/blank counts once.
export function startRound(ctx) {
  const s = ctx.state;
  const alive = alivePlayers(s);
  const counts = chamberRange(alive.length);
  const total = randRange(s, counts.min, counts.max);
  const lr = liveRange(total);
  const live = randRange(s, lr.min, lr.max);
  const chambers = [];
  for (let i = 0; i < total; i++) chambers.push({ type: i < live ? 'live' : 'blank', flipped: false });
  shuffleInPlace(s, chambers);

  const index = s.round ? s.round.index + 1 : 1;
  s.round = {
    index,
    chambers,
    cursor: 0,
    announced: { total, live, blank: total - live },
    shots: 0,
  };
  pub(ctx, 'reloaded', { round: index, total, live, blank: total - live });

  if (s.config.mode === 'classic') {
    dealTools(ctx, alive);
  } else {
    if (index > 1 && s.config.custom.coinsPerReload > 0) {
      for (const p of alive) {
        p.coins += s.config.custom.coinsPerReload;
        priv(ctx, p.id, 'coinsChanged', {
          player: p.id,
          delta: s.config.custom.coinsPerReload,
          coins: p.coins,
          reason: 'reload',
        });
      }
    }
    assignPrivateInfo(ctx, alive);
    restockShop(ctx, alive.length);
  }
}

// If the last chamber was just used, close the round and reload immediately.
// A reload never changes whose turn it is.
export function reloadIfEmpty(ctx) {
  if (chambersLeft(ctx.state) > 0) return false;
  endRound(ctx);
  startRound(ctx);
  return true;
}

// Classic: every living player draws random tools from the enabled set.
function dealTools(ctx, alive) {
  const s = ctx.state;
  const pool = s.config.enabledTools;
  if (pool.length === 0 || s.config.toolsPerReload === 0) return;
  for (const p of alive) {
    const tools = [];
    for (let i = 0; i < s.config.toolsPerReload; i++) tools.push(pool[randInt(s, pool.length)]);
    for (const t of tools) p.hand.push(t);
    priv(ctx, p.id, 'toolsDealt', { player: p.id, round: s.round.index, tools });
  }
}

// Custom: every living player secretly learns the type of one chamber, and no
// two players learn the same chamber.
function assignPrivateInfo(ctx, alive) {
  const s = ctx.state;
  const indices = [];
  for (let i = 0; i < s.round.chambers.length; i++) indices.push(i);
  shuffleInPlace(s, indices);
  alive.forEach((p, i) => {
    const chamberIndex = indices[i];
    p.privateInfo = {
      round: s.round.index,
      chamberIndex,
      type: s.round.chambers[chamberIndex].type,
      stale: false,
    };
    priv(ctx, p.id, 'privateInfo', {
      player: p.id,
      round: s.round.index,
      chamberIndex,
      chamber: p.privateInfo.type,
    });
  });
}

// Custom: shop stock is renewed with every reload. `null` means unlimited.
function restockShop(ctx, aliveCount) {
  const s = ctx.state;
  const stock = {};
  for (const tool of s.config.enabledTools) {
    stock[tool] = s.config.custom.limitedStock ? stockCopies(s.config, tool, aliveCount) : null;
  }
  s.shop = { stock };
  pub(ctx, 'shopRestocked', { round: s.round.index, stock: { ...stock } });
}
