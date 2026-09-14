/**
 * The knowledge-update flow through the real tools, on a COPY of the database.
 * Sends are captured, not delivered.
 */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { TOOLS } from '../../electron/chatbot/tools/index';
import { DEFAULT_KNOWLEDGE_EDITORS } from '../../electron/chatbot/knowledgeUpdate';

const SRC = LIVE_DB;
const COPY = TMP + '/knowledge-tools-test.db';
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

const HILA = '972548323665';
const OUTSIDER = '972500001111';
const CONV = 'conv-knowledge-test';
const sent: Array<{ to: string; body: string }> = [];

// chatbot_messages references a real conversation.
db.prepare("INSERT INTO chatbot_conversations (id, account_id, phone_number, status) VALUES (?, 'test', ?, 'active')")
  .run(CONV, HILA);

// Messages are stored the way the app stores them: the user's turn first.
const say = (content: string, role: 'user' | 'assistant' = 'user') =>
  db.prepare("INSERT INTO chatbot_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)")
    .run(`${Date.now()}-${Math.random()}`, CONV, role, content);

const ctxFor = (phone: string): any => ({
  accountId: 'test', phoneNumber: phone,
  conversation: { id: CONV, collectedData: {} },
  config: { knowledgeEditors: DEFAULT_KNOWLEDGE_EDITORS, fyiSenders: [] },
  db,
  sendWhatsApp: async (to: string, body: string) => { sent.push({ to, body }); },
  sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async () => ({ ok: false, results: [] }),
  now: new Date(),
});
const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const kkz94 = () => db.prepare("SELECT content FROM chatbot_knowledge WHERE title LIKE 'קק״צ 94%'").all() as any[];

(async () => {
  const UPDATE = `להלן מידע חדש:
* 15/09/26–08/12/26 — קק״צ 94
* 03/01/27 — כנס פתיחת שנה לדוגמה ייחודי`;

  console.log('=== someone not on the list is refused ===');
  say(UPDATE);
  let r: any = await tool('proposeKnowledgeUpdate').execute({}, ctxFor(OUTSIDER));
  eq('refused', r.ok, false);
  eq('no preview sent', sent.length, 0);

  console.log('\n=== Hila: propose reads HER message and sends the preview itself ===');
  r = await tool('proposeKnowledgeUpdate').execute({}, ctxFor(HILA));
  eq('ok', r.ok, true);
  eq('counts', [r.data.new, r.data.changed], [1, 1]);
  truthy('preview was sent to her, from code', sent.length >= 1 && sent.every(s => s.to === HILA));
  const preview = sent.map(s => s.body).join('\n');
  truthy('preview shows the old dates', preview.includes('01/12/26'));
  truthy('preview shows the new dates', preview.includes('08/12/26'));
  truthy('nothing changed yet', kkz94().every(row => !row.content.includes('08/12/26')));

  console.log('\n=== applying in the same turn is refused ===');
  r = await tool('applyKnowledgeUpdate').execute({ acceptDefaultsForRest: true }, ctxFor(HILA));
  eq('refused', r.ok, false);
  truthy('still unchanged', kkz94().every(row => !row.content.includes('08/12/26')));

  console.log('\n=== she replies "מאשרת" -> applied ===');
  say('התצוגה נשלחה, מאשרת?', 'assistant');
  say('מאשרת');
  r = await tool('applyKnowledgeUpdate').execute({ acceptDefaultsForRest: true }, ctxFor(HILA));
  eq('ok', r.ok, true);
  eq('1 added, 1 replaced', [r.data.added, r.data.replaced], [1, 1]);
  truthy('קק״צ 94 now has the new dates', kkz94().every(row => row.content.includes('08/12/26')), JSON.stringify(kkz94()));
  const added = db.prepare("SELECT title, content FROM chatbot_knowledge WHERE content LIKE '%כנס פתיחת שנה לדוגמה ייחודי%'").get() as any;
  eq('the new item stored in her exact words', added?.content, '03/01/27 — כנס פתיחת שנה לדוגמה ייחודי');

  console.log('\n=== nothing pending afterwards ===');
  r = await tool('applyKnowledgeUpdate').execute({ acceptDefaultsForRest: true }, ctxFor(HILA));
  eq('a second approval finds nothing to apply', r.ok, false);

  console.log('\n=== "בטל" cancels without changing anything ===');
  sent.length = 0;
  say(`להלן מידע חדש:\n* 15/09/26–30/12/26 — קק״צ 94`);
  await tool('proposeKnowledgeUpdate').execute({}, ctxFor(HILA));
  say('רגע', 'assistant'); say('בטל');
  r = await tool('applyKnowledgeUpdate').execute({ cancel: true }, ctxFor(HILA));
  eq('cancelled', r.data?.cancelled, true);
  truthy('dates unchanged by the cancelled update', kkz94().every(row => row.content.includes('08/12/26') && !row.content.includes('30/12/26')));

  raw.close();
  for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\n${pass} passed, ${fail} failed   (ran on a copy; the live database was not touched)`);
  process.exit(fail ? 1 : 0);
})();
