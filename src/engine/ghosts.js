// Ghost predictions (Custom mode only). An eliminated player may predict the
// displayed effect of the next shot. The prediction can be changed freely
// until the shot is committed (confirm press, or target choice when the
// shooter disabled confirmation); committing and firing are one atomic step
// in the engine, so "locked" simply means "the value held when the shot fires".

import { ERR } from './constants.js';
import { hasOwn, reject, requirePlayer } from './util.js';
import { pub, priv } from './events.js';

export function handlePredict(ctx, action) {
  const s = ctx.state;
  if (s.config.mode !== 'custom') reject(ERR.NOT_CUSTOM_MODE, 'predictions exist only in custom mode');
  const player = requirePlayer(s, action.playerId);
  if (player.alive) reject(ERR.NOT_A_GHOST, 'living players do not predict');
  const prediction = action.prediction === undefined ? null : action.prediction;
  if (prediction !== 'live' && prediction !== 'blank' && prediction !== null) {
    reject(ERR.INVALID_PREDICTION, "prediction must be 'live', 'blank' or null");
  }
  if (prediction === null) delete s.predictions[player.id];
  else s.predictions[player.id] = prediction;
  priv(ctx, player.id, 'predictionSet', { player: player.id, prediction });
}

// Judges every standing prediction against the DISPLAYED effect of the shot
// (after a flip), then clears them for the next shot.
export function resolvePredictions(ctx, effect) {
  const s = ctx.state;
  for (const p of s.players) {
    if (!hasOwn(s.predictions, p.id)) continue;
    const prediction = s.predictions[p.id];
    pub(ctx, 'predictionResolved', {
      player: p.id,
      round: s.round.index,
      prediction,
      correct: prediction === effect,
    });
  }
  s.predictions = {};
}
