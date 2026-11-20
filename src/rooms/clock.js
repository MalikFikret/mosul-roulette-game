// The match clock on the devices (decision Q38). Pure scheduling: no database access, timers and
// time come in as functions so tests can use fake ones.
//
// The engine's clock is state.clock = { seq, kind: 'shot' | 'loot' | 'none', playerId }; seq
// changes whenever a new countdown starts. match/clockAt is the server time the current countdown
// started; it lasts shotTimeSeconds (both kinds). When it runs out, somebody sends
// { type: 'timeout', seq }:
// - the device of the seat the clock is waiting for sends it at the deadline;
// - every other device sends it at deadline + 3 s + a random 0-2 s, in case that device is gone.
// The engine accepts the first timeout for a seq and refuses the others (STALE_TIMEOUT).

/** Other devices wait this long after the deadline before sending the timeout themselves. */
export const BACKUP_DELAY_MS = 3000;
/** ... plus a random delay of up to this much, so they do not all send at once. */
export const BACKUP_JITTER_MS = 2000;

/**
 * When this device should send the timeout for the current countdown, or null if it should not
 * (no countdown, the match is over, or the data is incomplete).
 * @param {{ ended: boolean, clock: { seq: number, kind: string, playerId: string | null },
 *   clockAt: number, shotTimeSeconds: number, mySeat: string | null }} info
 * @param {number} jitter a number in [0, 1)
 * @returns {{ seq: number, fireAtServerMs: number, own: boolean } | null}
 */
export function planTimeout(info, jitter) {
  if (!info || info.ended || !info.clock || info.clock.kind === 'none') return null;
  if (typeof info.clockAt !== 'number' || typeof info.shotTimeSeconds !== 'number') return null;
  const deadline = info.clockAt + info.shotTimeSeconds * 1000;
  const own = info.mySeat !== null && info.clock.playerId === info.mySeat;
  const fireAtServerMs = own ? deadline : deadline + BACKUP_DELAY_MS + jitter * BACKUP_JITTER_MS;
  return { seq: info.clock.seq, fireAtServerMs, own };
}

/**
 * Keeps at most one pending timeout timer and moves it with the match.
 * @param {{ setTimeout: Function, clearTimeout: Function, now: () => number, random: () => number,
 *   onFire: (seq: number) => void }} deps
 *   `now` is local time; update() takes the server time offset (server = local + offset)
 */
export function createClockRunner({ setTimeout, clearTimeout, now, random, onFire }) {
  let pending = null; // { seq, timer }
  let currentSeq = null;
  let ended = false;
  let stopped = false;

  function cancel() {
    if (pending !== null) clearTimeout(pending.timer);
    pending = null;
  }

  return {
    /**
     * Call on every match update.
     * @param {{ ended: boolean, clock: object, clockAt: number, shotTimeSeconds: number,
     *   mySeat: string | null }} info
     * @param {number} offset server time offset in ms
     */
    update(info, offset = 0) {
      if (stopped) return;
      ended = Boolean(info?.ended);
      currentSeq = info?.clock ? info.clock.seq : null;
      if (ended || !info?.clock || info.clock.kind === 'none') {
        cancel();
        return;
      }
      // Same countdown as the one already scheduled: keep it (and its jitter).
      if (pending !== null && pending.seq === info.clock.seq) return;
      cancel();
      const plan = planTimeout(info, random());
      if (plan === null) return;
      const delay = Math.max(0, plan.fireAtServerMs - (now() + offset));
      const seq = plan.seq;
      pending = {
        seq,
        timer: setTimeout(() => {
          pending = null;
          // Only if the countdown is still the same one (the seq did not change meanwhile).
          if (!stopped && !ended && currentSeq === seq) onFire(seq);
        }, delay),
      };
    },
    /** The scheduled countdown seq, or null (for tests and diagnostics). */
    pendingSeq() {
      return pending === null ? null : pending.seq;
    },
    stop() {
      stopped = true;
      cancel();
    },
  };
}
