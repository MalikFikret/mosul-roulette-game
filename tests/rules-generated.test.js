// database.rules.json is generated from tools/rules/. This test builds the rules in memory and
// requires the committed file to be exactly that text, so the JSON is never edited by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RULES_FILE, rulesText } from '../tools/rules/index.js';

// The first differing line, shortened around the first differing character.
function firstDifference(expected, actual) {
  const want = expected.split('\n');
  const got = actual.split('\n');
  for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
    if (want[i] === got[i]) continue;
    const a = want[i] ?? '';
    const b = got[i] ?? '';
    let at = 0;
    while (at < a.length && a[at] === b[at]) at += 1;
    const cut = (line) => line.slice(Math.max(0, at - 40), at + 60);
    return `line ${i + 1}, column ${at + 1}:\n  generated: ${cut(a)}\n  committed: ${cut(b)}`;
  }
  return 'no line differs (line endings?)';
}

test('rules: database.rules.json is exactly what tools/rules/ generates', () => {
  const generated = rulesText();
  const committed = readFileSync(new URL(`../${RULES_FILE}`, import.meta.url), 'utf8');
  if (committed !== generated) {
    assert.fail(
      `${RULES_FILE} does not match the rules generated from tools/rules/.\n` +
        'Do not edit database.rules.json by hand: change the sources in tools/rules/ and run\n' +
        '  npm run rules:build\n' +
        `First difference at ${firstDifference(generated, committed)}`,
    );
  }
});
