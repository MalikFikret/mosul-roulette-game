// Writes database.rules.json from the sources in tools/rules/. Run from anywhere:
//   npm run rules:build

import { writeFileSync } from 'node:fs';
import { RULES_FILE, rulesText } from './index.js';

const target = new URL(`../../${RULES_FILE}`, import.meta.url);
writeFileSync(target, rulesText());
console.log(`wrote ${RULES_FILE}`);
