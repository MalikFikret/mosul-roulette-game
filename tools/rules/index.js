// Source of database.rules.json. Edit the rules in this folder, then run `npm run rules:build`;
// never edit database.rules.json by hand (tests/rules-generated.test.js fails if it differs).

import { roomRules } from './room.js';

/** The file the build writes, relative to the project root. */
export const RULES_FILE = 'database.rules.json';

/** @returns {object} the complete security rules object */
export function buildRules() {
  return { rules: { rooms: { $code: roomRules() } } };
}

/** The exact text of database.rules.json: 2-space JSON and a final newline. */
export function rulesText(rules = buildRules()) {
  return `${JSON.stringify(rules, null, 2)}\n`;
}
