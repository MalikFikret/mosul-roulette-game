// Session scoring. Pure functions over the match event log; only PUBLIC
// events are read, so the result is the same whether it is computed from the
// full log or from any player's filtered log.
//
// A session is several matches played by the same group; session points
// accumulate across matches and never affect a match.

import { clone, hasOwn, isInt, isPlainObject } from './util.js';

// Defaults from the scoring table of the design document.
export const DEFAULT_SCORING = {
  liveOnOther: 1, // live shot on another player
  blankOnOther: -1, // blank shot on another player
  blankOnSelf: 2, // blank shot on yourself
  liveOnSelf: -1, // live shot on yourself (also: a shot bounced back by a shot shield)
  elimination: 2, // per eliminated player
  roundSurvivalPerShot: 1, // finishing a round alive: this many points per shot of that round
  winPerStartingPlayer: 3, // winning: this many points per player who started the match
  predictionCorrect: 1, // ghost prediction (Custom mode)
  predictionWrong: -1,
  scoreAutoShots: true, // whether timeout self-shots earn/lose shot points like any self shot
};

export function validateScoring(input = {}) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, scoring: null, errors: [{ field: '', message: 'must be an object' }] };
  const scoring = { ...DEFAULT_SCORING };
  for (const key of Object.keys(input)) {
    if (!hasOwn(DEFAULT_SCORING, key)) {
      errors.push({ field: key, message: 'unknown scoring field' });
    } else if (key === 'scoreAutoShots') {
      if (typeof input[key] !== 'boolean') errors.push({ field: key, message: 'must be a boolean' });
      else scoring[key] = input[key];
    } else if (!isInt(input[key]) || Math.abs(input[key]) > 1000) {
      errors.push({ field: key, message: 'must be an integer between -1000 and 1000' });
    } else {
      scoring[key] = input[key];
    }
  }
  if (errors.length > 0) return { ok: false, scoring: null, errors };
  return { ok: true, scoring, errors: [] };
}

function emptyRow() {
  return { total: 0, shots: 0, eliminations: 0, rounds: 0, win: 0, predictions: 0 };
}

// How a shot counts for its shooter. Counted per SHOT, never per damage:
// a doubled shot, or a shot hurting two linked players, is still one shot.
// A live shot counts as "on self" when the shooter aimed at themself, or when
// the target's shot shield sent it back at the shooter.
export function classifyShot(shot) {
  const onSelf = shot.target === shot.shooter;
  if (shot.effect === 'blank') return onSelf ? 'blankOnSelf' : 'blankOnOther';
  return onSelf || shot.reflected ? 'liveOnSelf' : 'liveOnOther';
}

// events: the event log of ONE match (the concatenated `events` arrays
// returned by createMatch and every applyAction).
// Returns { players: { id: { total, shots, eliminations, rounds, win, predictions } },
//           result, winner, startingPlayers, complete }.
export function scoreMatch(events, scoringInput = {}) {
  const checked = validateScoring(scoringInput);
  if (!checked.ok) throw new Error(`invalid scoring config: ${JSON.stringify(checked.errors)}`);
  const scoring = checked.scoring;

  const players = {};
  const row = (id) => {
    if (!players[id]) players[id] = emptyRow();
    return players[id];
  };
  const add = (id, category, points) => {
    const r = row(id);
    r[category] += points;
    r.total += points;
  };

  const summary = { players, result: null, winner: null, startingPlayers: 0, complete: false };

  for (const e of events) {
    if (e.visibility !== 'public') continue;
    switch (e.type) {
      case 'matchStarted':
        summary.startingPlayers = e.startingPlayers;
        for (const id of e.seats) row(id);
        break;
      case 'shot':
        if (e.auto && !scoring.scoreAutoShots) break;
        add(e.shooter, 'shots', scoring[classifyShot(e)]);
        break;
      case 'eliminated':
        // Credit goes to whoever owned the damage, even if they died from the
        // same shot. Nobody is credited for eliminating themself.
        if (e.by !== null) add(e.by, 'eliminations', scoring.elimination);
        break;
      case 'roundEnded':
        // Emitted only when a round is played out and the match goes on.
        for (const id of e.survivors) add(id, 'rounds', e.shots * scoring.roundSurvivalPerShot);
        break;
      case 'predictionResolved':
        add(e.player, 'predictions', e.correct ? scoring.predictionCorrect : scoring.predictionWrong);
        break;
      case 'matchEnded':
        summary.result = e.result;
        summary.winner = e.winner;
        summary.complete = true;
        // A draw awards no win bonus to anyone.
        if (e.result === 'win') add(e.winner, 'win', e.startingPlayers * scoring.winPerStartingPlayer);
        break;
      default:
        break;
    }
  }
  return summary;
}

// Session leaderboard helpers (plain data, never mutated in place).

export function createSession() {
  return { matches: 0, totals: {} };
}

export function addMatchToSession(session, matchScore) {
  const next = clone(session);
  next.matches += 1;
  for (const id of Object.keys(matchScore.players)) {
    next.totals[id] = (next.totals[id] || 0) + matchScore.players[id].total;
  }
  return next;
}

// Player ids sorted by session points, highest first (ties by id).
export function sessionRanking(session) {
  return Object.keys(session.totals)
    .map((id) => ({ id, points: session.totals[id] }))
    .sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
