// Changing the match settings in the lobby, on the local emulator: updateSettings and the
// settings rule (only the CURRENT host, only between matches, keys and types checked).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { defaultConfig } from '../src/engine/index.js';
import { ROOM_ERR, toDbValue } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, HOST_PIN, rejectsWithCode, roomFixtures } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, dumpRoom, seedRoom } = roomFixtures(rt);

const live = (uid) => liveRoomsApi(uid, { randomSeed: () => 12345 }).api;
const SETTINGS = `rooms/${CODE}/settings`;
const classic = (patch = {}) => ({ ...defaultConfig('classic'), ...patch });
const stored = (patch = {}) => toDbValue(classic(patch));

describe('updateSettings (module)', () => {
  test('the host replaces the settings in the lobby; the stored value is the normalized config', async () => {
    await seedRoom(['bob']);
    const result = await roomsApi('host').updateSettings({
      uid: 'host',
      code: CODE.toLowerCase(),
      settings: classic({ hp: 7, toolsPerTurn: 1, shotTimeSeconds: 45, enabledTools: ['heal', 'detector'] }),
    });
    const expected = stored({ hp: 7, toolsPerTurn: 1, shotTimeSeconds: 45, enabledTools: ['detector', 'heal'] });
    assert.deepEqual(result.settings, expected);
    assert.deepEqual((await dumpRoom()).settings, expected);
  });

  test('values the engine refuses are refused before any write (INVALID_SETTINGS)', async () => {
    await seedRoom(['bob']);
    const before = await dumpRoom();
    for (const settings of [
      classic({ hp: 0 }),
      classic({ hp: 21 }),
      classic({ toolsPerReload: 11 }),
      classic({ shotTimeSeconds: 4 }),
      classic({ enabledTools: ['nope'] }),
      classic({ extra: 1 }),
      defaultConfig('custom'), // another mode than the room's
      'hp=3',
      null,
    ]) {
      await rejectsWithCode(roomsApi('host').updateSettings({ uid: 'host', code: CODE, settings }), ROOM_ERR.INVALID_SETTINGS);
    }
    assert.deepEqual(await dumpRoom(), before);
  });

  test('a non-host member, a non-member and an unknown room are refused', async () => {
    await seedRoom(['bob']);
    await rejectsWithCode(roomsApi('bob').updateSettings({ uid: 'bob', code: CODE, settings: classic({ hp: 3 }) }), ROOM_ERR.WRITE_DENIED);
    await rejectsWithCode(roomsApi('zed').updateSettings({ uid: 'zed', code: CODE, settings: classic({ hp: 3 }) }), ROOM_ERR.NOT_MEMBER);
    await rejectsWithCode(roomsApi('host').updateSettings({ uid: 'host', code: 'ZZZZZZ', settings: classic() }), ROOM_ERR.ROOM_NOT_FOUND);
    assert.equal((await dumpRoom()).settings.hp, 5);
  });

  test('after a host handover the new host can, the old host cannot', async () => {
    await seedRoom(['bob']);
    await live('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await rejectsWithCode(roomsApi('host').updateSettings({ uid: 'host', code: CODE, settings: classic({ hp: 2 }) }), ROOM_ERR.WRITE_DENIED);
    await roomsApi('bob').updateSettings({ uid: 'bob', code: CODE, settings: classic({ hp: 9 }) });
    assert.equal((await dumpRoom()).settings.hp, 9);
  });

  test('during a match: NOT_IN_LOBBY, nothing written', async () => {
    await seedRoom(['bob', 'carol']);
    await live('host').startMatch({ uid: 'host', code: CODE });
    await rejectsWithCode(roomsApi('host').updateSettings({ uid: 'host', code: CODE, settings: classic({ hp: 3 }) }), ROOM_ERR.NOT_IN_LOBBY);
    assert.equal((await dumpRoom()).settings.hp, 5);
  });
});

describe('rules: settings after creation', () => {
  test('the current host may replace the whole settings or change one field in the lobby', async () => {
    await seedRoom(['bob']);
    const host = rt.userDb('host');
    await assertSucceeds(host.ref(SETTINGS).set(stored({ hp: 8 })));
    await assertSucceeds(host.ref(`${SETTINGS}/toolsPerTurn`).set(2));
    await assertSucceeds(host.ref(SETTINGS).update({ shotTimeSeconds: 60, randomizeSeats: false }));
    const settings = (await dumpRoom()).settings;
    assert.equal(settings.hp, 8);
    assert.equal(settings.toolsPerTurn, 2);
    assert.equal(settings.shotTimeSeconds, 60);
    assert.equal(settings.randomizeSeats, false);
  });

  test('a non-host member and a non-member cannot', async () => {
    await seedRoom(['bob']);
    for (const uid of ['bob', 'zed']) {
      await assertFails(rt.userDb(uid).ref(SETTINGS).set(stored({ hp: 8 })));
      await assertFails(rt.userDb(uid).ref(`${SETTINGS}/hp`).set(8));
    }
  });

  test('the old host after a handover cannot; the new host can', async () => {
    await seedRoom(['bob']);
    await live('host').handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await assertFails(rt.userDb('host').ref(`${SETTINGS}/hp`).set(8));
    await assertSucceeds(rt.userDb('bob').ref(`${SETTINGS}/hp`).set(8));
  });

  test('a host whose seat was recovered on another device cannot (stale members entry)', async () => {
    await seedRoom(['bob']);
    await roomsApi('host2').recoverSeat({ uid: 'host2', code: CODE, seatId: 's01', pin: HOST_PIN });
    await assertFails(rt.userDb('host').ref(`${SETTINGS}/hp`).set(8));
    await assertSucceeds(rt.userDb('host2').ref(`${SETTINGS}/hp`).set(8));
  });

  test('nobody, the host included, can change the settings during a match', async () => {
    await seedRoom(['bob', 'carol']);
    await live('host').startMatch({ uid: 'host', code: CODE });
    await assertFails(rt.userDb('host').ref(SETTINGS).set(stored({ hp: 8 })));
    await assertFails(rt.userDb('host').ref(`${SETTINGS}/hp`).set(8));
    await assertFails(rt.userDb('bob').ref(`${SETTINGS}/hp`).set(8));
  });

  test('the host cannot change the settings in the same write that starts a match', async () => {
    await seedRoom(['bob', 'carol']);
    await assertFails(
      rt.userDb('host').ref().update({ [`rooms/${CODE}/meta/status`]: 'playing', [`${SETTINGS}/hp`]: 8 }),
    );
  });

  test('keys and types are still checked; the settings cannot be deleted; the mode stays', async () => {
    await seedRoom(['bob']);
    const host = rt.userDb('host');
    const bad = [
      stored({ hp: '5' }),
      stored({ toolsPerTurn: true }),
      stored({ randomizeSeats: 'yes' }),
      { ...stored(), extra: 1 },
      { ...stored(), mode: 'custom' },
      { ...stored(), custom: toDbValue(defaultConfig('custom').custom) },
      { ...stored(), enabledTools: ['detector', 'nope'] },
      { ...stored(), enabledTools: 'detector' },
      (() => {
        const value = stored();
        delete value.hp;
        return value;
      })(),
    ];
    for (const value of bad) await assertFails(host.ref(SETTINGS).set(value));
    await assertFails(host.ref(`${SETTINGS}/hp`).set('8'));
    await assertFails(host.ref(`${SETTINGS}/hp`).remove());
    await assertFails(host.ref(`${SETTINGS}/mode`).set('custom'));
    await assertFails(host.ref(`${SETTINGS}/other`).set(1));
    await assertFails(host.ref(SETTINGS).remove());
    assert.deepEqual((await dumpRoom()).settings, stored());
  });
});
