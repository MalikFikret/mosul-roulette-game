// Keeps the host's settings controls and the database in step (pure logic, timers injected):
// - a change shows at once (local value) and is written once after a short pause, so quick
//   taps become one write;
// - while a change is pending or being written, values arriving from the database do not
//   overwrite what the host sees;
// - if the write fails, the controls roll back to the last value from the database and the
//   error is reported.

export const WRITE_DELAY_MS = 400;

/**
 * @param {{ write: (settings: object) => Promise<unknown>, onShow: (settings: object) => void,
 *   onError?: (error: unknown) => void, delayMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => unknown, clearTimer?: (id: unknown) => void }} options
 */
export function createSettingsSync({
  write,
  onShow,
  onError,
  delayMs = WRITE_DELAY_MS,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (id) => globalThis.clearTimeout(id),
}) {
  let server = null; // last value from the database
  let local = null; // the host's change not yet confirmed
  let inFlight = null; // the value being written
  let timer = null;
  let disposed = false;

  const current = () => local ?? server;
  const show = () => {
    if (!disposed && current() !== null) onShow(current());
  };

  function send() {
    timer = null;
    if (local === null) return;
    const sending = local;
    inFlight = sending;
    let result;
    try {
      result = Promise.resolve(write(sending));
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      () => {
        if (inFlight === sending) inFlight = null;
        // A newer change (tapped during the write) stays pending; otherwise show the database.
        if (local === sending) local = null;
        show();
      },
      (error) => {
        if (inFlight === sending) inFlight = null;
        if (local === sending) local = null;
        show();
        if (!disposed && typeof onError === 'function') onError(error);
      },
    );
  }

  return {
    /** A value from the database (onValue). */
    fromServer(settings) {
      server = settings;
      if (local === null && inFlight === null) show();
    },
    /** The host changed something: show it now, write it after the pause. */
    change(settings) {
      if (disposed) return;
      local = settings;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(send, delayMs);
      show();
    },
    /** What the controls show. */
    current,
    /** True while a change waits for its write or is being written. */
    busy: () => local !== null || inFlight !== null,
    /** Stops: a pending change is written at once (without callbacks), timers are cleared. */
    dispose() {
      if (disposed) return;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
        if (local !== null) {
          try {
            Promise.resolve(write(local)).catch(() => {});
          } catch {
            // Nothing to report after leaving.
          }
        }
      }
      disposed = true;
    },
  };
}
