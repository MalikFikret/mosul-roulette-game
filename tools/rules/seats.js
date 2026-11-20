// rooms/$code/seats/$seatId: { uid, name, joinedAt }, seat ids s01..s15.
// The whole branch is readable by members; a seat's name alone by any signed-in user (a
// returning player picks their own name before entering the PIN).
//
// Names are unique per room (case-insensitive): a seat's name exists only if
// names/{lowercase(name)} === that seat id after the same write (validate on name), and the
// names entry goes away in the same write as the seat or its old name (rename, leave, kick).

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  NEW_ROOM_FROM_DEPTH_3,
  IN_LOBBY,
  IS_HOST,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  either,
  isMember,
  isNotMember,
  isSeatId,
  kicker,
  leaver,
  nameKey,
  noForbiddenKeyChars,
  sitsOn,
} from './helpers.js';

const newRoom = NEW_ROOM_FROM_DEPTH_2;

// Taking a seat: an empty seat, for yourself, in an existing room, by a non-member, with your
// members entry and the seat's secret (PIN) in the same write.
const CREATE_SEAT = all(
  '!data.exists()',
  "newData.child('uid').val() === auth.uid",
  `${newRoom}.child('meta').exists()`,
  // No new seat while a match runs (temporary, until waiting players come in task 3.5c).
  `${newRoom}.child('meta/status').val() === 'lobby'`,
  `${newRoom}.child('secrets').child($seatId).exists()`,
  `${newRoom}.child('members').child(auth.uid).val() === $seatId`,
  isNotMember(ROOM_BEFORE),
);

// A seat that goes (leaving or kicking) takes its secret, claim, presence entry, names entry and
// the members entry of `seatUid` with it in the same write (no orphans). Afterwards
// meta.hostSeat must point to another seat that still exists.
const newHostSeat = `${newRoom}.child('meta/hostSeat').val()`;
const seatGoesCleanly = (seatUid) => [
  `!${newRoom}.child('secrets').child($seatId).exists()`,
  `!${newRoom}.child('claims').child($seatId).exists()`,
  `!${newRoom}.child('presence').child($seatId).exists()`,
  `!${newRoom}.child('members').child(${seatUid}).exists()`,
  `!${newRoom}.child('names').child(${nameKey("data.child('name').val()")}).exists()`,
  `${newHostSeat} !== $seatId`,
  `${newRoom}.child('seats').child(${newHostSeat}).exists()`,
];

// Leaving (between matches): your own seat. An ordinary player leaves hostSeat alone, the host
// moves it in the same write (meta/hostSeat rule, path A).
const LEAVE_SEAT = all('data.exists()', '!newData.exists()', leaver('$seatId'), ...seatGoesCleanly('auth.uid'));

// Kicking (between matches): the host deletes another player's seat; the members entry of the
// seat's current uid goes too (stale entries of older devices are removed by the members rule).
const KICK_SEAT = all('data.exists()', '!newData.exists()', kicker('$seatId'), ...seatGoesCleanly("data.child('uid').val()"));

// Renaming (between matches): the host renames any seat, a player their own. The old names
// entry is deleted in the same write, unless only the case changes (same key).
const newRoomFromName = NEW_ROOM_FROM_DEPTH_3;
const RENAME = all(
  SIGNED_IN,
  CODE_OK,
  isSeatId('$seatId'),
  'data.exists()',
  'newData.isString()',
  IN_LOBBY,
  anyOf(IS_HOST, sitsOn(ROOM_BEFORE, '$seatId')),
  either(
    `${nameKey('data.val()')} === ${nameKey('newData.val()')}`,
    `!${newRoomFromName}.child('names').child(${nameKey('data.val()')}).exists()`,
  ),
);

// A name: 1-20 characters, no space at either end, none of the characters illegal in keys, and
// names/{lowercase(name)} points to this seat after the write.
const NAME_VALID = all(
  'newData.isString()',
  'newData.val().length >= 1',
  'newData.val().length <= 20',
  "!newData.val().beginsWith(' ')",
  "!newData.val().endsWith(' ')",
  noForbiddenKeyChars('newData.val()'),
  `${newRoomFromName}.child('names').child(${nameKey('newData.val()')}).val() === $seatId`,
);

// Seat recovery, write 2 (the transfer): only seats/$seatId/uid changes, to the writer, who is
// not a member; the claim stored earlier (write 1) is the writer's and its PIN equals the
// secret; the same write points the writer's members entry at this seat.
const room = ROOM_BEFORE;
const TRANSFER = all(
  SIGNED_IN,
  CODE_OK,
  isSeatId('$seatId'),
  'data.exists()',
  'newData.val() === auth.uid',
  isNotMember(room),
  `${room}.child('claims').child($seatId).child('uid').val() === auth.uid`,
  `${room}.child('secrets').child($seatId).exists()`,
  `${room}.child('claims').child($seatId).child('pin').val() === ${room}.child('secrets').child($seatId).val()`,
  `${NEW_ROOM_FROM_DEPTH_3}.child('members').child(auth.uid).val() === $seatId`,
);

export function seatsRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    $seatId: {
      '.write': all(SIGNED_IN, CODE_OK, isSeatId('$seatId'), anyOf(CREATE_SEAT, LEAVE_SEAT, KICK_SEAT)),
      '.validate': "newData.hasChildren(['uid', 'name', 'joinedAt'])",
      uid: {
        '.write': TRANSFER,
        '.validate': 'newData.val() === auth.uid',
      },
      name: {
        '.read': all(SIGNED_IN, CODE_OK),
        '.write': RENAME,
        '.validate': NAME_VALID,
      },
      joinedAt: { '.validate': 'newData.val() === now' },
      $other: REFUSE,
    },
  };
}
