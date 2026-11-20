// rooms/$code/meta: { visibility, mode, status, hostSeat, createdAt }.
// Readable by any signed-in user (to check that a room exists before joining). Written once, at
// creation; afterwards only meta/hostSeat changes (paths A and B below).

import {
  CODE_OK,
  IS_HOST,
  NEW_ROOM_FROM_DEPTH_2,
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

// meta/status 'lobby' -> 'playing': the host, in the same write that starts a new match (match/seq
// is 0 and match/n is new).
const START_MATCH = all(
  "data.val() === 'lobby'",
  "newData.val() === 'playing'",
  IS_HOST,
  `${NEW_ROOM_FROM_DEPTH_2}.child('match/seq').val() === 0`,
  either(`!${ROOM_BEFORE}.child('match').exists()`, `${NEW_ROOM_FROM_DEPTH_2}.child('match/n').val() !== ${ROOM_BEFORE}.child('match/n').val()`),
);

// meta/status 'playing' -> 'lobby': a member, only in the same write that creates the results of
// the current match (results/{match n} did not exist before and exists after).
const currentResult = `child('results').child(${ROOM_BEFORE}.child('match/n').val() + '')`;
const END_MATCH = all(
  "data.val() === 'playing'",
  "newData.val() === 'lobby'",
  isMember(ROOM_BEFORE),
  `!${ROOM_BEFORE}.${currentResult}.exists()`,
  `${NEW_ROOM_FROM_DEPTH_2}.${currentResult}.exists()`,
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
    status: {
      '.write': all(SIGNED_IN, CODE_OK, anyOf(START_MATCH, END_MATCH)),
      // A new room starts in the lobby.
      '.validate': anyOf("newData.val() === 'lobby'", all("newData.val() === 'playing'", `${ROOM_BEFORE}.exists()`)),
    },
    hostSeat: {
      '.write': HOST_SEAT_WRITE,
      // At creation the host is s01; afterwards any seat id.
      '.validate': all('newData.isString()', isSeatId('newData.val()'), either(`${ROOM_BEFORE}.exists()`, "newData.val() === 's01'")),
    },
    createdAt: { '.validate': 'newData.val() === now' },
    $other: REFUSE,
  };
}
