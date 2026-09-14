/**
 * Registry data-safety, against a COPY of the real database.
 *
 * node:sqlite stands in for better-sqlite3 (which is built for Electron's ABI
 * and will not load under plain node). The store only uses prepare/get/run/all
 * and transaction, so a thin shim gives it the same surface.
 */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { saveRegistryContact, importRegistryContacts, deleteRegistryContact } from '../../electron/chatbot/registryStore';

const SRC = LIVE_DB;
const COPY = TMP + '/registry-test.db';
for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
fs.copyFileSync(SRC, COPY);

const raw = new DatabaseSync(COPY);
const db: any = {
  prepare: (sql: string) => raw.prepare(sql),
  exec: (sql: string) => raw.exec(sql),
  transaction: (fn: (...a: any[]) => any) => (...args: any[]) => {
    raw.exec('BEGIN');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const row = (phone: string) => db.prepare('SELECT phone_number, full_name, personal_number, rank, birthday FROM chatbot_known_contacts WHERE phone_number = ?').get(phone);
const count = () => (db.prepare('SELECT COUNT(*) n FROM chatbot_known_contacts').get() as any).n;

console.log('=== migration on an existing database ===');
const before = count();
try { db.exec('ALTER TABLE chatbot_known_contacts ADD COLUMN birthday TEXT;'); } catch {}
try { db.exec('ALTER TABLE chatbot_known_contacts ADD COLUMN birthday TEXT;'); } catch {} // running twice must be harmless
eq('no rows lost to the migration', count(), before);
eq('existing rows have a null birthday', (db.prepare('SELECT COUNT(*) n FROM chatbot_known_contacts WHERE birthday IS NOT NULL').get() as any).n, 0);

const MATAN = '972509620042';
const matanBefore = row(MATAN) as any;
console.log(`  (existing: ${JSON.stringify(matanBefore)})`);

console.log('\n=== import must NOT erase what is already on file ===');
let r = importRegistryContacts(db, [{ phone_number: '0509620042', full_name: 'מתן בנרויו' }]);
eq('counted as an update, not an add', [r.added, r.updated], [0, 1]);
eq('rank kept', (row(MATAN) as any).rank, matanBefore.rank);
eq('personal number kept', (row(MATAN) as any).personal_number, matanBefore.personal_number);

console.log('\n=== import fills a gap without disturbing the rest ===');
importRegistryContacts(db, [{ phone_number: '0509620042', birthday: '03/04/1995' }]);
eq('birthday added', (row(MATAN) as any).birthday, '1995-04-03');
eq('rank still kept', (row(MATAN) as any).rank, matanBefore.rank);

console.log('\n=== import adds new people, and counts honestly ===');
const n0 = count();
r = importRegistryContacts(db, [
  { phone_number: '0501110001', full_name: 'חדש אחד' },
  { phone_number: '0501110002', full_name: 'חדש שניים', rank: 'סמר' },
  { phone_number: '050-111-0001', full_name: 'אותו אדם שוב' }, // duplicate inside the same import
  { phone_number: 'לא מספר', full_name: 'שבור' },               // invalid
]);
eq('added 2, updated 0, skipped 2', [r.added, r.updated, r.skipped], [2, 0, 2]);
eq('exactly 2 new rows', count() - n0, 2);
eq('rank canonicalised on import', (row('972501110002') as any).rank, 'סמ״ר');

console.log('\n=== the bot writing to the registry must not wipe a birthday ===');
// The exact statement saveContactDetails uses — it has no birthday column.
db.prepare(
  `INSERT INTO chatbot_known_contacts (phone_number, full_name, personal_number, rank)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(phone_number) DO UPDATE SET
     full_name       = COALESCE(NULLIF(excluded.full_name, ''), chatbot_known_contacts.full_name),
     personal_number = COALESCE(NULLIF(excluded.personal_number, ''), chatbot_known_contacts.personal_number),
     rank            = COALESCE(NULLIF(excluded.rank, ''), chatbot_known_contacts.rank),
     updated_at      = CURRENT_TIMESTAMP`,
).run(MATAN, 'מתן בנרויו', '', '');
eq('birthday survives the bot upsert', (row(MATAN) as any).birthday, '1995-04-03');

console.log('\n=== manual edit: clearing a field is intentional ===');
let s: any = saveRegistryContact(db, { phone_number: '0501110002', full_name: 'חדש שניים', rank: '' }, '972501110002');
eq('edit ok', s.ok, true);
eq('rank cleared to null', (row('972501110002') as any).rank, null);

console.log('\n=== rename: correcting a phone number ===');
s = saveRegistryContact(db, { phone_number: '0501110009', full_name: 'חדש אחד' }, '972501110001');
eq('rename to a free number ok', s.ok, true);
eq('old number gone', row('972501110001'), undefined);
eq('new number present', (row('972501110009') as any)?.full_name, 'חדש אחד');

console.log('\n=== rename onto someone else\'s number is refused, not merged ===');
const victimBefore = row(MATAN);
s = saveRegistryContact(db, { phone_number: '0509620042', full_name: 'מתחזה' }, '972501110009');
eq('refused', s.ok, false);
eq('the other person is untouched', row(MATAN), victimBefore);
eq('the renamer is untouched', (row('972501110009') as any)?.full_name, 'חדש אחד');

console.log('\n=== adding a number that already exists is refused ===');
s = saveRegistryContact(db, { phone_number: '0509620042', full_name: 'כפילות' });
eq('refused', s.ok, false);
eq('existing record not overwritten', row(MATAN), victimBefore);

console.log('\n=== editing someone who was deleted meanwhile ===');
s = saveRegistryContact(db, { phone_number: '0507777777', full_name: 'רוח' }, '972500000000');
eq('refused rather than silently creating a new person', s.ok, false);
eq('nothing created', row('972507777777'), undefined);

console.log('\n=== delete removes exactly one ===');
const n1 = count();
const d = deleteRegistryContact(db, '972501110009');
eq('deleted', d.deleted, true);
eq('one fewer row', n1 - count(), 1);
eq('deleting again reports nothing to delete', deleteRegistryContact(db, '972501110009').deleted, false);

raw.close();
for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
console.log(`\n${pass} passed, ${fail} failed   (ran on a copy; the live database was not touched)`);
process.exit(fail ? 1 : 0);
