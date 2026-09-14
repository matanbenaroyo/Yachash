/** Applying knowledge updates, on a COPY of the real database. */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { splitUpdateIntoItems, proposeItems, resolveDecisions, type ExistingEntry } from '../../electron/chatbot/knowledgeUpdate';
import { createProposal, getPendingProposal, applyProposal } from '../../electron/chatbot/knowledgeUpdateStore';

const SRC = LIVE_DB;
const COPY = TMP + '/knowledge-apply-test.db';
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

// The app creates this table at startup; the copy predates it.
db.exec(`CREATE TABLE IF NOT EXISTS chatbot_knowledge_updates (
  id TEXT PRIMARY KEY, conversation_id TEXT, requester_phone TEXT NOT NULL, requester_name TEXT,
  source_text TEXT, items TEXT, decisions TEXT, undo TEXT, status TEXT DEFAULT 'pending',
  prepared_turn INTEGER, applied_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const truthy = (label: string, cond: boolean, detail = '') => eq(label + (cond ? '' : `  ${detail}`), cond, true);

const loadExisting = () =>
  db.prepare('SELECT id, category, title, content FROM chatbot_knowledge WHERE is_active = 1').all() as ExistingEntry[];
const HILA = '972548323665';

const SOURCE = `* 15/09/26–08/12/26 — קק״צ 94
* 03/01/27 — כנס פתיחת שנה לדוגמה ייחודי
* 15/06/26–25/08/26 — קק״צ 93`;

console.log('=== approve all ===');
const before = (db.prepare('SELECT COUNT(*) n FROM chatbot_knowledge').get() as any).n;
let items = proposeItems(splitUpdateIntoItems(SOURCE), loadExisting());
const pid = createProposal(db, { conversationId: 'c1', requesterPhone: HILA, requesterName: 'הילה בר לב', sourceText: SOURCE, items, preparedTurn: 1 });
let pending = getPendingProposal(db, HILA)!;
eq('proposal stored and readable', pending.id, pid);

let d = resolveDecisions(pending.items, [], true);
let r = applyProposal(db, pending, d.actions, 'הילה בר לב');
eq('1 added, 1 replaced, 1 skipped', [r.added, r.replaced, r.skipped], [1, 1, 1]);
eq('nothing stale', r.stale, []);
truthy('the month summary was updated with it', r.summariesUpdated >= 1, String(r.summariesUpdated));

const after = (db.prepare('SELECT COUNT(*) n FROM chatbot_knowledge').get() as any).n;
eq('exactly one new row (the added item)', after - before, 1);

const kkz94 = db.prepare("SELECT title, content FROM chatbot_knowledge WHERE title LIKE '%קק״צ 94%' AND title NOT LIKE '%שבוע%' AND title NOT LIKE '%היערכות%'").all() as any[];
truthy('the קק״צ 94 row now carries the new end date', kkz94.every(row => row.content.includes('08/12/26')), JSON.stringify(kkz94));

const sept = db.prepare("SELECT content FROM chatbot_knowledge WHERE title LIKE '%ספטמבר 2026%'").get() as any;
truthy('September summary shows the new dates', sept.content.includes('15/09/26–08/12/26 — קק״צ 94'));
truthy('September summary no longer shows the old ones', !sept.content.includes('15/09/26–01/12/26'));
truthy('September summary kept its bullet format', /\n• 15\/09\/26–08\/12\/26 — קק״צ 94/.test('\n' + sept.content));

const kkz93 = db.prepare("SELECT content FROM chatbot_knowledge WHERE title LIKE 'קק״צ 93%'").get() as any;
truthy('unchanged item left exactly as it was (קק״צ 93)', kkz93.content.includes('15/06/26–25/08/26'));

const audit = db.prepare('SELECT status, undo FROM chatbot_knowledge_updates WHERE id = ?').get(pid) as any;
eq('audit row marked applied', audit.status, 'applied');
const undo = JSON.parse(audit.undo);
truthy('old values kept for undo', undo.replacedRows.some((x: any) => x.content.includes('01/12/26')), JSON.stringify(undo.replacedRows).slice(0, 200));

console.log('\n=== "keep" leaves the old version alone ===');
const SOURCE2 = '* 15/09/26–15/12/26 — קק״צ 94';
items = proposeItems(splitUpdateIntoItems(SOURCE2), loadExisting());
createProposal(db, { conversationId: 'c1', requesterPhone: HILA, requesterName: 'הילה', sourceText: SOURCE2, items, preparedTurn: 2 });
pending = getPendingProposal(db, HILA)!;
d = resolveDecisions(pending.items, [{ item: 1, action: 'keep' }], false);
r = applyProposal(db, pending, d.actions, 'הילה');
eq('kept, nothing replaced', [r.kept, r.replaced], [1, 0]);
truthy('still the previously approved date', (db.prepare("SELECT content FROM chatbot_knowledge WHERE title LIKE '%קק״צ 94%' AND title NOT LIKE '%שבוע%' AND title NOT LIKE '%היערכות%'").get() as any).content.includes('08/12/26'));

console.log('\n=== the base changed after the preview: refuse, do not overwrite ===');
const SOURCE3 = '* 15/09/26–20/12/26 — קק״צ 94';
items = proposeItems(splitUpdateIntoItems(SOURCE3), loadExisting());
createProposal(db, { conversationId: 'c1', requesterPhone: HILA, requesterName: 'הילה', sourceText: SOURCE3, items, preparedTurn: 3 });
pending = getPendingProposal(db, HILA)!;
// Someone edits the row in the app between the preview and the approval.
const target = pending.items[0].matches[0];
db.prepare('UPDATE chatbot_knowledge SET content = ? WHERE id = ?').run('נערך באפליקציה בינתיים', target.id);
d = resolveDecisions(pending.items, [], true);
r = applyProposal(db, pending, d.actions, 'הילה');
eq('reported as stale', r.stale, [1]);
eq('nothing replaced', r.replaced, 0);
eq('the in-app edit survived', (db.prepare('SELECT content FROM chatbot_knowledge WHERE id = ?').get(target.id) as any).content, 'נערך באפליקציה בינתיים');

console.log('\n=== a newer proposal supersedes an older pending one ===');
items = proposeItems(splitUpdateIntoItems('* 01/02/27 — פריט א'), loadExisting());
const older = createProposal(db, { conversationId: 'c1', requesterPhone: HILA, requesterName: 'הילה', sourceText: 'א', items, preparedTurn: 4 });
items = proposeItems(splitUpdateIntoItems('* 02/02/27 — פריט ב'), loadExisting());
const newer = createProposal(db, { conversationId: 'c1', requesterPhone: HILA, requesterName: 'הילה', sourceText: 'ב', items, preparedTurn: 5 });
eq('pending is the newer one', getPendingProposal(db, HILA)!.id, newer);
eq('older marked superseded', (db.prepare('SELECT status FROM chatbot_knowledge_updates WHERE id = ?').get(older) as any).status, 'superseded');

raw.close();
for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
console.log(`\n${pass} passed, ${fail} failed   (ran on a copy; the live database was not touched)`);
process.exit(fail ? 1 : 0);
