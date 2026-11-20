// Pure helpers of the match layer (no database access): the player list of a new match, the
// match log, and the traffic counters.
//
// rooms/{CODE}/match = { n, seq, stateJson, log: { [seq]: eventsJson } }
// - n: the match number in this room (the first match is 1);
// - seq: the number of writes to this match (0 when it starts);
// - stateJson: the engine state as ONE JSON string (the Realtime Database drops empty arrays and
//   nulls, which the engine state contains);
// - log/{seq}: the engine events produced by that write, as a JSON string (all of them, public
//   and private: each device filters them for its own seat with the engine's eventsFor).

import { eventsFor } from '../engine/index.js';
import { isSeatId } from './schema.js';

/**
 * The engine players of a new match: every seated seat (present or absent), sorted by seat id.
 * Player ids are seat ids.
 * @param {Record<string, unknown> | null} seats rooms/{CODE}/seats
 * @returns {Array<{ id: string }>}
 */
export function buildPlayers(seats) {
  if (seats === null || typeof seats !== 'object') return [];
  return Object.keys(seats)
    .filter((seatId) => isSeatId(seatId) && seats[seatId] !== null && typeof seats[seatId] === 'object')
    .sort()
    .map((id) => ({ id }));
}

/**
 * The log entries in seq order. The database returns the log as an object keyed by seq, or as
 * an array when the keys are 0..n; unreadable entries are skipped.
 * @param {unknown} log rooms/{CODE}/match/log
 * @returns {Array<{ seq: number, events: object[] }>}
 */
export function parseLog(log) {
  if (log === null || typeof log !== 'object') return [];
  const entries = [];
  for (const [key, value] of Object.entries(log)) {
    const seq = Number(key);
    if (!Number.isInteger(seq) || seq < 0 || String(seq) !== key || typeof value !== 'string') continue;
    let events;
    try {
      events = JSON.parse(value);
    } catch {
      continue;
    }
    if (Array.isArray(events)) entries.push({ seq, events });
  }
  return entries.sort((a, b) => a.seq - b.seq);
}

/**
 * The events of the entries after `afterSeq` (all entries for afterSeq = -1), in order, as seen
 * by `playerId` (public events plus the private events sent to that seat; null: public only).
 * @param {Array<{ seq: number, events: object[] }>} entries from parseLog
 * @param {number} afterSeq
 * @param {string | null} playerId
 * @returns {object[]}
 */
export function eventsSince(entries, afterSeq, playerId) {
  const out = [];
  for (const entry of entries) {
    if (entry.seq > afterSeq) out.push(...eventsFor(entry.events, playerId));
  }
  return out;
}

/**
 * The engine player id this seat plays as in a match state, or null if the seat is not a player
 * of this match (a member outside the match gets the spectator view).
 * @param {{ players: Array<{ id: string }> }} state
 * @param {string | null} seatId
 * @returns {string | null}
 */
export function playerIdIn(state, seatId) {
  if (seatId === null || !Array.isArray(state?.players)) return null;
  return state.players.some((p) => p.id === seatId) ? seatId : null;
}

/** Approximate size of a value as sent or received: the length of its JSON text. */
export function jsonSize(value) {
  if (value === undefined) return 0;
  const text = JSON.stringify(value);
  return text === undefined ? 0 : text.length;
}

/**
 * Traffic counters for the match layer. They are APPROXIMATIONS: they count the JSON length of
 * what startMatch / submitAction hand to the database and of the snapshots watchMatch receives,
 * not the bytes on the wire (no protocol framing, compression, retransmissions or other
 * listeners).
 */
export function createTrafficCounter() {
  let written = 0;
  let received = 0;
  let writes = 0;
  let snapshots = 0;
  return {
    addWritten(value) {
      written += jsonSize(value);
      writes += 1;
    },
    addReceived(value) {
      received += jsonSize(value);
      snapshots += 1;
    },
    /** @returns {{ bytesWritten: number, bytesReceived: number, writes: number, snapshots: number }} */
    stats() {
      return { bytesWritten: written, bytesReceived: received, writes, snapshots };
    },
    reset() {
      written = 0;
      received = 0;
      writes = 0;
      snapshots = 0;
    },
  };
}
