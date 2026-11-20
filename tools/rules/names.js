// rooms/$code/names/$key = seatId: the unique-name index, key = the seat's name in lower case.
// Readable by any signed-in user who knows the room code (like the seat names), so a joining
// player gets a clear "name taken" before writing.
//
// Invariants, for every write (together with the seats/$seatId/name validate rule):
// - an entry exists only if the seat it points to exists and its name, lowercased, is the key
//   (validate below);
// - an existing entry is never overwritten with another seat id: this is what makes names
//   unique, also for two simultaneous joins;
// - an entry may be deleted only when, after the same write, its seat no longer has a name with
//   this key (the seat was renamed or deleted, which the seats rules authorise).

import { CODE_OK, NEW_ROOM_FROM_DEPTH_2, SIGNED_IN, all, anyOf, either, isSeatId, nameKey } from './helpers.js';

// The name of `seat` after the write.
const seatNameAfter = (seat) => `${NEW_ROOM_FROM_DEPTH_2}.child('seats').child(${seat}).child('name')`;

// Create an entry, or write the same seat id again (never another one).
const SET = all('newData.exists()', either('!data.exists()', 'data.val() === newData.val()'));

// Delete an entry whose seat, after the write, no longer has this name.
const DELETE = all(
  '!newData.exists()',
  'data.exists()',
  'data.isString()',
  either(`!${seatNameAfter('data.val()')}.exists()`, `${nameKey(`${seatNameAfter('data.val()')}.val()`)} !== $key`),
);

export function namesRules() {
  return {
    '.read': all(SIGNED_IN, CODE_OK),
    $key: {
      '.write': all(SIGNED_IN, CODE_OK, anyOf(SET, DELETE)),
      '.validate': all(
        'newData.isString()',
        isSeatId('newData.val()'),
        `${seatNameAfter('newData.val()')}.isString()`,
        `${nameKey(`${seatNameAfter('newData.val()')}.val()`)} === $key`,
      ),
    },
  };
}
