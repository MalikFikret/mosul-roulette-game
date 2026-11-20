// Match clock scheduling (src/rooms/clock.js) with fake timers. Plain unit test, no emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_DELAY_MS, BACKUP_JITTER_MS, createClockRunner, planTimeout } from '../src/rooms/index.js';

// A fake local clock with setTimeout / clearTimeout that only move when advance() is called.
function fakeTime(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

const SHOT = 30; // shotTimeSeconds
function info(over = {}) {
  return {
    ended: false,
    clock: { seq: 4, kind: 'shot', playerId: 's02' },
    clockAt: 1_000_000,
    shotTimeSeconds: SHOT,
    mySeat: 's02',
    ...over,
  };
}

function runner(time, jitter = 0.5) {
  const fired = [];
  const r = createClockRunner({ ...time, random: () => jitter, onFire: (seq) => fired.push({ seq, at: time.now() }) });
  return { r, fired };
}

test('room clock: the seat the clock waits for fires exactly at the deadline', () => {
  const time = fakeTime();
  const { r, fired } = runner(time);
  r.update(info(), 0);
  time.advance(SHOT * 1000 - 1);
  assert.deepEqual(fired, []);
  time.advance(1);
  assert.deepEqual(fired, [{ seq: 4, at: 1_000_000 + SHOT * 1000 }]);
});

test('room clock: other seats fire at deadline + 3 s + jitter (0 to 2 s)', () => {
  for (const jitter of [0, 0.25, 0.999]) {
    const time = fakeTime();
    const { r, fired } = runner(time, jitter);
    r.update(info({ mySeat: 's05' }), 0);
    const expected = 1_000_000 + SHOT * 1000 + BACKUP_DELAY_MS + jitter * BACKUP_JITTER_MS;
    time.advance(expected - time.now() - 1);
    assert.deepEqual(fired, [], `jitter ${jitter}: too early`);
    time.advance(1);
    assert.equal(fired.length, 1);
    assert.equal(fired[0].at, expected);
  }
  // A spectator (no seat in the match) is a backup sender too.
  const time = fakeTime();
  const { r, fired } = runner(time, 0);
  r.update(info({ mySeat: null }), 0);
  time.advance(SHOT * 1000 + BACKUP_DELAY_MS);
  assert.equal(fired.length, 1);
});

test('room clock: the deadline is in server time (offset applied)', () => {
  const time = fakeTime();
  const { r, fired } = runner(time);
  // The server is 5 s ahead of this device: the deadline comes 5 s earlier in local time.
  r.update(info(), 5000);
  time.advance(SHOT * 1000 - 5000);
  assert.equal(fired.length, 1);
});

test('room clock: nothing fires after clock.seq changes; the new countdown is scheduled', () => {
  const time = fakeTime();
  const { r, fired } = runner(time);
  r.update(info(), 0);
  time.advance(10000);
  r.update(info({ clock: { seq: 5, kind: 'shot', playerId: 's03' }, clockAt: time.now() }), 0);
  assert.equal(time.pending(), 1, 'the old timer was cancelled');
  time.advance(SHOT * 1000 - 10000 + 100); // past the old deadline
  assert.deepEqual(fired, []);
  time.advance(10000 + BACKUP_DELAY_MS + BACKUP_JITTER_MS);
  assert.deepEqual(fired.map((f) => f.seq), [5]);
});

test('room clock: the same countdown seen again keeps its timer; a late-past deadline fires at once', () => {
  const time = fakeTime();
  const { r, fired } = runner(time);
  r.update(info(), 0);
  r.update(info(), 0);
  assert.equal(time.pending(), 1);
  time.advance(SHOT * 1000);
  assert.equal(fired.length, 1);
  // A device that comes back after the deadline sends at once.
  const late = fakeTime(1_000_000 + 120000);
  const second = runner(late);
  second.r.update(info(), 0);
  late.advance(0);
  assert.equal(second.fired.length, 1);
});

test('room clock: nothing fires when the match ends or for kind none, or after stop', () => {
  const time = fakeTime();
  const { r, fired } = runner(time);
  r.update(info(), 0);
  r.update(info({ ended: true, clock: { seq: 5, kind: 'none', playerId: null } }), 0);
  assert.equal(time.pending(), 0);
  time.advance(10 * SHOT * 1000);
  assert.deepEqual(fired, []);

  const t2 = fakeTime();
  const two = runner(t2);
  two.r.update(info({ clock: { seq: 1, kind: 'none', playerId: null } }), 0);
  assert.equal(t2.pending(), 0);
  two.r.update(info(), 0);
  two.r.stop();
  t2.advance(10 * SHOT * 1000);
  assert.deepEqual(two.fired, []);
});

test('room clock: the loot countdown is timed like a shot', () => {
  const plan = planTimeout(info({ clock: { seq: 9, kind: 'loot', playerId: 's02' } }), 0);
  assert.deepEqual(plan, { seq: 9, fireAtServerMs: 1_000_000 + SHOT * 1000, own: true });
  assert.equal(planTimeout(info({ clockAt: undefined }), 0), null);
  assert.equal(planTimeout(null, 0), null);
});
