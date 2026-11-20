// rooms/$code/seats/$seatId: { uid, name, joinedAt }, seat ids s01..s15.
// The whole branch is readable by members; a seat's name alone by any signed-in user (a
// returning player picks their own name before entering the PIN).

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  NEW_ROOM_FROM_DEPTH_3,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  isMember,
  isNotMember,
  isSeatId,
  leaver,
} from './helpers.js';

const newRoom = NEW_ROOM_FROM_DEPTH_2;

// Taking a seat: an empty seat, for yourself, in an existing room, by a non-member, with your
// members entry and the seat's secret (PIN) in the same write.
const CREATE_SEAT = all(
  '!data.exists()',
  "newData.child('uid').val() === auth.uid",
  `${newRoom}.child('meta').exists()`,
  `${newRoom}.child('secrets').child($seatId).exists()`,
  `${newRoom}.child('members').child(auth.uid).val() === $seatId`,
  isNotMember(ROOM_BEFORE),
);

// Leaving (between matches): your own seat goes, and in the same write its secret, claim,
// presence entry and your members entry go too (no orphans). Afterwards meta.hostSeat must
// point to another seat that still exists: an ordinary player leaves hostSeat alone, the host
// moves it in the same write (meta/hostSeat rule, path A).
const newHostSeat = `${newRoom}.child('meta/hostSeat').val()`;
const LEAVE_SEAT = all(
  'data.exists()',
  '!newData.exists()',
  leaver('$seatId'),
  `!${newRoom}.child('secrets').child($seatId).exists()`,
  `!${newRoom}.child('claims').child($seatId).exists()`,
  `!${newRoom}.child('presence').child($seatId).exists()`,
  `!${newRoom}.child('members').child(auth.uid).exists()`,
  `${newHostSeat} !== $seatId`,
  `${newRoom}.child('seats').child(${newHostSeat}).exists()`,
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
      '.write': all(SIGNED_IN, CODE_OK, isSeatId('$seatId'), anyOf(CREATE_SEAT, LEAVE_SEAT)),
      '.validate': "newData.hasChildren(['uid', 'name', 'joinedAt'])",
      uid: {
        '.write': TRANSFER,
        '.validate': 'newData.val() === auth.uid',
      },
      name: {
        '.read': all(SIGNED_IN, CODE_OK),
        // 1-20 characters, no space at either end.
        '.validate':
          "newData.isString() && newData.val().length >= 1 && newData.val().length <= 20 && !newData.val().beginsWith(' ') && !newData.val().endsWith(' ')",
      },
      joinedAt: { '.validate': 'newData.val() === now' },
      $other: REFUSE,
    },
  };
}
