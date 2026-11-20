// rooms/$code/secrets/$seatId = "1234": the seat's 4-digit PIN. There is no .read anywhere on
// this branch (or above it): nobody can read a secret, not even the seat's owner.

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  PIN_PATTERN,
  ROOM_FROM_DEPTH_2,
  SIGNED_IN,
  all,
  anyOf,
  deletedWithOwnSeat,
  isSeatId,
} from './helpers.js';

// Written only together with the creation of its seat by the same user; never changed.
const CREATE_WITH_SEAT = all(
  '!data.exists()',
  `!${ROOM_FROM_DEPTH_2}.child('seats').child($seatId).exists()`,
  `${NEW_ROOM_FROM_DEPTH_2}.child('seats').child($seatId).child('uid').val() === auth.uid`,
);

export function secretsRules() {
  return {
    $seatId: {
      '.write': all(
        SIGNED_IN,
        CODE_OK,
        isSeatId('$seatId'),
        anyOf(CREATE_WITH_SEAT, deletedWithOwnSeat('$seatId', `${NEW_ROOM_FROM_DEPTH_2}.child('seats')`)),
      ),
      '.validate': `newData.isString() && newData.val().matches(${PIN_PATTERN})`,
    },
  };
}
