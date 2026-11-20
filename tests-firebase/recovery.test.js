// Seat PINs (secrets/), readable seat names, and seat recovery on another device (claims/ and
// the transfer), on the local emulator: the client module and the security rules.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, HOST_PIN, PIN, rejectsWithCode, roomFixtures, seedPin, wait } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, dumpRoom, joinUpdate, claimUpdate, transferUpdate, write, seedRoom } = roomFixtures(rt);

const BOB_PIN = seedPin(1); // bob sits in s02
const WRONG_PIN = '0000';
const BAD_PINS = ['123', '12345', '12a4', ' 123', ' 1234', '1234 ', 1234, null, ''];
const THROTTLE_MS = 2000;

const MEMBERS_ONLY = ['settings', 'seats', 'seats/s01', 'seats/s02/uid', 'seats/s02/joinedAt', 'members'];

async function canRead(db, path) {
  try {
    await db.ref(`rooms/${CODE}/${path}`).get();
    return true;
  } catch {
    return false;
  }
}

describe('PIN on entry (module)', () => {
  test('createRoom and joinRoom refuse a malformed PIN before any write', async () => {
    for (const pin of BAD_PINS) {
      await rejectsWithCode(
        roomsApi('alice').createRoom({ uid: 'alice', name: 'Alice', pin, visibility: 'private', mode: 'classic' }),
        ROOM_ERR.INVALID_PIN,
      );
    }
    await seedRoom();
    const before = await dumpRoom();
    for (const pin of BAD_PINS) {
      await rejectsWithCode(roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'Bob', pin }), ROOM_ERR.INVALID_PIN);
    }
    assert.deepEqual(await dumpRoom(), before);
  });

  test('the PIN is stored in secrets/{seatId} in the same write as the seat', async () => {
    const { code } = await roomsApi('alice').createRoom({ uid: 'alice', name: 'Alice', pin: '0000', visibility: 'private', mode: 'classic' });
    await roomsApi('bob').joinRoom({ uid: 'bob', code, name: 'Bob', pin: '9999' });
    const room = await dumpRoom(code);
    assert.deepEqual(room.secrets, { s01: '0000', s02: '9999' });
  });

  test('a member re-calling joinRoom gets the seat back with no write (any well-formed PIN)', async () => {
    await seedRoom(['bob']);
    const before = await dumpRoom();
    assert.deepEqual(await roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'Bob', pin: '5555' }), { seatId: 's02' });
    assert.deepEqual(await dumpRoom(), before);
    await rejectsWithCode(roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'Bob', pin: 55 }), ROOM_ERR.INVALID_PIN);
  });
});

describe('rules: secrets and claims', () => {
  test('secrets and claims are readable by nobody: seat owner, other member, non-member, guest', async () => {
    await seedRoom(['bob']);
    await assertSucceeds(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN)));
    const readers = [rt.userDb('host'), rt.userDb('bob'), rt.userDb('carol'), rt.guestDb()];
    for (const db of readers) {
      for (const path of ['secrets', 'secrets/s01', 'secrets/s02', 'claims', 'claims/s02', 'claims/s02/pin']) {
        await assertFails(db.ref(`rooms/${CODE}/${path}`).get());
      }
    }
  });

  test('a secret cannot be written without creating its seat in the same write', async () => {
    await seedRoom(['bob']);
    const carol = rt.userDb('carol');
    await assertFails(carol.ref(`rooms/${CODE}/secrets/s03`).set(PIN));
    // Taking s03 but writing the secret of s04.
    const wrongSeat = joinUpdate('carol', 's03');
    delete wrongSeat[`rooms/${CODE}/secrets/s03`];
    wrongSeat[`rooms/${CODE}/secrets/s04`] = PIN;
    await assertFails(write(carol, wrongSeat));
    // A seat without its secret.
    const noSecret = joinUpdate('carol', 's03');
    delete noSecret[`rooms/${CODE}/secrets/s03`];
    await assertFails(write(carol, noSecret));
    // Malformed PINs.
    for (const pin of BAD_PINS) await assertFails(write(carol, joinUpdate('carol', 's03', { pin })));
    await assertSucceeds(write(carol, joinUpdate('carol', 's03', { pin: '0000' })));
  });

  test('a secret cannot be overwritten or deleted afterwards, by the owner or anyone else', async () => {
    await seedRoom(['bob']);
    for (const uid of ['bob', 'host', 'carol']) {
      await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/secrets/s02`).set('1111'));
      await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/secrets/s02`).remove());
      await assertFails(rt.userDb(uid).ref(`rooms/${CODE}/secrets`).set({ s02: '1111' }));
    }
    assert.equal((await dumpRoom()).secrets.s02, BOB_PIN);
  });

  test('claims: refused for a current member, an empty seat, another uid, a bad PIN, a client time, extra fields', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('bob'), claimUpdate('bob', 's02', BOB_PIN)));
    await assertFails(write(rt.userDb('host'), claimUpdate('host', 's02', BOB_PIN)));
    await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's05', PIN)));
    await assertFails(write(rt.userDb('carol'), claimUpdate('dave', 's02', BOB_PIN)));
    for (const pin of BAD_PINS) await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's02', pin)));
    await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN, { claim: { at: 1700000000000 } })));
    await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN, { claim: { extra: 1 } })));
    await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's16', BOB_PIN)));
    await assertSucceeds(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN)));
  });

  test('a second claim on the same seat within 2 seconds is refused, also from another uid; later it is accepted', async () => {
    await seedRoom(['bob', 'eve']);
    await assertSucceeds(write(rt.userDb('carol'), claimUpdate('carol', 's02', WRONG_PIN)));
    await assertFails(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN)));
    await assertFails(write(rt.userDb('dave'), claimUpdate('dave', 's02', BOB_PIN)));
    await assertFails(rt.userDb('carol').ref(`rooms/${CODE}/claims/s02`).remove());
    // The module reports the refused claim as RETRY_LATER.
    await rejectsWithCode(
      roomsApi('dave').recoverSeat({ uid: 'dave', code: CODE, seatId: 's02', pin: BOB_PIN }),
      ROOM_ERR.RETRY_LATER,
    );
    // The throttle is per seat: another seat can be claimed at once.
    await assertSucceeds(write(rt.userDb('dave'), claimUpdate('dave', 's03', seedPin(2))));

    await wait(THROTTLE_MS + 300);
    await assertSucceeds(write(rt.userDb('dave'), claimUpdate('dave', 's02', BOB_PIN)));
  });
});

describe('rules: transfer', () => {
  test('a transfer without a claim, or with another uid\'s claim, is refused', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('carol'), transferUpdate('carol', 's02')));
    await assertSucceeds(write(rt.userDb('carol'), claimUpdate('carol', 's02', BOB_PIN)));
    await assertFails(write(rt.userDb('dave'), transferUpdate('dave', 's02')));
    assert.equal((await dumpRoom()).seats.s02.uid, 'bob');
  });

  test('a transfer must move only the uid, to yourself, together with your members entry', async () => {
    await seedRoom(['bob']);
    const carol = rt.userDb('carol');
    // Claim and transfer in one update: the transfer only trusts a claim that was already stored.
    await assertFails(write(carol, { ...claimUpdate('carol', 's02', BOB_PIN), ...transferUpdate('carol', 's02') }));
    await assertSucceeds(write(carol, claimUpdate('carol', 's02', BOB_PIN)));
    // The uid must become your own.
    await assertFails(write(carol, transferUpdate('carol', 's02', { seatUid: 'dave' })));
    // The members entry must point to the transferred seat, and must be there.
    await assertFails(write(carol, transferUpdate('carol', 's02', { memberSeat: 's03' })));
    await assertFails(carol.ref(`rooms/${CODE}/seats/s02/uid`).set('carol'));
    // name and joinedAt stay unchanged, and the seat cannot be rewritten as a whole.
    await assertFails(write(carol, { ...transferUpdate('carol', 's02'), [`rooms/${CODE}/seats/s02/name`]: 'Carol' }));
    await assertFails(write(carol, { ...transferUpdate('carol', 's02'), [`rooms/${CODE}/seats/s02/joinedAt`]: { '.sv': 'timestamp' } }));
    const room = await dumpRoom();
    await assertFails(write(carol, {
      [`rooms/${CODE}/seats/s02`]: { ...room.seats.s02, uid: 'carol' },
      [`rooms/${CODE}/members/carol`]: 's02',
    }));
    await assertSucceeds(write(carol, transferUpdate('carol', 's02')));
  });

  test('wrong PIN: the transfer is refused and the seat is unchanged', async () => {
    await seedRoom(['bob']);
    const before = await dumpRoom();
    await rejectsWithCode(
      roomsApi('carol').recoverSeat({ uid: 'carol', code: CODE, seatId: 's02', pin: WRONG_PIN }),
      ROOM_ERR.WRONG_PIN,
    );
    const after = await dumpRoom();
    assert.deepEqual(after.seats, before.seats);
    assert.deepEqual(after.members, before.members);
    assert.deepEqual(after.claims, { s02: { uid: 'carol', pin: WRONG_PIN, at: after.claims.s02.at } });
  });

  test('a member cannot change another player\'s uid, name or joinedAt, recovery-style or otherwise', async () => {
    await seedRoom(['bob', 'carol']);
    const host = rt.userDb('host');
    // A member cannot claim, so there is no claim for the transfer to rely on.
    await assertFails(write(host, claimUpdate('host', 's02', BOB_PIN)));
    await assertFails(write(host, transferUpdate('host', 's02')));
    await assertFails(write(host, transferUpdate('host', 's02', { memberSeat: 's01' })));
    // Even with an old claim made before joining, a member cannot transfer.
    await assertSucceeds(write(rt.userDb('dave'), claimUpdate('dave', 's02', BOB_PIN)));
    await assertSucceeds(write(rt.userDb('dave'), joinUpdate('dave', 's04')));
    await assertFails(write(rt.userDb('dave'), transferUpdate('dave', 's02')));
    for (const [field, value] of [['uid', 'carol'], ['name', 'Renamed'], ['joinedAt', 1]]) {
      await assertFails(rt.userDb('carol').ref(`rooms/${CODE}/seats/s02/${field}`).set(value));
      await assertFails(host.ref(`rooms/${CODE}/seats/s02/${field}`).set(value));
    }
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'bob');
    assert.equal(room.seats.s02.name, 'bob');
  });
});

describe('seat names for non-members', () => {
  test('a non-member reads every seat name, but not uid, joinedAt or the seats branch', async () => {
    await seedRoom(['bob', 'carol']);
    const dave = rt.userDb('dave');
    for (const seatId of ['s01', 's02', 's03', 's04', 's15']) {
      await assertSucceeds(dave.ref(`rooms/${CODE}/seats/${seatId}/name`).get());
    }
    assert.equal((await dave.ref(`rooms/${CODE}/seats/s02/name`).get()).val(), 'bob');
    for (const path of ['seats', 'seats/s02', 'seats/s02/uid', 'seats/s02/joinedAt']) {
      await assertFails(dave.ref(`rooms/${CODE}/${path}`).get());
    }
    await assertFails(rt.guestDb().ref(`rooms/${CODE}/seats/s02/name`).get());
  });

  test('listSeatNames returns occupied seats in seat order', async () => {
    await seedRoom(['bob', 'carol']);
    assert.deepEqual(await roomsApi('dave').listSeatNames({ uid: 'dave', code: CODE.toLowerCase() }), [
      { seatId: 's01', name: 'Host' },
      { seatId: 's02', name: 'bob' },
      { seatId: 's03', name: 'carol' },
    ]);
    await rejectsWithCode(roomsApi('dave').listSeatNames({ uid: 'dave', code: 'ZZZ999' }), ROOM_ERR.ROOM_NOT_FOUND);
    await rejectsWithCode(roomsApi('dave').listSeatNames({ uid: 'dave', code: 'ABC' }), ROOM_ERR.INVALID_CODE);
    await rejectsWithCode(roomsApi('dave').listSeatNames({ uid: 'd/ve', code: CODE }), ROOM_ERR.INVALID_UID);
  });
});

describe('recoverSeat (module + rules)', () => {
  test('correct recovery: new device gets the seat with the same name and joinedAt; the old device loses access', async () => {
    await seedRoom(['bob', 'carol']);
    const before = await dumpRoom();
    const result = await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    assert.deepEqual(result, { seatId: 's02' });

    const room = await dumpRoom();
    assert.deepEqual(room.seats.s02, { ...before.seats.s02, uid: 'bob2' });
    assert.deepEqual(room.seats.s01, before.seats.s01);
    assert.deepEqual(room.seats.s03, before.seats.s03);
    assert.equal(room.members.bob2, 's02');
    assert.equal(room.members.bob, 's02', 'the stale entry stays, it just grants nothing');
    assert.deepEqual(room.meta, before.meta);
    assert.deepEqual(room.secrets, before.secrets);

    const oldDevice = rt.userDb('bob');
    const newDevice = rt.userDb('bob2');
    for (const path of MEMBERS_ONLY) {
      assert.equal(await canRead(oldDevice, path), false, `old device still reads ${path}`);
      assert.equal(await canRead(newDevice, path), true, `new device cannot read ${path}`);
    }
    assert.equal(await canRead(oldDevice, 'meta'), true);
    assert.equal(await canRead(oldDevice, 'members/bob'), true);
    // The stale entry is not a membership for the module either.
    await rejectsWithCode(
      roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's03', pin: seedPin(2) }),
      ROOM_ERR.ALREADY_MEMBER,
    );
    assert.deepEqual(await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: '0000' }), { seatId: 's02' });
  });

  test('the old device can afterwards join again and gets a new free seat', async () => {
    await seedRoom(['bob']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    const { seatId } = await roomsApi('bob').joinRoom({ uid: 'bob', code: CODE, name: 'Bob again', pin: '7777' });
    assert.equal(seatId, 's03');
    const room = await dumpRoom();
    assert.deepEqual(room.members, { host: 's01', bob2: 's02', bob: 's03' });
    assert.equal(room.seats.s03.uid, 'bob');
    assert.equal(await canRead(rt.userDb('bob'), 'settings'), true);
  });

  test('the old device can recover its seat back with the PIN (after the 2 s throttle)', async () => {
    await seedRoom(['bob']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await wait(THROTTLE_MS + 300);
    assert.deepEqual(await roomsApi('bob').recoverSeat({ uid: 'bob', code: CODE, seatId: 's02', pin: BOB_PIN }), { seatId: 's02' });
    const room = await dumpRoom();
    assert.equal(room.seats.s02.uid, 'bob');
    assert.equal(await canRead(rt.userDb('bob'), 'settings'), true);
    assert.equal(await canRead(rt.userDb('bob2'), 'settings'), false);
  });

  test('a user may delete their own stale members entry, but not a valid one or someone else\'s', async () => {
    await seedRoom(['bob']);
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: BOB_PIN });
    await assertFails(rt.userDb('carol').ref(`rooms/${CODE}/members/bob`).remove());
    await assertFails(rt.userDb('bob2').ref(`rooms/${CODE}/members/bob2`).remove());
    await assertFails(rt.userDb('host').ref(`rooms/${CODE}/members/host`).remove());
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/members/bob`).set('s01'));
    await assertSucceeds(rt.userDb('bob').ref(`rooms/${CODE}/members/bob`).remove());
    assert.deepEqual((await dumpRoom()).members, { host: 's01', bob2: 's02' });
  });

  test('recovering s01 makes the new device the host (meta.hostSeat unchanged)', async () => {
    await seedRoom(['bob']);
    await roomsApi('host2').recoverSeat({ uid: 'host2', code: CODE, seatId: 's01', pin: HOST_PIN });
    const room = await dumpRoom();
    assert.equal(room.meta.hostSeat, 's01');
    assert.equal(room.seats.s01.uid, 'host2');
    assert.equal(room.seats.s01.name, 'Host');
    assert.equal(await canRead(rt.userDb('host2'), 'settings'), true);
    assert.equal(await canRead(rt.userDb('host'), 'settings'), false);
  });

  test('recoverSeat client checks: input, missing room, member of another seat, empty seat', async () => {
    await seedRoom(['bob']);
    const api = roomsApi('carol');
    const ok = { uid: 'carol', code: CODE, seatId: 's02', pin: BOB_PIN };
    await rejectsWithCode(api.recoverSeat({ ...ok, uid: '' }), ROOM_ERR.INVALID_UID);
    await rejectsWithCode(api.recoverSeat({ ...ok, code: 'ABC23' }), ROOM_ERR.INVALID_CODE);
    for (const seatId of ['s00', 's16', 'x01', 2, null]) {
      await rejectsWithCode(api.recoverSeat({ ...ok, seatId }), ROOM_ERR.INVALID_SEAT);
    }
    for (const pin of BAD_PINS) await rejectsWithCode(api.recoverSeat({ ...ok, pin }), ROOM_ERR.INVALID_PIN);
    await rejectsWithCode(api.recoverSeat({ ...ok, code: 'ZZZ999' }), ROOM_ERR.ROOM_NOT_FOUND);
    await rejectsWithCode(api.recoverSeat({ ...ok, seatId: 's05' }), ROOM_ERR.SEAT_EMPTY);
    await rejectsWithCode(
      roomsApi('bob').recoverSeat({ uid: 'bob', code: CODE, seatId: 's01', pin: HOST_PIN }),
      ROOM_ERR.ALREADY_MEMBER,
    );
    const before = await dumpRoom();
    assert.deepEqual(await roomsApi('bob').recoverSeat({ uid: 'bob', code: CODE, seatId: 's02', pin: '0000' }), { seatId: 's02' });
    assert.deepEqual(await dumpRoom(), before);
    assert.equal(before.claims, undefined, 'none of the refused calls wrote a claim');
  });
});
