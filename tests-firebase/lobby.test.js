// watchLobby on the local emulator: the live combined view of the waiting room, and how it ends
// when the device has or loses no seat.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/engine/index.js';
import { ROOM_ERR, toDbValue } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, PIN, roomFixtures, seedPin, wait, waitFor } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, seedRoom, seedPresence } = roomFixtures(rt);

// Starts watchLobby for `uid` and collects what it delivers.
function watch(uid) {
  const { api } = liveRoomsApi(uid);
  const updates = [];
  const errors = [];
  const stop = api.watchLobby({ uid, code: CODE, onUpdate: (lobby) => updates.push(lobby), onError: (error) => errors.push(error) });
  return { api, updates, errors, stop, last: () => updates.at(-1) };
}

describe('watchLobby', () => {
  test('a member gets one combined snapshot, then every change', async () => {
    await seedRoom(['bob']);
    const host = watch('host');
    await waitFor(() => host.updates.length > 0, { what: 'first snapshot' });
    const first = host.updates[0];
    assert.equal(first.initial, true);
    assert.equal(first.meta.hostSeat, 's01');
    assert.equal(first.meta.status, 'lobby');
    assert.deepEqual(first.settings, toDbValue(defaultConfig('classic')));
    assert.deepEqual(Object.keys(first.seats).sort(), ['s01', 's02']);
    assert.equal(first.seats.s02.name, 'bob');
    assert.deepEqual(first.presence, {});
    assert.deepEqual(first.scores, { s01: 0, s02: 0 });

    await roomsApi('carol').joinRoom({ uid: 'carol', code: CODE, name: 'Carol', pin: PIN });
    await waitFor(() => host.last().seats.s03?.name === 'Carol', { what: 'the new seat' });
    assert.equal(host.last().initial, false);
    assert.equal(host.last().scores.s03, 0);

    await roomsApi('host').updateSettings({ uid: 'host', code: CODE, settings: { ...defaultConfig('classic'), hp: 9 } });
    await waitFor(() => host.last().settings.hp === 9, { what: 'the settings change' });

    await seedPresence({ s02: { conns: { c1: true } } });
    await waitFor(() => host.last().presence.s02?.conns?.c1 === true, { what: 'presence' });

    host.stop();
    const count = host.updates.length;
    await roomsApi('host').updateSettings({ uid: 'host', code: CODE, settings: { ...defaultConfig('classic'), hp: 3 } });
    await wait(300);
    assert.equal(host.updates.length, count);
    assert.deepEqual(host.errors, []);
  });

  test('a non-member gets NOT_MEMBER and nothing else', async () => {
    await seedRoom(['bob']);
    const zed = watch('zed');
    await waitFor(() => zed.errors.length > 0, { what: 'the error' });
    await wait(200);
    assert.equal(zed.errors.length, 1);
    assert.equal(zed.errors[0].code, ROOM_ERR.NOT_MEMBER);
    assert.equal(zed.updates.length, 0);
  });

  test('a kicked player gets SEAT_LOST once', async () => {
    await seedRoom(['bob', 'carol']);
    const carol = watch('carol');
    await waitFor(() => carol.updates.length > 0, { what: 'first snapshot' });
    await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's03' });
    await waitFor(() => carol.errors.length > 0, { what: 'SEAT_LOST' });
    await wait(200);
    assert.deepEqual(carol.errors.map((e) => e.code), [ROOM_ERR.SEAT_LOST]);
  });

  test('a seat recovered on another device: the old device gets SEAT_LOST, the new one watches', async () => {
    await seedRoom(['bob']);
    const bob = watch('bob');
    await waitFor(() => bob.updates.length > 0, { what: 'first snapshot' });
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: seedPin(1) });
    await waitFor(() => bob.errors.length > 0, { what: 'SEAT_LOST' });
    assert.equal(bob.errors[0].code, ROOM_ERR.SEAT_LOST);
    const bob2 = watch('bob2');
    await waitFor(() => bob2.updates.length > 0, { what: 'the new device' });
    assert.equal(bob2.last().seats.s02.uid, 'bob2');
    bob2.stop();
  });

  test('the host hands over: the snapshot shows the new host seat', async () => {
    await seedRoom(['bob']);
    const bob = watch('bob');
    await waitFor(() => bob.updates.length > 0, { what: 'first snapshot' });
    await liveRoomsApi('host').api.handOverHost({ uid: 'host', code: CODE, seatId: 's02' });
    await waitFor(() => bob.last().meta.hostSeat === 's02', { what: 'the new host' });
    bob.stop();
  });
});
