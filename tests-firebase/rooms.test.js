// Room creation and joining: the client module (src/rooms/) and the security rules
// (database.rules.json), on the local emulator. PINs and recovery: recovery.test.js.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { defaultConfig } from '../src/engine/index.js';
import { ROOM_ERR, SEAT_IDS, isValidRoomCode, toDbValue } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { ARABIC_20, CODE, PIN, rejectsWithCode, roomFixtures } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, dumpRoom, creationUpdate, joinUpdate, write, seedRoom } = roomFixtures(rt);

describe('rooms module: createRoom', () => {
  for (const mode of ['classic', 'custom']) {
    test(`creating a ${mode} room: creator is s01 and host, settings are the engine defaults`, async () => {
      const result = await roomsApi('alice').createRoom({ pin: PIN, uid: 'alice', name: '  Alice ', visibility: 'public', mode });
      assert.equal(result.seatId, 's01');
      assert.ok(isValidRoomCode(result.code));

      const room = await dumpRoom(result.code);
      assert.deepEqual(Object.keys(room).sort(), ['members', 'meta', 'names', 'seats', 'secrets', 'settings']);
      assert.equal(room.meta.visibility, 'public');
      assert.equal(room.meta.mode, mode);
      assert.equal(room.meta.status, 'lobby');
      assert.equal(room.meta.hostSeat, 's01');
      assert.equal(typeof room.meta.createdAt, 'number');
      assert.deepEqual(Object.keys(room.meta).sort(), ['createdAt', 'hostSeat', 'mode', 'status', 'visibility']);
      assert.deepEqual(room.seats, { s01: { uid: 'alice', name: 'Alice', joinedAt: room.seats.s01.joinedAt } });
      assert.equal(typeof room.seats.s01.joinedAt, 'number');
      assert.deepEqual(room.members, { alice: 's01' });
      assert.deepEqual(room.secrets, { s01: PIN });
      assert.deepEqual(room.names, { alice: 's01' });
      assert.deepEqual(room.settings, toDbValue(defaultConfig(mode)));
    });
  }

  test('a code that is already taken is skipped and a new one is generated', async () => {
    await seedRoom();
    const codes = [CODE, 'XYZ789'];
    const api = roomsApi('alice', { generateCode: () => codes.shift() });
    const result = await api.createRoom({ pin: PIN, uid: 'alice', name: 'Alice', visibility: 'private', mode: 'classic' });
    assert.equal(result.code, 'XYZ789');
    assert.equal((await dumpRoom(CODE)).members.alice, undefined);
  });

  test('every generated code taken -> CODE_GENERATION_FAILED after the bounded attempts', async () => {
    await seedRoom();
    let calls = 0;
    const api = roomsApi('alice', { generateCode: () => (calls += 1, CODE), maxCodeAttempts: 3 });
    await rejectsWithCode(
      api.createRoom({ pin: PIN, uid: 'alice', name: 'Alice', visibility: 'private', mode: 'classic' }),
      ROOM_ERR.CODE_GENERATION_FAILED,
    );
    assert.equal(calls, 3);
  });

  test('createRoom validates its input before writing', async () => {
    const api = roomsApi('alice');
    const ok = { uid: 'alice', name: 'Alice', pin: PIN, visibility: 'private', mode: 'classic' };
    await rejectsWithCode(api.createRoom({ ...ok, name: '   ' }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.createRoom({ ...ok, name: 'x'.repeat(21) }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.createRoom({ ...ok, name: 'two\nlines' }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.createRoom({ ...ok, visibility: 'secret' }), ROOM_ERR.INVALID_VISIBILITY);
    await rejectsWithCode(api.createRoom({ ...ok, mode: 'hardcore' }), ROOM_ERR.INVALID_MODE);
    await rejectsWithCode(api.createRoom({ ...ok, uid: 'a/b' }), ROOM_ERR.INVALID_UID);
    await rejectsWithCode(api.createRoom({ ...ok, uid: '' }), ROOM_ERR.INVALID_UID);
  });

  test('a uid that is not the signed-in user is refused by the rules (WRITE_DENIED)', async () => {
    const api = roomsApi('alice');
    await rejectsWithCode(
      api.createRoom({ pin: PIN, uid: 'mallory', name: 'M', visibility: 'private', mode: 'classic' }),
      ROOM_ERR.WRITE_DENIED,
    );
  });

  test('createRoom accepts a 20-character Arabic name', async () => {
    const { code } = await roomsApi('alice').createRoom({ pin: PIN, uid: 'alice', name: ARABIC_20, visibility: 'private', mode: 'custom' });
    assert.equal((await dumpRoom(code)).seats.s01.name, ARABIC_20);
  });
});

describe('rooms module: joinRoom', () => {
  async function createAs(uid = 'host') {
    const { code } = await roomsApi(uid).createRoom({ uid, pin: PIN, name: 'Host', visibility: 'private', mode: 'classic' });
    return code;
  }

  test('15 different players fill s01..s15 with distinct seats; the 16th gets ROOM_FULL', async () => {
    const code = await createAs('host');
    const seats = ['s01'];
    for (let i = 2; i <= 15; i += 1) {
      const uid = `user${i}`;
      const { seatId } = await roomsApi(uid).joinRoom({ uid, pin: PIN, code, name: `Player ${i}` });
      seats.push(seatId);
    }
    assert.deepEqual(seats, SEAT_IDS);
    await rejectsWithCode(roomsApi('late').joinRoom({ pin: PIN, uid: 'late', code, name: 'Late' }), ROOM_ERR.ROOM_FULL);

    const room = await dumpRoom(code);
    assert.equal(Object.keys(room.seats).length, 15);
    assert.equal(Object.keys(room.members).length, 15);
    assert.equal(room.members.late, undefined);
    for (const [uid, seatId] of Object.entries(room.members)) assert.equal(room.seats[seatId].uid, uid);
  });

  test('14 players joining at the same time get distinct seats and nobody is overwritten', async () => {
    const code = await createAs('host');
    const uids = Array.from({ length: 14 }, (_, i) => `racer${i}`);
    const results = await Promise.all(
      uids.map((uid) => roomsApi(uid).joinRoom({ uid, pin: PIN, code, name: uid })),
    );
    const seats = results.map((r) => r.seatId);
    assert.equal(new Set(seats).size, 14);
    assert.deepEqual([...seats].sort(), SEAT_IDS.slice(1));

    const room = await dumpRoom(code);
    assert.equal(room.seats.s01.uid, 'host');
    for (const [i, uid] of uids.entries()) {
      assert.equal(room.members[uid], seats[i]);
      assert.equal(room.seats[seats[i]].uid, uid);
    }
  });

  test('15 players racing for the last 14 seats: 14 distinct seats, exactly one ROOM_FULL', async () => {
    const code = await createAs('host');
    const uids = Array.from({ length: 15 }, (_, i) => `racer${i}`);
    const results = await Promise.allSettled(
      uids.map((uid) => roomsApi(uid).joinRoom({ uid, pin: PIN, code, name: uid })),
    );
    const seated = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.seatId);
    const refused = results.filter((r) => r.status === 'rejected');
    assert.equal(seated.length, 14);
    assert.equal(new Set(seated).size, 14);
    assert.equal(refused.length, 1);
    assert.equal(refused[0].reason.code, ROOM_ERR.ROOM_FULL);

    const room = await dumpRoom(code);
    assert.equal(Object.keys(room.members).length, 15);
    for (const [uid, seatId] of Object.entries(room.members)) assert.equal(room.seats[seatId].uid, uid);
  });

  test('re-joining with the same uid returns the same seat and writes nothing', async () => {
    const code = await createAs('host');
    const first = await roomsApi('bob').joinRoom({ pin: PIN, uid: 'bob', code, name: 'Bob' });
    const before = await dumpRoom(code);
    const again = await roomsApi('bob').joinRoom({ pin: PIN, uid: 'bob', code, name: 'Another name' });
    const host = await roomsApi('host').joinRoom({ pin: PIN, uid: 'host', code, name: 'Host' });
    assert.equal(again.seatId, first.seatId);
    assert.equal(host.seatId, 's01');
    assert.deepEqual(await dumpRoom(code), before);
  });

  test('joining a room that does not exist -> ROOM_NOT_FOUND', async () => {
    await rejectsWithCode(roomsApi('bob').joinRoom({ pin: PIN, uid: 'bob', code: 'ZZZ999', name: 'Bob' }), ROOM_ERR.ROOM_NOT_FOUND);
    assert.equal(await dumpRoom('ZZZ999'), null);
  });

  test('a typed code is trimmed and upper-cased; a malformed code -> INVALID_CODE', async () => {
    const code = await createAs('host');
    const { seatId } = await roomsApi('bob').joinRoom({ pin: PIN, uid: 'bob', code: ` ${code.toLowerCase()} `, name: 'Bob' });
    assert.equal(seatId, 's02');
    for (const bad of ['ABC23', 'ABC2345', 'ABC230', 'ABCO23', 'ABC123', 'ABCI23', 'ABCL23', 'AB-234', 42, null]) {
      await rejectsWithCode(roomsApi('carol').joinRoom({ pin: PIN, uid: 'carol', code: bad, name: 'Carol' }), ROOM_ERR.INVALID_CODE);
    }
  });

  test('joinRoom validates name and uid on the client too', async () => {
    const code = await createAs('host');
    const api = roomsApi('bob');
    await rejectsWithCode(api.joinRoom({ pin: PIN, uid: 'bob', code, name: '' }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.joinRoom({ pin: PIN, uid: 'bob', code, name: 'y'.repeat(21) }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.joinRoom({ pin: PIN, uid: 'bob', code, name: 42 }), ROOM_ERR.INVALID_NAME);
    await rejectsWithCode(api.joinRoom({ pin: PIN, uid: 'b.b', code, name: 'Bob' }), ROOM_ERR.INVALID_UID);
    const { seatId } = await api.joinRoom({ pin: PIN, uid: 'bob', code, name: 'y'.repeat(20) });
    assert.equal(seatId, 's02');
  });
});

describe('rules: creating a room', () => {
  test('a well-formed creation update is allowed (baseline for the denials below)', async () => {
    await assertSucceeds(write(rt.userDb('alice'), creationUpdate('alice')));
    await assertSucceeds(write(rt.userDb('bob'), creationUpdate('bob', { code: 'XYZ789', mode: 'custom' })));
  });

  test('unauthenticated users can create nothing and read nothing', async () => {
    await assertFails(write(rt.guestDb(), creationUpdate('alice')));
    await seedRoom(['bob']);
    for (const path of ['meta', 'settings', 'seats', 'seats/s01', 'members', 'members/bob']) {
      await assertFails(rt.guestDb().ref(`rooms/${CODE}/${path}`).get());
    }
    await assertFails(write(rt.guestDb(), joinUpdate('guest', 's03')));
    await assertFails(rt.guestDb().ref('rooms').get());
  });

  test('bad room code formats are refused', async () => {
    for (const code of ['ABC23', 'ABC2345', 'abc234', 'ABC230', 'ABCO23', 'ABC123', 'ABCI23', 'ABCL23', 'AB_234']) {
      await assertFails(write(rt.userDb('alice'), creationUpdate('alice', { code })));
    }
  });

  test('every part must be in the same update: meta, settings, seat s01 and members', async () => {
    const full = creationUpdate('alice');
    for (const missing of Object.keys(full)) {
      const partial = { ...full };
      delete partial[missing];
      await assertFails(write(rt.userDb('alice'), partial));
    }
  });

  test('the creator must take s01 and hostSeat must be s01', async () => {
    await assertFails(write(rt.userDb('alice'), creationUpdate('alice', { seatId: 's02' })));
    await assertFails(write(rt.userDb('alice'), creationUpdate('alice', { meta: { hostSeat: 's02' } })));
    const otherHost = creationUpdate('alice');
    otherHost[`rooms/${CODE}/seats/s01`].uid = 'bob';
    await assertFails(write(rt.userDb('alice'), otherHost));
  });

  test('meta values are checked: visibility, mode, status, server createdAt, no extra fields', async () => {
    const bad = [
      { visibility: 'secret' },
      { mode: 'hardcore' },
      { status: 'playing' },
      { createdAt: 1700000000000 },
      { extra: true },
    ];
    for (const meta of bad) await assertFails(write(rt.userDb('alice'), creationUpdate('alice', { meta })));
    const noCreatedAt = creationUpdate('alice');
    delete noCreatedAt[`rooms/${CODE}/meta`].createdAt;
    await assertFails(write(rt.userDb('alice'), noCreatedAt));
  });

  test('settings are checked: mode matches meta, custom block only in custom mode, no extra fields', async () => {
    const tweak = (mode, fn) => {
      const values = creationUpdate('alice', { mode });
      fn(values[`rooms/${CODE}/settings`]);
      return values;
    };
    const cases = [
      tweak('classic', (s) => { s.mode = 'custom'; }),
      tweak('classic', (s) => { s.custom = toDbValue(defaultConfig('custom')).custom; }),
      tweak('custom', (s) => { delete s.custom; }),
      tweak('classic', (s) => { s.extra = 1; }),
      tweak('classic', (s) => { s.hp = 'five'; }),
      tweak('classic', (s) => { s.enabledTools = ['detector', 'laser']; }),
      tweak('custom', (s) => { s.custom.extra = 1; }),
      tweak('custom', (s) => { s.custom.prices.laser = 1; }),
      tweak('custom', (s) => { s.custom.stock.probe = { aliveDivisor: 2, extra: 1 }; }),
    ];
    for (const values of cases) await assertFails(write(rt.userDb('alice'), values));
  });

  test('no extra children of the room, and no write of the whole room node', async () => {
    const extra = { ...creationUpdate('alice'), [`rooms/${CODE}/presence`]: { x: 1 } };
    await assertFails(write(rt.userDb('alice'), extra));
    const parts = creationUpdate('alice');
    const whole = {
      meta: parts[`rooms/${CODE}/meta`],
      settings: parts[`rooms/${CODE}/settings`],
      seats: { s01: parts[`rooms/${CODE}/seats/s01`] },
      members: { alice: 's01' },
    };
    await assertFails(rt.userDb('alice').ref(`rooms/${CODE}`).set(whole));
    await assertFails(rt.userDb('alice').ref(`rooms/${CODE}`).update(whole));
  });

  test('an existing room cannot be created again, and meta or settings cannot change afterwards', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('carol'), creationUpdate('carol')));
    await assertFails(write(rt.userDb('host'), creationUpdate('host')));
    const host = rt.userDb('host');
    await assertFails(host.ref(`rooms/${CODE}/meta/visibility`).set('public'));
    await assertFails(host.ref(`rooms/${CODE}/meta`).update({ status: 'lobby' }));
    await assertFails(host.ref(`rooms/${CODE}/meta`).remove());
    await assertFails(host.ref(`rooms/${CODE}/settings/hp`).set(3));
    await assertFails(host.ref(`rooms/${CODE}/settings`).set(toDbValue(defaultConfig('classic'))));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/meta/hostSeat`).set('s02'));
  });
});

describe('rules: taking a seat', () => {
  test('a well-formed join update is allowed (baseline for the denials below)', async () => {
    await seedRoom();
    await assertSucceeds(write(rt.userDb('bob'), joinUpdate('bob', 's02')));
    await assertSucceeds(write(rt.userDb('carol'), joinUpdate('carol', 's15')));
  });

  test('a seat cannot be taken in a room that does not exist', async () => {
    await assertFails(write(rt.userDb('bob'), joinUpdate('bob', 's02', { code: 'ZZZ999' })));
  });

  test("writing someone else's seat is denied", async () => {
    await seedRoom();
    await assertFails(write(rt.userDb('bob'), joinUpdate('carol', 's02')));
    await assertFails(write(rt.userDb('bob'), joinUpdate('bob', 's02', { seat: { uid: 'carol' } })));
  });

  test('an occupied seat cannot be overwritten or removed', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('carol'), joinUpdate('carol', 's01')));
    await assertFails(write(rt.userDb('carol'), joinUpdate('carol', 's02')));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/seats/s02/name`).set('Renamed'));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/seats/s02`).remove());
    assert.equal((await dumpRoom()).seats.s02.uid, 'bob');
  });

  test('seat ids outside s01..s15 are refused', async () => {
    await seedRoom();
    for (const seatId of ['s00', 's16', 'x01', 's1', 's015', 'S02', 's99']) {
      await assertFails(write(rt.userDb('bob'), joinUpdate('bob', seatId)));
    }
  });

  test('seat fields: no extra field, server joinedAt only, name 1-20 characters without edge spaces', async () => {
    await seedRoom();
    const bad = [
      { extra: 1 },
      { joinedAt: 1700000000000 },
      { name: '' },
      { name: 'z'.repeat(21) },
      { name: `${ARABIC_20}x` },
      { name: ' padded' },
      { name: 'padded ' },
      { name: 7 },
    ];
    for (const seat of bad) await assertFails(write(rt.userDb('bob'), joinUpdate('bob', 's02', { seat })));
    const noName = joinUpdate('bob', 's02');
    delete noName[`rooms/${CODE}/seats/s02`].name;
    await assertFails(write(rt.userDb('bob'), noName));
    await assertSucceeds(write(rt.userDb('bob'), joinUpdate('bob', 's02', { seat: { name: ARABIC_20 } })));
  });

  test('seat and members entry must be written together and must agree', async () => {
    await seedRoom();
    const seatOnly = joinUpdate('bob', 's02');
    delete seatOnly[`rooms/${CODE}/members/bob`];
    await assertFails(write(rt.userDb('bob'), seatOnly));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/members/bob`).set('s02'));
    await assertFails(write(rt.userDb('bob'), joinUpdate('bob', 's02', { memberSeat: 's03' })));
  });

  test('a members entry pointing to a seat that is not being assigned to you is denied', async () => {
    await seedRoom(['bob']);
    // s02 is bob's; carol claims it as her seat while taking nothing herself.
    await assertFails(rt.userDb('carol').ref(`rooms/${CODE}/members/carol`).set('s02'));
    // carol takes s03 but writes her members entry as s01 (the host's seat).
    await assertFails(write(rt.userDb('carol'), joinUpdate('carol', 's03', { memberSeat: 's01' })));
    // Writing another user's members entry, even alongside your own seat.
    await assertFails(write(rt.userDb('carol'), { ...joinUpdate('carol', 's03'), [`rooms/${CODE}/members/dave`]: 's03' }));
  });

  test('a member cannot take a second seat or change their members entry', async () => {
    await seedRoom(['bob']);
    await assertFails(write(rt.userDb('bob'), joinUpdate('bob', 's03')));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/members/bob`).set('s03'));
    await assertFails(rt.userDb('bob').ref(`rooms/${CODE}/members/bob`).remove());
    assert.deepEqual((await dumpRoom()).members, { host: 's01', bob: 's02' });
  });
});

describe('rules: reading a room', () => {
  test('a member reads meta, settings, seats and all members entries', async () => {
    await seedRoom(['bob']);
    const bob = rt.userDb('bob');
    for (const path of ['meta', 'settings', 'seats', 'seats/s01', 'members', 'members/host']) {
      await assertSucceeds(bob.ref(`rooms/${CODE}/${path}`).get());
    }
  });

  test('a signed-in non-member reads meta and their own (empty) members entry', async () => {
    await seedRoom(['bob']);
    const carol = rt.userDb('carol');
    const meta = await assertSucceeds(carol.ref(`rooms/${CODE}/meta`).get());
    assert.equal(meta.val().hostSeat, 's01');
    const own = await assertSucceeds(carol.ref(`rooms/${CODE}/members/carol`).get());
    assert.equal(own.val(), null);
    await assertSucceeds(carol.ref('rooms/ZZZ999/meta').get());
  });

  test('a non-member cannot read settings, seats (other than names) or other members entries', async () => {
    await seedRoom(['bob']);
    const carol = rt.userDb('carol');
    const paths = ['settings', 'seats', 'seats/s01', 'seats/s01/uid', 'seats/s01/joinedAt', 'members', 'members/bob'];
    for (const path of paths) {
      await assertFails(carol.ref(`rooms/${CODE}/${path}`).get());
    }
  });

  test('nobody reads the room node, the rooms list or the root', async () => {
    await seedRoom(['bob']);
    for (const path of [`rooms/${CODE}`, 'rooms', '/']) {
      await assertFails(rt.userDb('bob').ref(path).get());
      await assertFails(rt.userDb('host').ref(path).get());
    }
  });
});
