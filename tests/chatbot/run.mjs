/**
 * Runs every chatbot test suite and summarises the result.
 *
 *   npm run test:chatbot
 *
 * These used to live in a temp directory, and Windows cleaned it up — taking
 * the search and fallback tests with it, silently, so the next change to
 * retrieval would have had nothing to catch it. They live in the repository now.
 *
 * Suites that need the live database are skipped, not failed, on a machine
 * that does not have one.
 */
import { spawnSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const liveDb = join(process.env.APPDATA ?? '', 'leadsender', 'leadsender.db');
const hasLiveDb = existsSync(liveDb);

// Suites that read the live database or copy it.
const NEEDS_LIVE_DB = new Set([
  'search.test.ts', 'registry-db.test.ts',
  'knowledge-update.test.ts', 'knowledge-apply.test.ts', 'knowledge-tools.test.ts',
]);

const suites = readdirSync(here).filter(f => f.endsWith('.test.ts')).sort();
let failed = 0;
let totalPass = 0;
let totalFail = 0;

for (const suite of suites) {
  if (NEEDS_LIVE_DB.has(suite) && !hasLiveDb) {
    console.log(`SKIP  ${suite}  (no live database on this machine)`);
    continue;
  }

  const run = spawnSync('npx', ['tsx', join(here, suite)], {
    cwd: join(here, '..', '..'),
    encoding: 'utf8',
    shell: true,
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const summary = out.match(/(\d+) passed, (\d+) failed/);

  if (summary) {
    totalPass += Number(summary[1]);
    totalFail += Number(summary[2]);
  }

  const ok = run.status === 0 && summary && summary[2] === '0';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite.padEnd(28)} ${summary ? `${summary[1]} passed, ${summary[2]} failed` : 'did not report (crashed?)'}`);

  if (!ok) {
    const failures = out.split('\n').filter(l => /^FAIL|Error|error/.test(l)).slice(0, 8);
    for (const line of failures) console.log(`      ${line}`);
  }
}

console.log(`\n${totalPass} assertions passed, ${totalFail} failed across ${suites.length} suites`);
process.exit(failed ? 1 : 0);
