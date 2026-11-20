// rooms/$code/meta: { visibility, mode, status, hostSeat, createdAt }.
// Readable by any signed-in user (to check that a room exists before joining). Written once, at
// creation; afterwards only meta/hostSeat changes (paths A and B below).

import {
  CODE_OK,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  all,
  anyOf,
  either,
  isMember,
  isSeatId,
  sitsOn,
} from './helpers.js';

// Creation: the room does not exist yet, and the same update writes the settings, seat s01 for
// the creator and the creator's members entry.
const CREATE = all(
  SIGNED_IN,
  CODE_OK,
  `!${ROOM_BEFORE}.exists()`,
  "newData.parent().child('settings').exists()",
  "newData.parent().child('seats/s01/uid').val() === auth.uid",
  "newData.parent().child('members').child(auth.uid).val() === 's01'",
);

// Host absence, for path B. `data.val()` is the current host seat. Absent means no connection;
// absent-since is presence lastSeenAt, or the seat's joinedAt if it was never seen.
const hostPresence = `${ROOM_BEFORE}.child('presence').child(data.val())`;
const hostLastSeen = `${hostPresence}.child('lastSeenAt')`;
const hostJoinedAt = `${ROOM_BEFORE}.child('seats').child(data.val()).child('joinedAt')`;
const HOST_ABSENT_60S = all(
  `!${hostPresence}.child('conns').hasChildren()`,
  anyOf(
    all(`${hostLastSeen}.exists()`, `now > ${hostLastSeen}.val() + 60000`),
    all(`!${hostLastSeen}.exists()`, `now > ${hostJoinedAt}.val() + 60000`),
  ),
);
const NEW_HOST_PRESENT = `${ROOM_BEFORE}.child('presence').child(newData.val()).child('conns').hasChildren()`;

const HOST_SEAT_WRITE = all(
  SIGNED_IN,
  CODE_OK,
  'data.exists()',
  'newData.isString()',
  isSeatId('newData.val()'),
  'newData.val() !== data.val()',
  `${ROOM_BEFORE}.child('seats').child(newData.val()).exists()`,
  anyOf(
    // Path A: the current host hands the role to another occupied seat (also used by leaving).
    sitsOn(ROOM_BEFORE, 'data.val()'),
    // Path B: any member, to a present seat, after more than 60 s of host absence.
    all(isMember(ROOM_BEFORE), NEW_HOST_PRESENT, HOST_ABSENT_60S),
  ),
);

export function metaRules() {
  return {
    '.read': all(SIGNED_IN, CODE_OK),
    '.write': CREATE,
    '.validate': "newData.hasChildren(['visibility', 'mode', 'status', 'hostSeat', 'createdAt'])",
    visibility: { '.validate': "newData.val() === 'public' || newData.val() === 'private'" },
    mode: { '.validate': "newData.val() === 'classic' || newData.val() === 'custom'" },
    status: { '.validate': "newData.val() === 'lobby'" },
    hostSeat: {
      '.write': HOST_SEAT_WRITE,
      // At creation the host is s01; afterwards any seat id.
      '.validate': all('newData.isString()', isSeatId('newData.val()'), either(`${ROOM_BEFORE}.exists()`, "newData.val() === 's01'")),
    },
    createdAt: { '.validate': 'newData.val() === now' },
    $other: REFUSE,
  };
}
