/**
 * Confirms the existing heuristic is intact: the app's src/ is identical to
 * the Yash branch, and that branch's own tests still pass.
 *
 * Run with:  node src/verifyHeuristic.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Repo root — the sandbox lives in sandbox/ and never edits anything above it. */
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const BRANCH = 'origin/Yash';
const TESTS = ['src/packingScore.test.mjs', 'src/fitSearch.test.mjs'];

const git = (...args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString().trim();

let ok = true;
console.log(`Heuristic source: ${BRANCH} @ ${git('rev-parse', '--short', BRANCH)}`);

// Nothing under the app's src/ may differ from the branch, committed or not.
const changed = git('diff', '--name-only', BRANCH, '--', 'src');
const untracked = git('status', '--porcelain', '--', 'src');
if (changed || untracked) {
  ok = false;
  console.log(`  src/ differs from ${BRANCH}:\n${[changed, untracked].filter(Boolean).join('\n')}`);
} else {
  console.log(`  src/ matches ${BRANCH} exactly (${git('ls-files', 'src').split('\n').length} files)`);
}

// The upstream suite asserts a wall-clock budget (a suggestion inside 200 ms),
// which fails now and then on a busy machine without any code having changed.
// One retry separates that from a real regression; both attempts are printed.
const ATTEMPTS = 2;
let passed = false;
for (let attempt = 1; attempt <= ATTEMPTS && !passed; attempt += 1) {
  const run = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: REPO, encoding: 'utf8' });
  const count = (label) => Number(new RegExp(`^ℹ ${label} (\\d+)`, 'm').exec(run.stdout)?.[1] ?? NaN);
  console.log(`  upstream tests, attempt ${attempt}: ${count('pass')} passed, ${count('fail')} failed of ${count('tests')}`);
  passed = run.status === 0;
  if (!passed) {
    const failing = new Set(run.stdout.split('\n').filter((l) => l.startsWith('✖ ') && !l.includes('failing tests')));
    for (const line of failing) console.log(`    ${line}`);
  }
}
ok &&= passed;

console.log(ok ? 'RESULT: heuristic intact' : 'RESULT: heuristic NOT intact');
process.exit(ok ? 0 : 1);
