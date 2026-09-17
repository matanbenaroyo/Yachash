/**
 * The 17.09.2026 approval loop, replayed on a COPY of the database.
 *
 * What happened: the editor sent an update, got the preview and wrote
 * "מאשרת". The model answered by proposing again; proposing reads her latest
 * message, so "מאשרת" became the update, and every further "מאשרת" repeated
 * it. Separately, "היי עדכון מידע חדש:" and "כן גם זה:" and the quotation marks
 * around the pasted text were being stored as part of the knowledge.
 *
 * The API key in the copy is replaced with an invalid one: anything that still
 * reaches the model fails loudly here instead of quietly costing money.
 */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import { TOOLS } from '../../electron/chatbot/tools/index';
import { ChatbotService } from '../../electron/chatbot/ChatbotService';
import { ConversationManager } from '../../electron/chatbot/ConversationManager';
import { extractUpdateBody, classifyReply, renderApplySummary } from '../../electron/chatbot/knowledgeUpdate';

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const truthy = (label: string, cond: boolean, detail = '') => eq(label + (cond ? '' : `  ${detail}`), cond, true);

// Exactly as sent on 17.09.
const MSG1 = 'היי עדכון מידע חדש:\n"\nתחילת קק״צ ב23.9"';
const DOC = `*עדכון והנחיה – נוהל לדוגמה*

שלום לכולם,

1. השלב הראשון יחליף את השלב שהיה נהוג עד כה.
לאחר ביצועו, כל גורם יעביר:
▪️ סעיף ראשון
▪️ סעיף שני

2. *בנוסף, החל ממועד זה נעצרת ההקצאה לדוגמה ע”י הגורם המוסמך.*

מצורפת מדיניות לדוגמה, אשר תהווה חלק מהתהליך.`;
const MSG2 = `כן גם זה:\n"${DOC}"`;

console.log('=== the update body: no preamble, no wrapping quotes ===');
eq('"היי עדכון מידע חדש:" and the quotes are gone', extractUpdateBody(MSG1), 'תחילת קק״צ ב23.9');
eq('"כן גם זה:" and the quotes are gone, the document is intact', extractUpdateBody(MSG2), DOC);
eq('the trigger phrase still works', extractUpdateBody('להלן מידע חדש:\n* 15/09/26 — קק״צ 94'), '* 15/09/26 — קק״צ 94');
eq('a real heading with a colon is kept',
  extractUpdateBody('לוח אירועים ספטמבר:\n* 15/09/26 — קק״צ 94'), 'לוח אירועים ספטמבר:\n* 15/09/26 — קק״צ 94');
eq('gershayim inside the quotes do not block removing them', extractUpdateBody('"תחילת קק"צ ב23.9"'), 'תחילת קק"צ ב23.9');
eq('quotes that are not around the whole text stay', extractUpdateBody('"א" ו-"ב" מתאחדים'), '"א" ו-"ב" מתאחדים');
eq('a single line is left alone', extractUpdateBody('תחילת קק״צ ב23.9'), 'תחילת קק״צ ב23.9');

console.log('\n=== replies are recognised, information is not ===');
for (const t of ['מאשרת', 'מאשר', 'כן', 'כן מאשרת', 'מאשרת הכל', 'אישור', 'מאושר', 'מאשרת, תודה', 'אוקי', '👍', 'מאשרת.']) {
  eq(`"${t}" -> approve`, classifyReply(t), 'approve');
}
for (const t of ['בטל', 'ביטול', 'לא', 'לא לעדכן']) eq(`"${t}" -> cancel`, classifyReply(t), 'cancel');
for (const t of ['2 להשאיר', '1 לגרוס', '3 לא להוסיף', '1 להשאיר, 2 לגרוס']) eq(`"${t}" -> decision`, classifyReply(t), 'decision');
for (const t of ['תציע לי', 'תודה', 'מעולה']) eq(`"${t}" -> chatter`, classifyReply(t), 'chatter');
for (const t of ['תחילת קק״צ ב23.9', MSG1, MSG2, 'כן גם זה: קק״צ 95 נדחה ל-01/12', 'לא יתקיים כנס סא״לים השנה']) {
  eq(`information is not a reply: "${t.slice(0, 24).replace(/\n/g, ' ')}"`, classifyReply(t), null);
}

console.log('\n=== the summary she gets is built in code ===');
eq('one added', renderApplySummary({ added: 1, replaced: 0, kept: 0, skipped: 0, summariesUpdated: 0, stale: [] }),
  'עודכן ✅ נוסף פריט חדש אחד.');
eq('cancelled', renderApplySummary({ cancelled: true }), 'בוטל ✅ לא שיניתי כלום במאגר.');
truthy('stale items are called out',
  renderApplySummary({ added: 0, replaced: 1, kept: 0, skipped: 0, summariesUpdated: 0, stale: [2] }).includes('פריט 2 לא עודכן'));

// ---------------------------------------------------------------------------

const COPY = `${TMP}/knowledge-loop-test.db`;
fs.copyFileSync(LIVE_DB, COPY);
// Recent changes may still be in the write-ahead log; without it the copy is
// the database as it was at the last checkpoint.
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

const MATAN = '972509620042';
const setSetting = (k: string, v: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
setSetting('chatbot_api_key', 'sk-invalid-for-tests');
setSetting('chatbot_enabled', '1');
setSetting('chatbot_knowledge_editors', JSON.stringify([{ phone: MATAN, name: 'מתן בנרויו', role: '' }]));
db.prepare("UPDATE chatbot_knowledge_updates SET status = 'cancelled' WHERE status = 'pending'").run();
// Start from a base where these texts are not already known, so every
// assertion below is about what this run stored.
for (const needle of ['תחילת קק״צ ב23.9', 'נוהל לדוגמה', 'כנס לדוגמה ייחודי']) {
  db.prepare('UPDATE chatbot_knowledge SET is_active = 0 WHERE content LIKE ? OR title LIKE ?').run(`%${needle}%`, `%${needle}%`);
}

const service = new ChatbotService(() => db);
const conversations = new ConversationManager(db);
const conversation = conversations.getOrCreate('simulator', MATAN);
const sent: string[] = [];
const ctx: any = {
  accountId: 'simulator', phoneNumber: MATAN, conversation, db,
  config: service.getConfig(),
  sendWhatsApp: async (_to: string, body: string) => { sent.push(body); },
  sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async () => ({ ok: false, results: [] }),
  now: new Date(),
};
const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const say = (content: string) => conversations.appendTurn(conversation.id, { role: 'user', content });
const pendingRow = () => db.prepare(
  "SELECT id, source_text FROM chatbot_knowledge_updates WHERE requester_phone = ? AND status = 'pending'",
).get(MATAN) as any;
const stored = (needle: string) => db.prepare(
  'SELECT title, content FROM chatbot_knowledge WHERE is_active = 1 AND content LIKE ?',
).all(`%${needle}%`) as any[];

(async () => {
  console.log('\n=== round 1: the short update ===');
  say(MSG1);
  let r: any = await tool('proposeKnowledgeUpdate').execute({}, ctx);
  eq('proposed', r.ok, true);
  eq('the pending update is the information itself', pendingRow()?.source_text, 'תחילת קק״צ ב23.9');
  truthy('the preview is in the conversation, so the next turn can see it',
    conversations.recentTurns(conversation.id, 5).some(t => t.role === 'assistant' && t.content.includes('עדכון למאגר המידע')));

  r = await tool('applyKnowledgeUpdate').execute({ acceptDefaultsForRest: true }, ctx);
  eq('approving in the same turn as the preview is still refused', r.ok, false);

  console.log('\n=== "מאשרת" goes to code, not to the model ===');
  let result = await service.simulate(MATAN, 'מאשרת');
  eq('handled without the model', result.handled, true);
  eq('she is told what happened', result.reply, 'עודכן ✅ נוסף פריט חדש אחד.');
  const first = stored('תחילת קק״צ ב23.9');
  eq('stored once', first.length, 1);
  eq('stored as the information alone', first[0]?.content, 'תחילת קק״צ ב23.9');
  eq('titled by the information, not by "היי עדכון מידע חדש:"', first[0]?.title, 'תחילת קק״צ ב23.9');

  console.log('\n=== round 2: the document ===');
  say(MSG2);
  r = await tool('proposeKnowledgeUpdate').execute({}, ctx);
  eq('proposed', r.ok, true);
  const realProposal = pendingRow();
  eq('pending is the document without "כן גם זה:" or quotes', realProposal?.source_text, DOC);

  console.log('\n=== the loop: the model proposing on "מאשרת" is refused ===');
  say('מאשרת');
  r = await tool('proposeKnowledgeUpdate').execute({}, ctx);
  eq('refused', r.ok, false);
  truthy('told to apply instead', String(r.error).includes('applyKnowledgeUpdate'), r.error);
  eq('the real update is still the pending one', pendingRow()?.id, realProposal?.id);
  eq('"מאשרת" was never stored', stored('מאשרת').filter(x => x.content.trim() === 'מאשרת').length, 0);

  console.log('\n=== ...and the same for "תציע לי" (15.09) ===');
  say('תציע לי');
  r = await tool('proposeKnowledgeUpdate').execute({}, ctx);
  eq('refused', r.ok, false);
  eq('the real update is still pending', pendingRow()?.id, realProposal?.id);

  console.log('\n=== re-proposing the same text does not send the preview twice ===');
  say(MSG2);
  const before = sent.length;
  r = await tool('proposeKnowledgeUpdate').execute({}, ctx);
  eq('refused', r.ok, false);
  eq('nothing sent', sent.length, before);

  console.log('\n=== her "מאשרת" applies the document ===');
  result = await service.simulate(MATAN, 'מאשרת');
  eq('handled without the model', result.handled, true);
  eq('she is told it was added', result.reply, 'עודכן ✅ נוסף פריט חדש אחד.');
  const doc = stored('נעצרת ההקצאה לדוגמה');
  eq('the document is stored once', doc.length, 1);
  eq('in her exact words', doc[0]?.content, DOC);
  eq('titled by its heading', doc[0]?.title, 'עדכון והנחיה – נוהל לדוגמה');
  eq('nothing is pending any more', pendingRow() ?? null, null);

  console.log('\n=== another "מאשרת" with nothing pending does not store anything ===');
  const countBefore = (db.prepare('SELECT COUNT(*) n FROM chatbot_knowledge WHERE is_active = 1').get() as any).n;
  result = await service.simulate(MATAN, 'מאשרת');
  // With nothing pending it goes to the model, which the invalid key refuses.
  eq('not handled in code', result.handled, false);
  eq('no new knowledge', (db.prepare('SELECT COUNT(*) n FROM chatbot_knowledge WHERE is_active = 1').get() as any).n, countBefore);

  console.log('\n=== "בטל" cancels in code ===');
  say('להלן מידע חדש:\nכנס לדוגמה ייחודי ב-01/02');
  await tool('proposeKnowledgeUpdate').execute({}, ctx);
  result = await service.simulate(MATAN, 'בטל');
  eq('handled', result.handled, true);
  eq('she is told nothing changed', result.reply, 'בוטל ✅ לא שיניתי כלום במאגר.');
  eq('nothing stored', stored('כנס לדוגמה ייחודי').length, 0);
  eq('nothing pending', pendingRow() ?? null, null);

  console.log('\n=== someone who is not an editor saying "מאשרת" is not treated as approval ===');
  const other = await service.simulate('972500009999', 'מאשרת');
  eq('left to the normal pipeline', other.handled, false);

  raw.close();
  for (const f of [COPY, `${COPY}-wal`, `${COPY}-shm`]) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\n${pass} passed, ${fail} failed   (on a copy; nothing sent; only the two cases meant to reach the model did, and the invalid key refused them)`);
  // Not process.exit(): on Windows it aborts inside libuv while the SDK's
  // keep-alive socket from those two calls is still closing.
  process.exitCode = fail ? 1 : 0;
})();
