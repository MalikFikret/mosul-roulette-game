// Per-seat presence and the host role (meta.hostSeat paths A and B), on the local emulator:
// the client module and the security rules. Old absences are seeded with rules disabled
// instead of waiting 60 real seconds.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { goOffline } from 'firebase/database';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, rejectsWithCode, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, seedPresence, setJoinedAt, dumpRoom, write, seedRoom } = roomFixtures(rt);

const BOB_PIN = seedPin(1); // bob sits in s02, carol in s03, dave in s04
const ago = (ms) => Date.now() - ms;
const present = (lastSeenAt = ago(5000)) => ({ conns: { seeded: true }, lastSeenAt });
const absent = (ms) => ({ lastSeenAt: ago(ms) });

function presenceUpdate(seatId, connId = 'c1', { conn = true, lastSeenAt = NOW } = {}) {
  return {
    [`rooms/${CODE}/presence/${seatId}/conns/${connId}`]: conn,
    [`rooms/${CODE}/presence/${seatId}/lastSeenAt`]: lastSeenAt,
  };
}

const presenceOf = async (seatId) => (await dumpRoom()).presence?.[seatId] ?? null;
const connCount = (entry) => Object.keys(entry?.conns ?? {}).length;
const setHost = (uid, seatId) => rt.userDb(uid).ref(`rooms/${CODE}/meta/hostSeat`).set(seatId);
const hostSeat = async () => (await dumpRoom()).meta.hostSeat;

describe('rules: presence', () => {
  test('a member writes their own seat presence; nobody else can write it', async () => {
    await seedRoom(['bob', 'carol']);
    await assertSucceeds(write(rt.userDb('bob'), presenceUpdate('s02')));
    await assertSucceeds(rt.userDb('bob').ref(`rooms/${CODE}/presence/s02/conns/c1`).remove());
    await assertFails(write(rt.userDb('bob'), presenceUpdate('s03')));
    await assertFails(write(rt.userDb('host'), presenceUpdate('s02')));
    await assertFails(write(rt.userDb('dave'), presenceUpdate('s02')));
    await assertFails(write(rt.guestDb(), presenceUpdate('s02')));
    await assertFails(write(rt.userDb('dave'), presenceUpdate('s05')));
  });

  test('presence values: conns true only, lastSeenAt server time only, no extra fields', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob');
    await assertFails(write(bob, presenceUpdate('s02', 'c1', { conn: false })));
    await assertFails(write(bob, presenceUpdate('s02', 'c1', { conn: 'yes' })));
    await assertFails(write(bob, presenceUpdate('s02', 'c1', { conn: { nested: true } })));
    await assertFails(write(bob, presenceUpdate('s02', 'bad id')));
    await assertFails(write(bob, presenceUpdate('s02', 'c1', { lastSeenAt: Date.now() + 60000 })));
    await assertFails(write(bob, presenceUpdate('s02', 'c1', { lastSeenAt: ago(61000) })));
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02/extra`).set(1));
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02`).set({ conns: { c1: true }, lastSeenAt: NOW }));
    await assertSucceeds(write(bob, presenceUpdate('s02')));
    await assertFails(bob.ref(`rooms/${CODE}/presence/s02/lastSeenAt`).remove());
  });

  test('presence is readable by members only', async () => {
    await seedRoom(['bob']);
    await seedPresence({ s02: present() });
    await assertSucceeds(rt.userDb('host').ref(`rooms/${CODE}/presence`).get());
    await assertSucceeds(rt.userDb('bob').ref(`rooms/${CODE}/presence/s02`).get());
    for (const db of [rt.userDb('carol'), rt.guestDb()]) {
      await assertFails(db.ref(`rooms/${CODE}/presence`).get());
      await assertFails(db.ref(`rooms/${CODE}/presence/s02`).get());
      await assertFails(db.ref(`rooms/${CODE}/presence/s02/conns`).get());
    }
  });

  test('two connections on one seat: removing one keeps the seat present', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob');
    await assertSucceeds(write(bob, presenceUpdate('s02', 'tabA')));
    await assertSucceeds(write(bob, presenceUpdate('s02', 'tabB')));
    await assertSucceeds(bob.ref(`rooms/${CODE}/presence/s02/conns/tabA`).remove());
    assert.deepEqual((await presenceOf('s02')).conns, { tabB: true });
    await assertSucceeds(bob.ref(`rooms/${CODE}/presence/s02/conns/tabB`).remove());
    assert.equal(connCount(await presenceOf('s02')), 0);
  });

  test('after recoverSeat the old device cannot write that seat\'s presence; the new device can', async () => {
    await seedRoom(['bob']);
    await assertSucceeds(write(rt.userDb('bob'), presenceUpdate('s02', 'oldTab')));
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    // The recovery cleared the old device's connections and stamped lastSeenAt.
    const entry = await presenceOf('s02');
    assert.equal(connCount(entry), 0);
    assert.equal(typeof entry.lastSeenAt, 'number');
    const old = rt.userDb('bob');
    await assertFails(write(old, presenceUpdate('s02', 'oldTab')));
    await assertFails(old.ref(`rooms/${CODE}/presence/s02/lastSeenAt`).set(NOW));
    await assertFails(old.ref(`rooms/${CODE}/presence/s02/conns/oldTab`).remove());
    await assertFails(old.ref(`rooms/${CODE}/presence`).get());
    await assertSucceeds(write(rt.userDb('bob2'), presenceUpdate('s02', 'newTab')));
  });
});

describe('startPresence (module + onDisconnect)', () => {
  test('startPresence marks the seat present; going offline makes it absent and stamps lastSeenAt', async () => {
    await seedRoom(['bob']);
    const { api, db } = liveRoomsApi('bob');
    const errors = [];
    api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: (e) => errors.push(e) });
    await waitFor(async () => connCount(await presenceOf('s02')) === 1, { what: 'bob present' });
    const before = Date.now();
    goOffline(db);
    const entry = await waitFor(async () => {
      const e = await presenceOf('s02');
      return connCount(e) === 0 && typeof e?.lastSeenAt === 'number' ? e : null;
    }, { what: 'onDisconnect cleanup' });
    assert.ok(entry.lastSeenAt >= before - 1000, 'lastSeenAt was stamped at disconnect time');
    assert.deepEqual(errors, []);
  });

  test('two tabs: closing one keeps the seat present, closing both makes it absent', async () => {
    await seedRoom(['bob']);
    const tab1 = liveRoomsApi('bob');
    const tab2 = liveRoomsApi('bob');
    tab1.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    tab2.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    await waitFor(async () => connCount(await presenceOf('s02')) === 2, { what: 'two connections' });
    goOffline(tab1.db);
    await waitFor(async () => connCount(await presenceOf('s02')) === 1, { what: 'one connection left' });
    await wait(300);
    assert.equal(connCount(await presenceOf('s02')), 1, 'still present through the second tab');
    goOffline(tab2.db);
    await waitFor(async () => connCount(await presenceOf('s02')) === 0, { what: 'no connection' });
  });

  test('stop() removes the connection and stamps lastSeenAt; a second start on the same db stays present', async () => {
    await seedRoom(['bob']);
    const { api, db } = liveRoomsApi('bob');
    const stopA = api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    const stopB = api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' });
    await waitFor(async () => connCount(await presenceOf('s02')) === 2, { what: 'two connections' });
    await stopA();
    const entry = await presenceOf('s02');
    assert.equal(connCount(entry), 1);
    assert.equal(typeof entry.lastSeenAt, 'number');
    // The remaining call still has its server-side cleanup: a drop now makes the seat absent.
    const seenBefore = entry.lastSeenAt;
    goOffline(db);
    const after = await waitFor(async () => {
      const e = await presenceOf('s02');
      return connCount(e) === 0 ? e : null;
    }, { what: 'cleanup of the second call' });
    assert.ok(after.lastSeenAt >= seenBefore);
    void stopB; // not called: while offline its write would only be queued locally
  });

  test('a device that lost its seat by recovery cannot change that seat\'s presence at disconnect time', async () => {
    await seedRoom(['bob']);
    const old = liveRoomsApi('bob');
    const errors = [];
    old.api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: (e) => errors.push(e) });
    await waitFor(async () => connCount(await presenceOf('s02')) === 1, { what: 'old device present' });
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    const fresh = liveRoomsApi('bob2');
    fresh.api.startPresence({ uid: 'bob2', code: CODE, seatId: 's02' });
    await waitFor(async () => connCount(await presenceOf('s02')) === 1, { what: 'new device present' });
    const seenAfterRecovery = (await presenceOf('s02')).lastSeenAt;

    goOffline(old.db);
    await wait(1000);
    const entry = await presenceOf('s02');
    assert.equal(connCount(entry), 1, 'the new device is still present');
    assert.equal(entry.lastSeenAt, seenAfterRecovery, 'the old device\'s onDisconnect did not stamp lastSeenAt');
  });

  test('presence functions need the extra deps; the original deps still work for the rest', async () => {
    await seedRoom(['bob']);
    const api = roomsApi('bob');
    assert.throws(() => api.startPresence({ uid: 'bob', code: CODE, seatId: 's02' }), { code: ROOM_ERR.INVALID_DEPENDENCIES });
    assert.throws(() => api.watchHost({ uid: 'bob', code: CODE }), { code: ROOM_ERR.INVALID_DEPENDENCIES });
    await rejectsWithCode(api.tryTakeOverHost({ uid: 'bob', code: CODE }), ROOM_ERR.INVALID_DEPENDENCIES);
    assert.deepEqual(await api.joinRoom({ uid: 'bob', code: CODE, name: 'Bob', pin: BOB_PIN }), { seatId: 's02' });
    const { api: live } = liveRoomsApi('bob');
    assert.throws(() => live.startPresence({ uid: 'bob', code: CODE, seatId: 's16' }), { code: ROOM_ERR.INVALID_SEAT });
  });
});

describe('rules: hostSeat path A (the host hands over)', () => {
  test('the host moves hostSeat to another occupied seat; refused to an empty, the same or an invalid seat', async () => {
    await seedRoom(['bob', 'carol']);
    await assertFails(setHost('host', 's05'));
    await assertFails(setHost('host', 's01'));
    await assertFails(setHost('host', 's16'));
    await assertFails(setHost('host', 7));
    await assertSucceeds(setHost('host', 's02'));
    assert.equal(await hostSeat(), 's02');
    // The old host is now a normal player; the new host can hand over again.
    await assertFails(setHost('host', 's01'));
    await assertSucceeds(setHost('bob', 's03'));
  });

  test('a non-host member, a non-member and a stale member cannot use path A', async () => {
    await seedRoom(['bob', 'carol']);
    await seedPresence({ s01: present() });
    await assertFails(setHost('bob', 's03'));
    await assertFails(setHost('dave', 's02'));
    await roomsApi('host2').recoverSeat({ uid: 'host2', code: CODE, seatId: 's01', pin: '1357' });
    await assertFails(setHost('host', 's02'), 'stale host');
    await assertSucceeds(setHost('host2', 's02'));
  });

  test('handOverHost: the host hands over; anyone else gets WRITE_DENIED', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(roomsApi('bob').handOverHost({ uid: 'bob', code: CODE, seatId: 's02' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('host').handOverHost({ uid: 'host', code: CODE, seatId: 's09' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('host').handOverHost({ uid: 'host', code: CODE, seatId: 'x' }), ROOM_ERR.INVALID_SEAT);
    assert.deepEqual(await roomsApi('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' }), { hostSeat: 's02' });
  });
});

describe('rules: hostSeat path B (takeover after 60 s of host absence)', () => {
  test('refused while the host is present, even with an old lastSeenAt', async () => {
    await seedRoom(['bob']);
    await seedPresence({ s01: present(ago(600000)), s02: present() });
    await assertFails(setHost('bob', 's02'));
  });

  test('refused when the host has been absent 30 s; accepted at 61 s to a present seat', async () => {
    await seedRoom(['bob', 'carol']);
    await seedPresence({ s01: absent(30000), s02: present() });
    await assertFails(setHost('bob', 's02'));
    await seedPresence({ s01: absent(61000), s02: present() });
    // carol (absent herself) may make the move, but only to a present seat.
    await assertSucceeds(setHost('carol', 's02'));
    assert.equal(await hostSeat(), 's02');
  });

  test('refused to an absent seat or an empty seat, even after 61 s', async () => {
    await seedRoom(['bob', 'carol']);
    await seedPresence({ s01: absent(61000), s02: present(), s03: absent(1000) });
    await assertFails(setHost('bob', 's03'));
    await assertFails(setHost('carol', 's03'));
    await assertFails(setHost('bob', 's09'));
    await assertFails(setHost('bob', 's01'));
  });

  test('refused for a non-member and a stale member', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await seedPresence({ s01: absent(61000), s02: present(), s03: present() });
    await assertFails(setHost('dave', 's03'));
    await assertFails(setHost('bob', 's03'), 'stale member');
    await assertSucceeds(setHost('bob2', 's03'));
  });

  test('with no presence entry for the host, joinedAt is the absent-since time', async () => {
    await seedRoom(['bob']);
    await seedPresence({ s02: present() });
    await setJoinedAt('s01', ago(30000));
    await assertFails(setHost('bob', 's02'));
    await setJoinedAt('s01', ago(61000));
    await assertSucceeds(setHost('bob', 's02'));
  });

  test('other meta fields still cannot change, by the host or after a takeover', async () => {
    await seedRoom(['bob']);
    await seedPresence({ s01: absent(61000), s02: present() });
    const changes = { visibility: 'public', mode: 'custom', status: 'playing', createdAt: NOW };
    for (const uid of ['host', 'bob']) {
      for (const [field, value] of Object.entries(changes)) {
        await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/meta/${field}`).set(value));
      }
      await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/meta`).update({ hostSeat: 's02', visibility: 'public' }));
      await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/meta/hostSeat`).remove());
    }
    await assertSucceeds(setHost('bob', 's02'));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/meta/status`).set('playing'));
  });
});

describe('tryTakeOverHost and watchHost (module)', () => {
  test('tryTakeOverHost: moved:false while the host is present, moved:true to a present seat after 61 s', async () => {
    await seedRoom(['bob', 'carol', 'dave']);
    const { api } = liveRoomsApi('bob');
    await seedPresence({ s01: present(), s02: present(), s03: present() });
    assert.deepEqual(await api.tryTakeOverHost({ uid: 'bob', code: CODE }), { moved: false, hostSeat: 's01', reason: 'hostPresent' });
    await seedPresence({ s01: absent(30000), s02: present(), s03: present() });
    assert.deepEqual(await api.tryTakeOverHost({ uid: 'bob', code: CODE }), { moved: false, hostSeat: 's01', reason: 'tooEarly' });

    await seedPresence({ s01: absent(61000), s02: present(), s03: present(), s04: absent(1000) });
    const result = await api.tryTakeOverHost({ uid: 'bob', code: CODE, random: () => 0.99 });
    assert.deepEqual(result, { moved: true, hostSeat: 's03' });
    assert.equal(await hostSeat(), 's03');
  });

  test('tryTakeOverHost: scores pick the highest present seat; no present seat -> moved:false', async () => {
    await seedRoom(['bob', 'carol', 'dave']);
    const { api } = liveRoomsApi('carol');
    await seedPresence({ s01: absent(61000), s02: present(), s03: present(), s04: absent(70000) });
    await seedPresence({ s01: absent(61000) });
    assert.deepEqual(await api.tryTakeOverHost({ uid: 'carol', code: CODE }), { moved: false, hostSeat: 's01', reason: 'noCandidate' });
    await seedPresence({ s01: absent(61000), s02: present(), s03: present(), s04: absent(70000) });
    const scores = { s02: 3, s03: 8, s04: 50 };
    assert.deepEqual(await api.tryTakeOverHost({ uid: 'carol', code: CODE, scores }), { moved: true, hostSeat: 's03' });
  });

  test('tryTakeOverHost: a refused write is moved:false with the current host; non-members get NOT_MEMBER', async () => {
    await seedRoom(['bob', 'carol']);
    await seedPresence({ s01: absent(61000), s02: present(), s03: present() });
    // bob's view is stale: the host comes back between bob's read and bob's write.
    const { api } = liveRoomsApi('bob', {
      random: () => 0,
      now: () => Date.now(),
    });
    await assertSucceeds(setHost('host', 's03'));
    // s03 is now the host and present: nothing to do.
    assert.deepEqual(await api.tryTakeOverHost({ uid: 'bob', code: CODE }), { moved: false, hostSeat: 's03', reason: 'hostPresent' });
    // A client clock far ahead makes the client try too early: the rules refuse.
    await seedPresence({ s01: present(), s02: present(), s03: absent(10000) });
    const { api: skewed } = liveRoomsApi('bob', { now: () => Date.now() + 120000 });
    assert.deepEqual(await skewed.tryTakeOverHost({ uid: 'bob', code: CODE }), { moved: false, hostSeat: 's03', reason: 'refused' });
    const { api: outsider } = liveRoomsApi('eve');
    await rejectsWithCode(outsider.tryTakeOverHost({ uid: 'eve', code: CODE }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(outsider.tryTakeOverHost({ uid: 'eve', code: 'ZZZ999' }), ROOM_ERR.ROOM_NOT_FOUND);
  });

  test('watchHost moves the role to a present seat once the host has been absent long enough', async () => {
    await seedRoom(['bob', 'carol']);
    await seedPresence({ s01: absent(61000), s03: present() });
    const { api } = liveRoomsApi('bob');
    const results = [];
    const errors = [];
    const stop = api.watchHost({ uid: 'bob', code: CODE, onResult: (r) => results.push(r), onError: (e) => errors.push(e) });
    try {
      await waitFor(async () => (await hostSeat()) === 's03', { timeout: 6000, what: 'takeover by watchHost' });
      await waitFor(() => results.length > 0, { what: 'onResult' });
      assert.deepEqual(results[0], { moved: true, hostSeat: 's03' });
      assert.deepEqual(errors, []);
    } finally {
      stop();
    }
  });

  test('watchHost does nothing while the host is present, and reports a non-member to onError', async () => {
    await seedRoom(['bob']);
    await seedPresence({ s01: present(ago(600000)), s02: present() });
    const { api } = liveRoomsApi('bob');
    const results = [];
    const stop = api.watchHost({ uid: 'bob', code: CODE, onResult: (r) => results.push(r) });
    const errors = [];
    const { api: outsider } = liveRoomsApi('eve');
    const stopOutsider = outsider.watchHost({ uid: 'eve', code: CODE, onError: (e) => errors.push(e) });
    try {
      await wait(1500);
      assert.deepEqual(results, []);
      assert.equal(await hostSeat(), 's01');
      await waitFor(() => errors.length > 0, { what: 'onError for the non-member' });
    } finally {
      stop();
      stopOutsider();
    }
  });
});
