// Checks that the tools the Firebase emulators need are installed, before any emulator starts.
// The emulators are started by the globally installed `firebase` CLI (firebase-tools), and the
// Realtime Database emulator runs on Java 21 or newer. Without this check a missing tool shows up
// as a long, unclear emulator error.

import { spawnSync } from 'node:child_process';

const MIN_JAVA = 21;
const problems = [];

function run(command) {
  // shell: true so that `firebase.cmd` is found on Windows.
  const result = spawnSync(command, { shell: true, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

const firebase = run('firebase --version');
if (!firebase.ok) {
  problems.push(
    'The `firebase` command was not found. Install the Firebase CLI globally ' +
      '(npm install -g firebase-tools); it is not a project dependency.',
  );
}

const java = run('java -version');
if (!java.ok) {
  problems.push(`Java was not found on PATH. Install a JDK ${MIN_JAVA} or newer and put its bin folder on PATH.`);
} else {
  // `java -version` prints e.g. `java version "1.8.0_513"` or `openjdk version "21.0.13"`.
  const match = java.output.match(/version "([^"]+)"/);
  const parts = match ? match[1].split('.') : [];
  const major = parts[0] === '1' ? Number(parts[1]) : Number(parts[0]);
  if (!Number.isInteger(major)) {
    problems.push(`Could not read the Java version from \`java -version\`:\n${java.output}`);
  } else if (major < MIN_JAVA) {
    const where = run(process.platform === 'win32' ? 'where java' : 'command -v java');
    problems.push(
      `The Firebase emulators need Java ${MIN_JAVA} or newer, but \`java\` on PATH is version ` +
        `${match[1]}${where.ok ? ` (${where.output.split(/\r?\n/)[0]})` : ''}. ` +
        `Put the bin folder of a JDK ${MIN_JAVA}+ before it on PATH, then open a new terminal.`,
    );
  }
}

if (problems.length > 0) {
  console.error('Cannot start the Firebase emulators:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
