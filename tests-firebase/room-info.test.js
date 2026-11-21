// Small reads for the game UI, on the local emulator: getRoomSummary (what a visitor sees before
// sitting down) and getMySeat (whether a reloaded page still holds a seat).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_ERR } from '../src/rooms/index.js';
import { useRulesTestEnv } from './helpers.js';
import { CODE, PIN, rejectsWithCode, roomFixtures, seedPin, wait } from './fixtures.js';

const rt = useRulesTestEnv();
const { roomsApi, liveRoomsApi, seedRoom } = roomFixtures(rt);

const live = (uid) => liveRoomsApi(uid, { randomSeed: () => 12345 }).api;

describe('getRoomSummary', () => {
  test('a non-member sees mode, status, host seat and the seated names only', async () => {
    await seedRoom(['bob', 'carol']);
    const summary = await roomsApi('visitor').getRoomSummary({ uid: 'visitor', code: CODE.toLowerCase() });
    assert.deepEqual(summary, {
      code: CODE,
      mode: 'classic',
      status: 'lobby',
      hostSeat: 's01',
      seats: [
        { seatId: 's01', name: 'Host' },
        { seatId: 's02', name: 'bob' },
        { seatId: 's03', name: 'carol' },
      ],
    });
  });

  test('reports a running match', async () => {
    await seedRoom(['bob', 'carol']);
    await live('host').startMatch({ uid: 'host', code: CODE });
    const summary = await roomsApi('visitor').getRoomSummary({ uid: 'visitor', code: CODE });
    assert.equal(summary.status, 'playing');
  });

  test('refuses a bad code before any read and reports a missing room', async () => {
    await rejectsWithCode(roomsApi('visitor').getRoomSummary({ uid: 'visitor', code: 'ABC' }), ROOM_ERR.INVALID_CODE);
    await rejectsWithCode(roomsApi('visitor').getRoomSummary({ uid: 'visitor', code: CODE }), ROOM_ERR.ROOM_NOT_FOUND);
  });
});

describe('getMySeat', () => {
  test('a member gets their seat, name and waiting flag', async () => {
    await seedRoom(['bob']);
    assert.deepEqual(await roomsApi('bob').getMySeat({ uid: 'bob', code: CODE }), {
      seatId: 's02',
      name: 'bob',
      waiting: false,
      status: 'lobby',
      hostSeat: 's01',
    });
    assert.equal((await roomsApi('host').getMySeat({ uid: 'host', code: CODE })).seatId, 's01');
  });

  test('a seat taken during a match is reported as waiting', async () => {
    await seedRoom(['bob', 'carol']);
    await live('host').startMatch({ uid: 'host', code: CODE });
    await roomsApi('eve').joinRoom({ uid: 'eve', code: CODE, name: 'Eve', pin: PIN });
    const mine = await roomsApi('eve').getMySeat({ uid: 'eve', code: CODE });
    assert.equal(mine.seatId, 's04');
    assert.equal(mine.waiting, true);
    assert.equal(mine.status, 'playing');
  });

  test('null for a non-member, a missing room, a kicked seat and a recovered seat', async () => {
    assert.equal(await roomsApi('bob').getMySeat({ uid: 'bob', code: CODE }), null);
    await seedRoom(['bob', 'carol']);
    assert.equal(await roomsApi('zed').getMySeat({ uid: 'zed', code: CODE }), null);

    await roomsApi('host').kickSeat({ uid: 'host', code: CODE, seatId: 's03' });
    assert.equal(await roomsApi('carol').getMySeat({ uid: 'carol', code: CODE }), null);

    // bob's seat recovered on another device: bob's members entry is now stale.
    await roomsApi('bob2').recoverSeat({ uid: 'bob2', code: CODE, seatId: 's02', pin: seedPin(1) });
    assert.equal(await roomsApi('bob').getMySeat({ uid: 'bob', code: CODE }), null);
    assert.equal((await roomsApi('bob2').getMySeat({ uid: 'bob2', code: CODE })).seatId, 's02');
  });

  test('null after the room was deleted by its last player', async () => {
    const { code } = await roomsApi('solo').createRoom({ uid: 'solo', name: 'Solo', pin: PIN, visibility: 'private', mode: 'classic' });
    assert.equal((await roomsApi('solo').getMySeat({ uid: 'solo', code })).seatId, 's01');
    await roomsApi('solo').leaveRoom({ uid: 'solo', code });
    await wait(50);
    assert.equal(await roomsApi('solo').getMySeat({ uid: 'solo', code }), null);
  });

  test('refuses a bad code', async () => {
    await rejectsWithCode(roomsApi('bob').getMySeat({ uid: 'bob', code: '0OOOOO' }), ROOM_ERR.INVALID_CODE);
  });
});
