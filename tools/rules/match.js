// rooms/$code/match = { n, seq, stateJson, log: { [seq]: eventsJson } }: the running (or last)
// match of the room. Readable by members. The rules cannot run the engine, so they only check
// the shape of a write: who may write, the match number, the write counter and the log.
//
// - Start: the host, while meta.status is 'lobby', in the same write that sets it to 'playing';
//   n is the previous n + 1 (or 1), seq is 0 and the log holds entry 0 only.
// - Move: any member while the status is 'playing' (submitAction's transaction): n unchanged,
//   seq + 1, a new log entry under the new seq, old entries unchanged.
// - The match is never deleted (for now).

import {
  CODE_OK,
  IS_HOST,
  NEW_ROOM_FROM_DEPTH_1,
  REFUSE,
  ROOM_BEFORE,
  SIGNED_IN,
  STATUS_BEFORE,
  all,
  anyOf,
  isMember,
} from './helpers.js';

const STATE_JSON_MAX = 200000;
const matchBefore = `${ROOM_BEFORE}.child('match')`;

const START = all(
  IS_HOST,
  `${STATUS_BEFORE} === 'lobby'`,
  `${NEW_ROOM_FROM_DEPTH_1}.child('meta/status').val() === 'playing'`,
  anyOf(
    all(`!${matchBefore}.exists()`, "newData.child('n').val() === 1"),
    all(`${matchBefore}.exists()`, `newData.child('n').val() === ${matchBefore}.child('n').val() + 1`),
  ),
  "newData.child('seq').val() === 0",
);

// The rules cannot count or iterate the log, so a move can only be checked entry by entry (log
// validate below) plus this: the newest entry before the write is still there, unchanged.
const latestBefore = "data.child('log').child(data.child('seq').val() + '')";
const latestAfter = "newData.child('log').child(data.child('seq').val() + '')";
const MOVE = all(
  isMember(ROOM_BEFORE),
  `${STATUS_BEFORE} === 'playing'`,
  'data.exists()',
  "newData.child('n').val() === data.child('n').val()",
  "newData.child('seq').val() === data.child('seq').val() + 1",
  `${latestAfter}.val() === ${latestBefore}.val()`,
);

export function matchRules() {
  return {
    '.read': all(SIGNED_IN, isMember(ROOM_BEFORE)),
    '.write': all(SIGNED_IN, CODE_OK, 'newData.exists()', anyOf(START, MOVE)),
    '.validate': "newData.hasChildren(['n', 'seq', 'stateJson', 'log'])",
    n: { '.validate': 'newData.isNumber()' },
    // The log has an entry for the current seq.
    seq: { '.validate': "newData.isNumber() && newData.parent().child('log').child(newData.val() + '').exists()" },
    stateJson: { '.validate': `newData.isString() && newData.val().length <= ${STATE_JSON_MAX}` },
    log: {
      '.validate': 'newData.hasChildren()',
      $entry: {
        // Every entry after the write is either an entry of the running match left unchanged, or
        // the new entry under the new seq. At a start (status 'lobby' before) only entry 0 fits.
        '.validate': all(
          'newData.isString()',
          anyOf(
            all(`${STATUS_BEFORE} === 'playing'`, 'data.exists()', 'newData.val() === data.val()'),
            "$entry === newData.parent().parent().child('seq').val() + ''",
          ),
        ),
      },
    },
    $other: REFUSE,
  };
}
