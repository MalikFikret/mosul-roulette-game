// rooms/$code/results/$n = { scoreJson, joinedAt: { [seatId]: number } }: the result of match n,
// written once when it ends, together with meta/status going back to 'lobby'. Readable by members.
//
// The rules cannot run the engine, so they cannot check that the match really ended or that the
// score is right (both are inside stateJson / the log); the layer writes the deterministic result
// of the ended state. What the rules check: write-once, by a member, for the current match n,
// while the status is 'playing', in the same write that sets it to 'lobby'.

import {
  CODE_OK,
  NEW_ROOM_FROM_DEPTH_2,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  STATUS_BEFORE,
  all,
  isMember,
  isSeatId,
} from './helpers.js';

const RESULT_JSON_MAX = 200000;

export function resultsRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    $n: {
      '.write': all(
        SIGNED_IN,
        CODE_OK,
        '!data.exists()',
        'newData.exists()',
        isMember(ROOM_BEFORE),
        `${STATUS_BEFORE} === 'playing'`,
        `$n === ${ROOM_BEFORE}.child('match/n').val() + ''`,
        `${NEW_ROOM_FROM_DEPTH_2}.child('meta/status').val() === 'lobby'`,
      ),
      '.validate': "newData.hasChildren(['scoreJson', 'joinedAt'])",
      scoreJson: { '.validate': `newData.isString() && newData.val().length <= ${RESULT_JSON_MAX}` },
      joinedAt: {
        '.validate': 'newData.hasChildren()',
        $seatId: { '.validate': all(isSeatId('$seatId'), 'newData.isNumber()') },
      },
      $other: REFUSE,
    },
  };
}
