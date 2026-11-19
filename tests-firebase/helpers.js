// Shared setup for the emulator tests. Each test file calls `useRulesTestEnv()` once at the top
// level; it registers node:test hooks that create the test environment from database.rules.json,
// clear the database before every test, and clean up after the file.
//
// These tests run only against the local emulator (`npm run test:rules`), under the demo project
// id below. The `demo-` prefix means Firebase never touches a real project.

import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp, setLogLevel } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

export const PROJECT_ID = 'demo-mosul-roulette';

const root = new URL('../', import.meta.url);
const firebaseConfig = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'));
const RULES = readFileSync(new URL(firebaseConfig.database.rules, root), 'utf8');
const { host, port } = firebaseConfig.emulators.database;

// Denied writes are expected in these tests; the SDK would log a warning for each one.
setLogLevel('error');

let appCounter = 0;

export function useRulesTestEnv() {
  let env = null;
  let modularApps = [];

  afterEach(async () => {
    const apps = modularApps;
    modularApps = [];
    await Promise.all(apps.map((app) => deleteApp(app)));
  });

  before(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      database: { host, port, rules: RULES },
    });
  });
  beforeEach(async () => {
    await env.clearDatabase();
  });
  after(async () => {
    if (env) await env.cleanup();
  });

  function requireEnv() {
    if (!env) throw new Error('the rules test environment is not ready; call this inside a test');
    return env;
  }

  return {
    get env() {
      return requireEnv();
    },
    // A database handle as a signed-out client.
    guestDb() {
      return requireEnv().unauthenticatedContext().database();
    },
    // A database handle as a client signed in with this uid (optional custom token claims).
    userDb(uid, claims) {
      return requireEnv().authenticatedContext(uid, claims).database();
    },
    // A modular-SDK `Database` (firebase/database), as the browser game will use, signed in
    // with this uid (signed out when uid is omitted). It uses the same emulator namespace as
    // the handles above, so the rules of database.rules.json apply. Deleted after each test.
    modularDb(uid) {
      requireEnv();
      appCounter += 1;
      const app = initializeApp(
        { projectId: PROJECT_ID, databaseURL: `http://${host}:${port}?ns=${PROJECT_ID}` },
        `modular-${appCounter}`,
      );
      modularApps.push(app);
      const db = getDatabase(app);
      connectDatabaseEmulator(db, host, port, uid === undefined ? {} : { mockUserToken: { sub: uid } });
      return db;
    },
    // Runs `fn(db)` with security rules switched off, for seeding data and reading it back.
    async withRulesDisabled(fn) {
      let result;
      await requireEnv().withSecurityRulesDisabled(async (context) => {
        result = await fn(context.database());
      });
      return result;
    },
  };
}
