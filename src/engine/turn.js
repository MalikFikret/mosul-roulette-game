// Turn order and the external-timer handle (`state.clock`).
//
// The engine never measures time. `state.clock.seq` changes every time a new
// countdown should start; the host layer runs the real timer and sends a
// `timeout` action when it expires.

import { pub } from './events.js';
import { closeOffer } from './jail.js';

export function setClock(state, kind, playerId) {
  state.clock = { seq: state.clock.seq + 1, kind, playerId };
}

// The same player keeps the turn after a blank on self: a fresh full shot timer.
export function continueTurn(ctx) {
  const s = ctx.state;
  s.phase = { type: 'turn' };
  setClock(s, 'shot', s.turn.playerId);
}

// Passes the turn around the table in the current direction. Dead seats are
// passed over; a jailed player loses this one turn (and is then free).
export function advanceTurn(ctx) {
  const s = ctx.state;
  const n = s.players.length;
  let seat = s.players.findIndex((p) => p.id === s.turn.playerId);
  for (;;) {
    seat = (seat + s.direction + n) % n;
    const p = s.players[seat];
    if (!p.alive) continue;
    if (p.jailed) {
      p.jailed = false;
      closeOffer(ctx, p, 'jailEnded');
      pub(ctx, 'turnSkipped', { player: p.id, reason: 'jail' });
      continue;
    }
    s.turn = { playerId: p.id, number: s.turn.number + 1, toolsUsed: 0 };
    s.phase = { type: 'turn' };
    setClock(s, 'shot', p.id);
    pub(ctx, 'turnStarted', { player: p.id, turn: s.turn.number });
    return;
  }
}
