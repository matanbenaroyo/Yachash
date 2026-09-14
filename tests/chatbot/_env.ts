/**
 * Shared locations for the chatbot tests.
 *
 * Some suites read the live database (read-only) or work on a copy of it,
 * because the rules they check — matching new knowledge against old, merging
 * imported contacts — only mean something against real rows. On a machine
 * without that database those suites are skipped by the runner, not failed.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';

export const LIVE_DB = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
  'leadsender',
  'leadsender.db',
).replace(/\\/g, '/');

export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'yachash-tests-')).replace(/\\/g, '/');

export const HAS_LIVE_DB = fs.existsSync(LIVE_DB);
