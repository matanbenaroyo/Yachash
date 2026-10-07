/**
 * Confirmation loops, and the behaviour that replaced them, on a COPY of the
 * database.
 *
 * Twice the bot asked for a confirmation and then answered the confirmation by
 * asking again. On 17.09.2026 an editor's "מאשרת" became the update it was
 * approving; on 06.10.2026 a requester confirmed a message five times and it
 * was never sent, because each "כן" re-prepared it and reset the confirmation.
 *
 * What changed: an authorised editor's information is stored when she sends it,
 * with no approval step at all (updates had been sitting unapproved for three
 * weeks because the editors simply did not answer the bot's question), and a
 * plain "כן" or "בטל" from an authorised person is acted on in code before the
 * model is involved.
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
import {
  extractUpdateBody, classifyReply, isUndoRequest, renderStoredUpdate, renderUndoSummary,
} from '../../electron/chatbot/knowledgeUpdate';

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
eq('gershayim inside the quotes do not block removing them', extractUpdateBody('"תחילת קק"צ ב23.9"'), 'תחילת קק"צ ב23.9');
eq('quotes that are not around the whole text stay', extractUpdateBody('"א" ו-"ב" מתאחדים'), '"א" ו-"ב" מתאחדים');
eq('a single line is left alone', extractUpdateBody('תחילת קק״צ ב23.9'), 'תחילת קק״צ ב23.9');

console.log('\n=== a preamble line without a colon (06.10: both editors opened that way) ===');
eq('"מידע חדש" on its own line', extractUpdateBody('מידע חדש\nביקור בחטיבת ההפעלה נדחה'), 'ביקור בחטיבת ההפעלה נדחה');
eq('"ערב טוב" with an emoji', extractUpdateBody('ערב טוב 😌\nהופץ סיכום חילי לשלב הראשון'), 'הופץ סיכום חילי לשלב הראשון');
eq('"היי" alone', extractUpdateBody('היי\nתחילת קק״צ ב23.9'), 'תחילת קק״צ ב23.9');
eq('a real heading with a colon is kept',
  extractUpdateBody('לוח אירועים ספטמבר:\n* 15/09/26 — קק״צ 94'), 'לוח אירועים ספטמבר:\n* 15/09/26 — קק״צ 94');
eq('a real heading without a colon is kept',
  extractUpdateBody('לוח אירועים ספטמבר\n* 15/09/26 — קק״צ 94'), 'לוח אירועים ספטמבר\n* 15/09/26 — קק״צ 94');
eq('a one-line message is never emptied by the preamble rule', extractUpdateBody('מידע חדש'), 'מידע חדש');

console.log('\n=== replies are recognised, information is not ===');
for (const t of ['מאשרת', 'מאשר', 'כן', 'כן מאשרת', 'מאשרת הכל', 'אישור', 'מאושר', 'מאשרת, תודה', 'אוקי', '👍', 'מאשרת.']) {
  eq(`"${t}" -> approve`, classifyReply(t), 'approve');
}
for (const t of ['בטל', 'ביטול', 'לא', 'לא לעדכן']) eq(`"${t}" -> cancel`, classifyReply(t), 'cancel');
for (const t of ['2 להשאיר', '1 לגרוס']) eq(`"${t}" -> decision`, classifyReply(t), 'decision');
for (const t of ['תציע לי', 'תודה', 'מעולה']) eq(`"${t}" -> chatter`, classifyReply(t), 'chatter');
for (const t of ['תחילת קק״צ ב23.9', MSG1, MSG2, 'לא יתקיים כנס סא״לים השנה']) {
  eq(`information is not a reply: "${t.slice(0, 24).replace(/\n/g, ' ')}"`, classifyReply(t), null);
}

console.log('\n=== "put it back" is recognised ===');
for (const t of ['בטל', 'תבטל', 'תבטל את העדכון', 'תחזיר', 'תחזיר את הקודם', 'זה לא נכון', 'טעות', 'תמחק את זה']) {
  eq(`"${t}" -> undo`, isUndoRequest(t), true);
}
for (const t of ['מאשרת', 'תחילת קק״צ ב23.9', 'לא יתקיים כנס']) eq(`"${t}" is not an undo`, isUndoRequest(t), false);

console.log('\n=== what she is told, built in code ===');
const addedItem: any = { number: 1, kind: 'new', content: 'תחילת קק״צ ב23.9', title: 'תחילת קק״צ ב23.9', matches: [], mentions: [], similarity: 0 };
const changedItem: any = {
  number: 1, kind: 'changed', content: '15/09/26–08/12/26 — קק״צ 94', title: 'קק״צ 94',
  matches: [{ id: 'x', category: 'general', title: 'קק״צ 94', content: '15/09/26–01/12/26 — קק״צ 94' }],
  mentions: [], similarity: 1,
};
let report = renderStoredUpdate([addedItem], new Map([[1, 'add']]) as any,
  { added: 1, replaced: 0, summariesUpdated: 0, stale: [] }).join('\n');
truthy('says it went in', report.includes('נכנס למאגר'));
truthy('shows the new information', report.includes('תחילת קק״צ ב23.9'));
truthy('offers the way back', report.includes('בטל'));
report = renderStoredUpdate([changedItem], new Map([[1, 'replace']]) as any,
  { added: 0, replaced: 1, summariesUpdated: 0, stale: [] }).join('\n');
truthy('a replacement shows the old value', report.includes('היה: 15/09/26–01/12/26 — קק״צ 94'));
truthy('a replacement shows the new value', report.includes('עכשיו: 15/09/26–08/12/26 — קק״צ 94'));
eq('undo summary', renderUndoSummary({ restored: 1, removed: 1, summariesRestored: 0 }),
  'בוטל ✅ פריט אחד הוסר, פריט אחד חזר למה שהיה.');

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
const TARGET = '0502411006';
const setSetting = (k: string, v: string) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
setSetting('chatbot_api_key', 'sk-invalid-for-tests');
setSetting('chatbot_enabled', '1');
setSetting('chatbot_knowledge_editors', JSON.stringify([{ phone: MATAN, name: 'מתן בנרויו', role: '' }]));
setSetting('chatbot_fyi_senders', JSON.stringify([{ phone: MATAN, name: 'מתן בנרויו', role: '' }]));
db.prepare("UPDATE chatbot_knowledge_updates SET status = 'cancelled' WHERE status = 'pending'").run();
db.prepare("UPDATE chatbot_relays SET status = 'cancelled' WHERE status = 'pending'").run();
// Start from a base where these texts are not already known, so every
// assertion below is about what this run stored.
for (const needle of ['תחילת קק״צ ב23.9', 'נוהל לדוגמה']) {
  db.prepare('UPDATE chatbot_knowledge SET is_active = 0 WHERE content LIKE ? OR title LIKE ?').run(`%${needle}%`, `%${needle}%`);
}

const service = new ChatbotService(() => db);
const conversations = new ConversationManager(db);
const conversation = conversations.getOrCreate('simulator', MATAN);
const sent: Array<{ to: string; body: string }> = [];
const ctx: any = {
  accountId: 'simulator', phoneNumber: MATAN, conversation, db,
  config: service.getConfig(),
  sendWhatsApp: async (to: string, body: string) => { sent.push({ to, body }); },
  sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async () => ({ ok: false, results: [] }),
  now: new Date(),
};
const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const say = (content: string) => conversations.appendTurn(conversation.id, { role: 'user', content });
const stored = (needle: string) => db.prepare(
  'SELECT title, content FROM chatbot_knowledge WHERE is_active = 1 AND content LIKE ?',
).all(`%${needle}%`) as any[];
const relayRows = () => db.prepare(
  'SELECT id, status, prepared_turn, body FROM chatbot_relays WHERE requester_phone = ? ORDER BY created_at DESC',
).all(MATAN) as any[];

(async () => {
  console.log('\n=== information goes in when she sends it, with nothing to approve ===');
  say(MSG1);
  let r: any = await tool('recordKnowledgeUpdate').execute({}, ctx);
  eq('stored', r.ok, true);
  const first = stored('תחילת קק״צ ב23.9');
  eq('stored once', first.length, 1);
  eq('in her words, without the preamble', first[0]?.content, 'תחילת קק״צ ב23.9');
  eq('titled by the information', first[0]?.title, 'תחילת קק״צ ב23.9');
  truthy('she was told what went in, from code', sent.some(m => m.body.includes('נכנס למאגר')));
  truthy('the report is in the conversation',
    conversations.recentTurns(conversation.id, 5).some(t => t.role === 'assistant' && t.content.includes('נכנס למאגר')));
  eq('nothing is left waiting for an approval',
    db.prepare("SELECT COUNT(*) n FROM chatbot_knowledge_updates WHERE status='pending'").get().n, 0);

  console.log('\n=== the same message cannot be stored twice ===');
  r = await tool('recordKnowledgeUpdate').execute({}, ctx);
  eq('refused', r.ok, false);
  eq('still one copy', stored('תחילת קק״צ ב23.9').length, 1);

  console.log('\n=== a reply is never information (17.09: "מאשרת" became an entry) ===');
  say('מאשרת');
  r = await tool('recordKnowledgeUpdate').execute({}, ctx);
  eq('refused', r.ok, false);
  eq('"מאשרת" was not stored', stored('מאשרת').length, 0);
  say('תציע לי');
  r = await tool('recordKnowledgeUpdate').execute({}, ctx);
  eq('"תציע לי" refused too', r.ok, false);
  eq('and not stored', stored('תציע לי').length, 0);

  console.log('\n=== a document is stored whole, in her exact words ===');
  say(MSG2);
  r = await tool('recordKnowledgeUpdate').execute({}, ctx);
  eq('stored', r.ok, true);
  const doc = stored('נוהל לדוגמה');
  eq('one entry, not nine', doc.length, 1);
  eq('her exact text', doc[0]?.content, DOC);
  eq('titled by the heading, without the bold markers', doc[0]?.title, 'עדכון והנחיה – נוהל לדוגמה');

  console.log('\n=== "בטל" takes it back out, in code ===');
  const result = await service.simulate(MATAN, 'בטל');
  eq('handled without the model', result.handled, true);
  truthy('she is told it was put back', String(result.reply).includes('בוטל'));
  eq('the document is gone from the base', stored('נוהל לדוגמה').length, 0);
  eq('the earlier update is untouched', stored('תחילת קק״צ ב23.9').length, 1);

  console.log('\n=== a conflicting update replaces, and undo restores the old text exactly ===');
  const victim = db.prepare(
    "SELECT id, title, content FROM chatbot_knowledge WHERE is_active = 1 AND title LIKE 'קק״צ 94%' LIMIT 1",
  ).get() as any;
  if (victim) {
    const before = victim.content;
    say(`קק״צ 94 — 01/01/27–02/02/27`);
    r = await tool('recordKnowledgeUpdate').execute({}, ctx);
    eq('stored', r.ok, true);
    const after = db.prepare('SELECT content FROM chatbot_knowledge WHERE id = ?').get(victim.id) as any;
    truthy('the old row now carries the new dates', String(after.content).includes('01/01/27'), String(after.content));
    truthy('she was shown what was replaced', sent.at(-1)!.body.includes('היה:') || sent.at(-2)!.body.includes('היה:'));

    const undone = await service.simulate(MATAN, 'תחזיר');
    eq('undo handled in code', undone.handled, true);
    eq('the old text is back, character for character',
      (db.prepare('SELECT content FROM chatbot_knowledge WHERE id = ?').get(victim.id) as any).content, before);
  } else {
    console.log('SKIP  no קק״צ 94 row in this database to conflict with');
  }

  console.log('\n=== the relay loop: "כן" sends, once (06.10) ===');
  say(`שלח את ההודעה הבאה למספר הטלפון ${TARGET} : אין כרגע תהליך גיוס לקבע`);
  r = await tool('prepareRelay').execute({ targetNumber: TARGET, messageText: 'אין כרגע תהליך גיוס לקבע' }, ctx);
  eq('prepared', r.ok, true);
  const prepared = relayRows()[0];
  eq('one pending message', prepared.status, 'pending');

  sent.length = 0;
  const confirmed = await service.simulate(MATAN, 'כן');
  eq('handled without the model', confirmed.handled, true);
  truthy('she is told it went out', String(confirmed.reply).includes('נשלח'));
  eq('the message is marked sent', relayRows().find(x => x.id === prepared.id)?.status, 'sent');
  eq('exactly one send', (confirmed.wouldHaveSent ?? []).length, 1);
  eq('to the number she gave', (confirmed.wouldHaveSent ?? [])[0]?.to, '972502411006');

  console.log('\n=== and a second "כן" does not send it again ===');
  const again = await service.simulate(MATAN, 'כן');
  eq('nothing pending, so not handled in code', again.handled, false);
  eq('still exactly one send of that message',
    relayRows().filter(x => x.status === 'sent' && x.body === 'אין כרגע תהליך גיוס לקבע').length, 1);

  console.log('\n=== preparing again on a reply is refused, and does not reset the wait ===');
  say(`שלח את ההודעה הבאה למספר הטלפון ${TARGET} : נוסח אחר לבדיקה`);
  r = await tool('prepareRelay').execute({ targetNumber: TARGET, messageText: 'נוסח אחר לבדיקה' }, ctx);
  eq('prepared', r.ok, true);
  const waiting = relayRows()[0];
  say('כן');
  r = await tool('prepareRelay').execute({ targetNumber: TARGET, messageText: 'נוסח אחר לבדיקה' }, ctx);
  eq('refused: a reply is not a new request', r.ok, false);
  truthy('told to confirm instead', String(r.error).includes('confirmRelay'));
  eq('the same message is still the one waiting', relayRows()[0]?.id, waiting.id);
  eq('its turn was not moved forward', relayRows()[0]?.prepared_turn, waiting.prepared_turn);

  console.log('\n=== re-preparing the identical message keeps the one she saw ===');
  say('מה שלומך');
  r = await tool('prepareRelay').execute({ targetNumber: TARGET, messageText: 'נוסח אחר לבדיקה' }, ctx);
  eq('accepted as the same message', r.ok, true);
  eq('no new row', relayRows()[0]?.id, waiting.id);
  eq('turn unchanged', relayRows()[0]?.prepared_turn, waiting.prepared_turn);
  r = await tool('confirmRelay').execute({}, ctx);
  eq('and it can still be confirmed', r.ok, true);

  raw.close();
  console.log(`\n${pass} passed, ${fail} failed   (ran on a copy; the live database was not touched)`);
  process.exit(fail ? 1 : 0);
})();
