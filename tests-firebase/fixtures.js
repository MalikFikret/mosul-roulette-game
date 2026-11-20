// Room fixtures shared by the emulator tests: raw client updates (as a client could send them,
// bypassing src/rooms/), seeding, and a room API bound to a signed-in test user.

import assert from 'node:assert/strict';
import { get, ref, serverTimestamp, update } from 'firebase/database';
import { defaultConfig } from '../src/engine/index.js';
import { SEAT_IDS, createRoomApi, toDbValue } from '../src/rooms/index.js';

// Server timestamp placeholder, as the SDK sends it.
export const NOW = { '.sv': 'timestamp' };
export const CODE = 'ABC234';
export const PIN = '4821';
export const ARABIC_20 = 'محمد'.repeat(5);

// Seat PINs used by seedRoom: the host's, then one per joiner (s02, s03, ...).
export const HOST_PIN = '1357';
export const seedPin = (seatIndex) => String(2000 + seatIndex);

export async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {ReturnType<import('./helpers.js').useRulesTestEnv>} rt */
export function roomFixtures(rt) {
  function roomsApi(uid, extra = {}) {
    return createRoomApi({ db: rt.modularDb(uid), ref, get, update, serverTimestamp, ...extra });
  }

  // Everything stored under rooms/{code}, read with rules disabled.
  async function dumpRoom(code = CODE) {
    return rt.withRulesDisabled(async (db) => (await db.ref(`rooms/${code}`).get()).val());
  }

  // The multi-path update that creates a room.
  function creationUpdate(uid, { code = CODE, mode = 'classic', meta = {}, seat = {}, seatId = 's01', pin = HOST_PIN } = {}) {
    return {
      [`rooms/${code}/meta`]: {
        visibility: 'private',
        mode,
        status: 'lobby',
        hostSeat: 's01',
        createdAt: NOW,
        ...meta,
      },
      [`rooms/${code}/settings`]: toDbValue(defaultConfig(mode)),
      [`rooms/${code}/seats/${seatId}`]: { uid, name: 'Host', joinedAt: NOW, ...seat },
      [`rooms/${code}/members/${uid}`]: seatId,
      [`rooms/${code}/secrets/${seatId}`]: pin,
    };
  }

  // The multi-path update that takes a seat.
  function joinUpdate(uid, seatId, { code = CODE, seat = {}, memberSeat = seatId, pin = PIN, name = 'Player' } = {}) {
    return {
      [`rooms/${code}/seats/${seatId}`]: { uid, name, joinedAt: NOW, ...seat },
      [`rooms/${code}/members/${uid}`]: memberSeat,
      [`rooms/${code}/secrets/${seatId}`]: pin,
    };
  }

  // Recovery write 1: the claim.
  function claimUpdate(uid, seatId, pin, { code = CODE, claim = {} } = {}) {
    return { [`rooms/${code}/claims/${seatId}`]: { uid, pin, at: NOW, ...claim } };
  }

  // Recovery write 2: the transfer.
  function transferUpdate(uid, seatId, { code = CODE, memberSeat = seatId, seatUid = uid } = {}) {
    return {
      [`rooms/${code}/seats/${seatId}/uid`]: seatUid,
      [`rooms/${code}/members/${uid}`]: memberSeat,
    };
  }

  function write(db, values) {
    return db.ref().update(values);
  }

  // Creates room CODE with "host" in s01 (PIN HOST_PIN) and the given uids in s02, s03, ...
  // (PIN seedPin(index), named after the uid), through the rules.
  async function seedRoom(joiners = []) {
    await write(rt.userDb('host'), creationUpdate('host'));
    for (const [i, uid] of joiners.entries()) {
      await write(rt.userDb(uid), joinUpdate(uid, SEAT_IDS[i + 1], { pin: seedPin(i + 1), name: uid }));
    }
  }

  return { roomsApi, dumpRoom, creationUpdate, joinUpdate, claimUpdate, transferUpdate, write, seedRoom };
}
