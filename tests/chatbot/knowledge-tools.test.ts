/**
 * The knowledge tools against a COPY of the real database: who may store
 * information, what gets stored, and what refuses to.
 *
 * Sends are captured, not delivered. The loop behaviour and undo are covered
 * in knowledge-loop.test.ts; this file is about the tool boundaries.
 */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { TOOLS } from '../../electron/chatbot/tools/index';
import { DEFAULT_KNOWLEDGE_EDITORS } from '../../electron/chatbot/knowledgeUpdate';

const COPY = TMP + '/knowledge-tools-test.db';
for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
fs.copyFileSync(LIVE_DB, COPY);
if (fs.existsSync(`${LIVE_DB}-wal`)) fs.copyFileSync(`${LIVE_DB}-wal`, `${COPY}-wal`);

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
const truthy = (label: string, cond: boolean, detail = '') => eq(label + (cond ? '' : `  ${detail}`), cond, true);

const HILA = '972548323665';
const OUTSIDER = '972500001111';
const CONV = 'conv-knowledge-tools-test';
const OTHER_CONV = 'conv-knowledge-tools-other';
const sent: Array<{ to: string; body: string }> = [];

// chatbot_messages references a real conversation.
for (const [id, phone] of [[CONV, HILA], [OTHER_CONV, HILA]] as const) {
  db.prepare("INSERT OR IGNORE INTO chatbot_conversations (id, account_id, phone_number, status) VALUES (?, 'test', ?, 'active')")
    .run(id, phone);
}
db.prepare("UPDATE chatbot_knowledge_updates SET status='cancelled' WHERE status='pending'").run();

const say = (content: string, conversationId = CONV) =>
  db.prepare("INSERT INTO chatbot_messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)")
    .run(`${Date.now()}-${Math.random()}`, conversationId, content);

const ctxFor = (phone: string, conversationId = CONV): any => ({
  accountId: 'test',
  phoneNumber: phone,
  conversation: { id: conversationId, collectedData: {} },
  config: { knowledgeEditors: DEFAULT_KNOWLEDGE_EDITORS, fyiSenders: [] },
  db,
  sendWhatsApp: async (to: string, body: string) => { sent.push({ to, body }); },
  sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async () => ({ ok: false, results: [] }),
  now: new Date(),
});
const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const active = (needle: string) => db.prepare(
  'SELECT title, content FROM chatbot_knowledge WHERE is_active = 1 AND content LIKE ?',
).all(`%${needle}%`) as any[];

const UNIQUE = 'כנס בדיקת כלים ייחודי';

(async () => {
  console.log('=== only an editor may store information ===');
  say(`${UNIQUE} יתקיים ב-04/04/27`);
  let r: any = await tool('recordKnowledgeUpdate').execute({}, ctxFor(OUTSIDER));
  eq('an outsider is refused', r.ok, false);
  eq('nothing was sent to them', sent.length, 0);
  eq('nothing was stored', active(UNIQUE).length, 0);

  console.log('\n=== the editor on the list stores it, and is told what went in ===');
  r = await tool('recordKnowledgeUpdate').execute({}, ctxFor(HILA));
  eq('stored', r.ok, true);
  eq('one new item', r.data.added, 1);
  const rows = active(UNIQUE);
  eq('one entry', rows.length, 1);
  eq('her exact words', rows[0]?.content, `${UNIQUE} יתקיים ב-04/04/27`);
  truthy('the report went to her, from code', sent.length >= 1 && sent.every(m => m.to === HILA));
  truthy('the report says what went in', sent.map(m => m.body).join('\n').includes(UNIQUE));
  eq('the audit row is applied, not pending',
    db.prepare("SELECT status FROM chatbot_knowledge_updates WHERE requester_phone=? ORDER BY rowid DESC LIMIT 1").get(HILA).status,
    'applied');

  console.log('\n=== an empty or reply-only message stores nothing ===');
  sent.length = 0;
  say('תודה רבה');
  r = await tool('recordKnowledgeUpdate').execute({}, ctxFor(HILA));
  eq('refused', r.ok, false);
  eq('nothing sent', sent.length, 0);
  eq('"תודה רבה" was not stored', active('תודה רבה').length, 0);

  console.log('\n=== undo is scoped to the conversation she is in ===');
  r = await tool('undoKnowledgeUpdate').execute({}, ctxFor(HILA, OTHER_CONV));
  eq('refused from a different conversation', r.ok, false);
  eq('the entry is still there', active(UNIQUE).length, 1);

  r = await tool('undoKnowledgeUpdate').execute({}, ctxFor(HILA));
  eq('allowed in the conversation it was stored in', r.ok, true);
  eq('one entry removed', r.data.removed, 1);
  eq('and it is gone', active(UNIQUE).length, 0);

  console.log('\n=== nothing left to undo ===');
  r = await tool('undoKnowledgeUpdate').execute({}, ctxFor(HILA));
  eq('refused', r.ok, false);

  console.log('\n=== an outsider cannot undo someone else\'s update ===');
  say(`${UNIQUE} שוב, ב-05/05/27`);
  await tool('recordKnowledgeUpdate').execute({}, ctxFor(HILA));
  r = await tool('undoKnowledgeUpdate').execute({}, ctxFor(OUTSIDER));
  eq('refused', r.ok, false);
  eq('the entry stands', active(UNIQUE).length, 1);

  raw.close();
  for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\n${pass} passed, ${fail} failed   (ran on a copy; the live database was not touched)`);
  process.exit(fail ? 1 : 0);
})();
