// Unique seat names (names/ index), renaming and kicking seats, on the local emulator: the
// client module (joinRoom, renameSeat, kickSeat) and the security rules.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { goOffline, update } from 'firebase/database';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, NOW, PIN, rejectsWithCode, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, seedPresence, dumpRoom, joinUpdate, claimUpdate, write, seedRoom } = roomFixtures(rt);

const BOB_PIN = seedPin(1); // seedRoom: host "Host" in s01, then joiners named after their uid
const FORBIDDEN = ['.', '$', '#', '[', ']', '/'];
const present = () => ({ conns: { seeded: true }, lastSeenAt: Date.now() - 5000 });
const setStatus = (status) => rt.withRulesDisabled((db) => db.ref(`rooms/${CODE}/meta/status`).set(status));
const join = (uid, name, code = CODE) => roomsApi(uid).joinRoom({ uid, code, name, pin: PIN });

// The names index must be exactly one entry per seat, under the seat's name in lower case.
function assertNamesInSync(room) {
  const expected = {};
  for (const [seatId, seat] of Object.entries(room.seats ?? {})) expected[seat.name.toLowerCase()] = seatId;
  assert.deepEqual(room.names ?? {}, expected, 'names index out of sync with the seats');
}

// A raw rename: the seat's name, and the names entries to delete / create.
function renameUpdate(seatId, newName, { oldKey, newKey = newName.toLowerCase() } = {}) {
  const values = { [`rooms/${CODE}/seats/${seatId}/name`]: newName };
  if (oldKey !== undefined) values[`rooms/${CODE}/names/${oldKey}`] = null;
  if (newKey !== null) values[`rooms/${CODE}/names/${newKey}`] = seatId;
  return values;
}

// A raw kick of `seatId` (held by `uid`, named `nameKey` in lower case).
function kickUpdate(seatId, uid, nameKey = uid.toLowerCase(), extra = {}) {
  return {
    [`rooms/${CODE}/seats/${seatId}`]: null,
    [`rooms/${CODE}/secrets/${seatId}`]: null,
    [`rooms/${CODE}/claims/${seatId}`]: null,
    [`rooms/${CODE}/presence/${seatId}`]: null,
    [`rooms/${CODE}/names/${nameKey}`]: null,
    [`rooms/${CODE}/members/${uid}`]: null,
    ...extra,
  };
}

describe('names: unique per room, case-insensitive', () => {
  test('createRoom and joinRoom write the names entry; a taken name in any case is NAME_TAKEN', async () => {
    const { code } = await roomsApi('alice').createRoom({ uid: 'alice', name: 'Ali', pin: PIN, visibility: 'private', mode: 'classic' });
    assert.deepEqual((await dumpRoom(code)).names, { ali: 's01' });
    const before = await dumpRoom(code);
    for (const name of ['Ali', 'ali', 'ALI', '  aLi ']) {
      await rejectsWithCode(join('bob', name, code), ROOM_ERR.NAME_TAKEN);
    }
    assert.deepEqual(await dumpRoom(code), before);
    assert.deepEqual(await join('bob', 'Alice', code), { seatId: 's02' });
    const room = await dumpRoom(code);
    assert.deepEqual(room.names, { ali: 's01', alice: 's02' });
    assertNamesInSync(room);
  });

  test('two simultaneous joins with the same name: exactly one succeeds', async () => {
    for (const [nameA, nameB] of [['Sami', 'Sami'], ['Sami', 'SAMI']]) {
      await rt.env.clearDatabase();
      await seedRoom();
      const results = await Promise.allSettled([join('u1', nameA), join('u2', nameB)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      assert.equal(ok.length, 1);
      assert.equal(refused.length, 1);
      assert.equal(refused[0].reason.code, ROOM_ERR.NAME_TAKEN);
      const room = await dumpRoom();
      assert.equal(Object.keys(room.seats).length, 2);
      assertNamesInSync(room);
    }
  });

  test('a refused join caused by a name taken meanwhile ends as NAME_TAKEN', async () => {
    await seedRoom();
    // Eve's first write is held back until Zed has taken the same name.
    let first = true;
    const slowUpdate = async (reference, values) => {
      if (first) {
        first = false;
        await join('zed', 'Nour');
      }
      return update(reference, values);
    };
    await rejectsWithCode(
      roomsApi('eve', { update: slowUpdate }).joinRoom({ uid: 'eve', code: CODE, name: 'NOUR', pin: PIN }),
      ROOM_ERR.NAME_TAKEN,
    );
    assertNamesInSync(await dumpRoom());
  });

  test('names with . $ # [ ] / are refused by the client and by the rules', async () => {
    await seedRoom(['bob']);
    for (const ch of FORBIDDEN) {
      const name = `a${ch}b`;
      await rejectsWithCode(join('eve', name), ROOM_ERR.INVALID_NAME);
      await rejectsWithCode(
        roomsApi('eve').createRoom({ uid: 'eve', name, pin: PIN, visibility: 'private', mode: 'classic' }),
        ROOM_ERR.INVALID_NAME,
      );
      await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name }), ROOM_ERR.INVALID_NAME);
      // Raw writes: such a name cannot be a key, so a names entry can only sit under another key.
      await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's03', { name, nameKey: 'ab' })));
      await assertFails(write(rt.userDb('eve'), joinUpdate('eve', 's03', { name, nameKey: null })));
      await assertFails(write(rt.userDb('bob'), renameUpdate('s02', name, { oldKey: 'bob', newKey: 'ab' })));
    }
    assertNamesInSync(await dumpRoom());
  });

  test('a seat name needs its own names entry: missing, under another key, or pointing elsewhere is refused', async () => {
    await seedRoom(['bob']);
    const eve = rt.userDb('eve');
    await assertFails(write(eve, joinUpdate('eve', 's03', { name: 'Eve', nameKey: null })));
    await assertFails(write(eve, joinUpdate('eve', 's03', { name: 'Eve', nameKey: 'other' })));
    await assertFails(write(eve, joinUpdate('eve', 's03', { name: 'Eve', nameKey: 'Eve' })), 'key must be lower case');
    const pointsElsewhere = joinUpdate('eve', 's03', { name: 'Eve', nameKey: null });
    pointsElsewhere[`rooms/${CODE}/names/eve`] = 's04';
    await assertFails(write(eve, pointsElsewhere));
    await assertSucceeds(write(eve, joinUpdate('eve', 's03', { name: 'Eve' })));
  });

  test('names entries cannot be forged, overwritten or deleted on their own', async () => {
    await seedRoom(['bob', 'carol']);
    const bob = rt.userDb('bob');
    await assertFails(bob.ref(`rooms/${CODE}/names/zzz`).set('s02'), 'entry for a name no seat has');
    await assertFails(bob.ref(`rooms/${CODE}/names/bob`).set('s03'), 'overwrite with another seat');
    await assertFails(bob.ref(`rooms/${CODE}/names/carol`).set('s02'), 'overwrite another seat\'s entry');
    await assertFails(bob.ref(`rooms/${CODE}/names/carol`).remove(), 'delete another seat\'s entry');
    await assertFails(bob.ref(`rooms/${CODE}/names/bob`).remove(), 'delete own entry while the seat keeps the name');
    await assertFails(bob.ref(`rooms/${CODE}/names/s05`).set('s05'), 'entry for an empty seat');
    await assertFails(rt.userDb('stranger').ref(`rooms/${CODE}/names/x`).set('s05'));
    await assertFails(rt.guestDb().ref(`rooms/${CODE}/names`).get());
    // Any signed-in user who knows the code reads the index (like the seat names).
    const index = await assertSucceeds(rt.userDb('stranger').ref(`rooms/${CODE}/names`).get());
    assert.deepEqual(index.val(), { host: 's01', bob: 's02', carol: 's03' });
    assertNamesInSync(await dumpRoom());
  });

  test('the rules\' toLowerCase agrees with the client key: Turkish, Arabic, accented Latin, emoji', async () => {
    await seedRoom();
    const names = ['İstanbul', 'IRMAK', 'ılık', 'Şeker', 'Ğ harfi', 'محمد علي', 'Élodie', 'Ali 😀'];
    for (const [i, name] of names.entries()) {
      const uid = `u${i}`;
      const result = await join(uid, name);
      const room = await dumpRoom();
      assert.equal(room.names[name.toLowerCase()], result.seatId, `${name}: key ${JSON.stringify(name.toLowerCase())}`);
    }
    const room = await dumpRoom();
    assertNamesInSync(room);
    // Case-insensitive collisions follow the same folding: IRMAK = irmak, but not ırmak (dotless).
    await rejectsWithCode(join('x1', 'irmak'), ROOM_ERR.NAME_TAKEN);
    await rejectsWithCode(join('x2', 'İSTANBUL'), ROOM_ERR.NAME_TAKEN);
    await rejectsWithCode(join('x3', 'ÉLODIE'), ROOM_ERR.NAME_TAKEN);
    assert.ok((await join('x4', 'ırmak')).seatId);
  });

  test('leaving frees the name; the last player deleting the room leaves no names behind', async () => {
    await seedRoom(['bob']);
    await roomsApi('bob').leaveRoom({ uid: 'bob', code: CODE });
    assert.deepEqual((await dumpRoom()).names, { host: 's01' });
    assert.deepEqual(await join('eve', 'BOB'), { seatId: 's02' });
    assertNamesInSync(await dumpRoom());
    await roomsApi('eve').leaveRoom({ uid: 'eve', code: CODE });
    await roomsApi('host').leaveRoom({ uid: 'host', code: CODE });
    assert.equal(await dumpRoom(), null);
  });
});

describe('renameSeat', () => {
  test('a player renames their own seat: old key gone, new key present', async () => {
    await seedRoom(['bob', 'carol']);
    assert.deepEqual(await roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: ' Robert ' }), {
      seatId: 's02',
      name: 'Robert',
    });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.name, 'Robert');
    assert.equal(room.names.bob, undefined);
    assert.equal(room.names.robert, 's02');
    assertNamesInSync(room);
  });

  test('the host renames another seat; an ordinary player cannot', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('host').renameSeat({ uid: 'host', code: CODE, seatId: 's03', name: 'Caro' });
    await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's03', name: 'Bad' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's01', name: 'Bad' }), ROOM_ERR.WRITE_DENIED);
    await assertFails(write(rt.userDb('bob'), renameUpdate('s03', 'Bad', { oldKey: 'caro' })));
    await assertFails(write(rt.userDb('stranger'), renameUpdate('s03', 'Bad', { oldKey: 'caro' })));
    const room = await dumpRoom();
    assert.equal(room.seats.s03.name, 'Caro');
    assertNamesInSync(room);
  });

  test('renaming to a taken name (any case) is refused; a case-only rename works', async () => {
    await seedRoom(['bob', 'carol']);
    await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: 'CAROL' }), ROOM_ERR.NAME_TAKEN);
    await rejectsWithCode(roomsApi('host').renameSeat({ uid: 'host', code: CODE, seatId: 's02', name: 'host' }), ROOM_ERR.NAME_TAKEN);
    await assertFails(write(rt.userDb('bob'), renameUpdate('s02', 'Carol', { oldKey: 'bob' })));
    await roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: 'BOB' });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.name, 'BOB');
    assert.equal(room.names.bob, 's02');
    assertNamesInSync(room);
    // Raw case-only rename, writing the same names entry again, also works.
    await assertSucceeds(write(rt.userDb('bob'), renameUpdate('s02', 'Bob', { newKey: 'bob' })));
  });

  test('a raw rename must move the names entry: keeping the old key or skipping the new one is refused', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob');
    await assertFails(write(bob, renameUpdate('s02', 'Robert')), 'old entry kept');
    await assertFails(write(bob, renameUpdate('s02', 'Robert', { oldKey: 'bob', newKey: null })), 'new entry missing');
    await assertFails(bob.ref(`rooms/${CODE}/seats/s02/name`).set('Robert'));
    await assertSucceeds(write(bob, renameUpdate('s02', 'Robert', { oldKey: 'bob' })));
    assertNamesInSync(await dumpRoom());
  });

  test('renameSeat errors: not a member, empty seat, not in the lobby, stale member, bad input', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(roomsApi('dave').renameSeat({ uid: 'dave', code: CODE, seatId: 's02', name: 'X' }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(roomsApi('host').renameSeat({ uid: 'host', code: CODE, seatId: 's09', name: 'X' }), ROOM_ERR.SEAT_EMPTY);
    await rejectsWithCode(roomsApi('host').renameSeat({ uid: 'host', code: 'ZZZ999', seatId: 's02', name: 'X' }), ROOM_ERR.ROOM_NOT_FOUND);
    await rejectsWithCode(roomsApi('host').renameSeat({ uid: 'host', code: CODE, seatId: 's16', name: 'X' }), ROOM_ERR.INVALID_SEAT);
    await rejectsWithCode(roomsApi('host').renameSeat({ uid: 'host', code: CODE, seatId: 's02', name: '' }), ROOM_ERR.INVALID_NAME);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await rejectsWithCode(roomsApi('bob').renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: 'X' }), ROOM_ERR.NOT_MEMBER);
    await assertFails(write(rt.userDb('bob'), renameUpdate('s02', 'X', { oldKey: 'bob' })), 'stale member');
    await setStatus('playing');
    await rejectsWithCode(roomsApi('bob2').renameSeat({ uid: 'bob2', code: CODE, seatId: 's02', name: 'X' }), ROOM_ERR.NOT_IN_LOBBY);
    await assertFails(write(rt.userDb('bob2'), renameUpdate('s02', 'X', { oldKey: 'bob' })));
    await assertFails(write(rt.userDb('host'), renameUpdate('s02', 'X', { oldKey: 'bob' })));
  });

  test('a refused rename caused by a name taken meanwhile ends as NAME_TAKEN', async () => {
    await seedRoom(['bob']);
    let first = true;
    const slowUpdate = async (reference, values) => {
      if (first) {
        first = false;
        await join('zed', 'Layla');
      }
      return update(reference, values);
    };
    await rejectsWithCode(
      roomsApi('bob', { update: slowUpdate }).renameSeat({ uid: 'bob', code: CODE, seatId: 's02', name: 'layla' }),
      ROOM_ERR.NAME_TAKEN,
    );
    assertNamesInSync(await dumpRoom());
  });
});

describe('kickSeat', () => {
  test('the host kicks a seat: seat, secret, claim, presence, names entry and all its members entries are gone', async () => {
    await seedRoom(['bob', 'carol']);
    // A stale entry (bob after a recovery to bob2), a claim and presence on the seat.
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await seedPresence({ s02: present(), s03: present() });
    const before = await dumpRoom();
    assert.ok(before.claims.s02 && before.members.bob && before.members.bob2);

    assert.deepEqual(await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's02' }), { seatId: 's02' });
    const room = await dumpRoom();
    assert.equal(room.seats.s02, undefined);
    assert.equal(room.secrets.s02, undefined);
    assert.equal(room.claims, undefined);
    assert.equal(room.presence.s02, undefined);
    assert.equal(room.names.bob, undefined);
    assert.equal(room.members.bob, undefined);
    assert.equal(room.members.bob2, undefined);
    assert.deepEqual(room.seats.s03, before.seats.s03);
    assert.equal(room.meta.hostSeat, 's01');
    assertNamesInSync(room);
  });

  test('after a kick, a new joiner can take the same seat id, and the kicked player can join again', async () => {
    await seedRoom(['bob', 'carol']);
    await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's02' });
    assert.deepEqual(await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: '7070' }), { seatId: 's02' });
    assert.equal((await dumpRoom()).secrets.s02, '7070');
    // No ban: bob joins again (his old name is free again).
    assert.deepEqual(await roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'bob', pin: '1212' }), { seatId: 's04' });
    assertNamesInSync(await dumpRoom());
  });

  test('only the host kicks, never their own seat, only in the lobby; strangers cannot kick', async () => {
    await seedRoom(['bob', 'carol']);
    await rejectsWithCode(roomsApi('bob').kickSeat({ uid: 'bob', code: CODE, seatId: 's03' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's01' }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('dave').kickSeat({ uid: 'dave', code: CODE, seatId: 's03' }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's09' }), ROOM_ERR.SEAT_EMPTY);
    await rejectsWithCode(roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 'x' }), ROOM_ERR.INVALID_SEAT);
    // Raw writes.
    await assertFails(write(rt.userDb('bob'), kickUpdate('s03', 'carol')), 'ordinary player');
    await assertFails(write(rt.userDb('dave'), kickUpdate('s03', 'carol')), 'stranger');
    await assertFails(write(rt.guestDb(), kickUpdate('s03', 'carol')), 'guest');
    await assertFails(write(rt.userDb('host'), kickUpdate('s01', 'host')), 'host kicking their own seat');
    await setStatus('playing');
    await rejectsWithCode(roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's03' }), ROOM_ERR.NOT_IN_LOBBY);
    await assertFails(write(rt.userDb('host'), kickUpdate('s03', 'carol')), 'not in the lobby');
    await setStatus('lobby');
    await assertSucceeds(write(rt.userDb('host'), kickUpdate('s03', 'carol')));
    assertNamesInSync(await dumpRoom());
  });

  test('a raw kick must remove every node of the seat together', async () => {
    await seedRoom(['bob']);
    await write(rt.userDb('dave'), claimUpdate('dave', 's02', '0000'));
    await seedPresence({ s02: present() });
    const host = rt.userDb('host');
    const full = kickUpdate('s02', 'bob');
    for (const keep of Object.keys(full)) {
      const partial = { ...full };
      delete partial[keep];
      await assertFails(write(host, partial), `kick keeping ${keep}`);
    }
    // A kick does not reach other seats' nodes or the host role.
    await assertFails(write(host, { ...full, [`rooms/${CODE}/secrets/s01`]: null }));
    await assertFails(write(host, { ...full, [`rooms/${CODE}/meta/hostSeat`]: 's02' }));
    await assertSucceeds(write(host, full));
    assertNamesInSync(await dumpRoom());
  });

  test('the kicked device stops its presence and host watcher and reports one SEAT_LOST each', async () => {
    await seedRoom(['bob', 'carol']);
    const { api, db } = liveRoomsApi('bob');
    const presenceErrors = [];
    const watchErrors = [];
    api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: (e) => presenceErrors.push(e) });
    api.watchHost({ uid: 'bob', code: CODE, onError: (e) => watchErrors.push(e) });
    await waitFor(async () => (await dumpRoom()).presence?.s02, { what: 'bob present' });

    await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's02' });
    await waitFor(() => presenceErrors.length > 0 && watchErrors.length > 0, { what: 'SEAT_LOST reports' });
    await wait(1000);
    assert.deepEqual(presenceErrors.map((e) => e.code), [ROOM_ERR.SEAT_LOST]);
    assert.deepEqual(watchErrors.map((e) => e.code), [ROOM_ERR.SEAT_LOST]);

    // No presence entry comes back for the kicked seat, also not when the device disconnects.
    goOffline(db);
    await wait(800);
    const room = await dumpRoom();
    assert.equal(room.presence?.s02, undefined);
    assert.equal(room.seats.s02, undefined);
    assertNamesInSync(room);
  });

  test('a seat recovered on another device gives the old device the same single SEAT_LOST', async () => {
    await seedRoom(['bob']);
    const { api } = liveRoomsApi('bob');
    const errors = [];
    api.startPresence({ uid: 'bob', code: CODE, seatId: 's02', onError: (e) => errors.push(e) });
    await waitFor(async () => (await dumpRoom()).presence?.s02, { what: 'bob present' });
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await waitFor(() => errors.length > 0, { what: 'SEAT_LOST' });
    await wait(800);
    assert.deepEqual(errors.map((e) => e.code), [ROOM_ERR.SEAT_LOST]);
    assert.equal(typeof NOW, 'object');
  });
});
