/**
 * The daily reminder to the knowledge editors, on an in-memory database with a
 * fake clock and a fake WhatsApp manager. Nothing is delivered to anyone.
 */
import { DatabaseSync } from 'node:sqlite';
import {
  KnowledgeReminderScheduler, isDue, localDateKey, renderReminder, MAX_LATE_MS,
} from '../../electron/chatbot/KnowledgeReminderScheduler';
import { getChatbotConfig, saveChatbotConfig } from '../../electron/chatbot/config';
import { DEFAULT_REMINDER_TEXT } from '../../electron/chatbot/knowledgeUpdate';

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

const raw = new DatabaseSync(':memory:');
const db: any = {
  prepare: (sql: string) => raw.prepare(sql),
  exec: (sql: string) => raw.exec(sql),
  transaction: (fn: (...a: any[]) => any) => (...args: any[]) => {
    raw.exec('BEGIN');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};
db.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE chatbot_conversations (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, phone_number TEXT NOT NULL, active_intent TEXT,
    active_workflow TEXT, collected_data TEXT DEFAULT '{}', conversation_context TEXT DEFAULT '',
    status TEXT DEFAULT 'active', last_message_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE chatbot_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
`);

const HILA = '972548323665';
const sends: Array<{ to: string; body: string }> = [];
let failFor = new Set<string>();
const manager = {
  sendMessage: async (_account: string, to: string, body: string) => {
    if (failFor.has(to)) throw new Error('not connected');
    sends.push({ to, body });
  },
};
let managerAvailable = true;
const scheduler = new KnowledgeReminderScheduler(() => db, () => (managerAvailable ? manager : null), () => 'bot-account');
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m);

(async () => {
  console.log('=== defaults: 11:00, the requested text, Hila ===');
  const config = getChatbotConfig(db);
  eq('time', config.knowledgeReminderTime, '11:00');
  eq('text', config.knowledgeReminderText, 'היי {שם} מזכיר לך לעדכן מידע אם יש 🙂');
  eq('rendered for Hila', renderReminder(DEFAULT_REMINDER_TEXT, { name: 'הילה בר לב' }), 'היי הילה מזכיר לך לעדכן מידע אם יש 🙂');

  console.log('\n=== rendering ===');
  eq('no {שם} -> text as-is', renderReminder('בוקר טוב, יש עדכונים?', { name: 'הילה בר לב' }), 'בוקר טוב, יש עדכונים?');
  eq('missing name leaves no double space', renderReminder(DEFAULT_REMINDER_TEXT, { name: '' }), 'היי מזכיר לך לעדכן מידע אם יש 🙂');
  eq('a second editor is greeted by their own name', renderReminder(DEFAULT_REMINDER_TEXT, { name: 'דנה כהן' }), 'היי דנה מזכיר לך לעדכן מידע אם יש 🙂');

  console.log('\n=== when it is due ===');
  eq('10:59 not yet', isDue(at(15, 10, 59), '11:00'), false);
  eq('11:00 due', isDue(at(15, 11, 0), '11:00'), true);
  eq('13:30 still due (WhatsApp was reconnecting)', isDue(at(15, 13, 30), '11:00'), true);
  eq('exactly 3h late still due', isDue(new Date(at(15, 11).getTime() + MAX_LATE_MS), '11:00'), true);
  eq('15:39 skipped - a reminder in the afternoon is noise', isDue(at(15, 15, 39), '11:00'), false);
  eq('malformed time never fires', isDue(at(15, 11), '11'), false);
  eq('local day, not the UTC one', localDateKey(at(15, 0, 30)), '2026-09-15');

  console.log('\n=== bot switched off -> nothing ===');
  eq('no sends', await scheduler.tick(at(15, 11)), []);

  saveChatbotConfig(db, { enabled: true });

  console.log('\n=== installed today at 15:39 -> first reminder is tomorrow, not now ===');
  eq('no send at 15:39', await scheduler.tick(at(14, 15, 39)), []);

  console.log('\n=== 10:59 nothing, 11:00 Hila gets it once ===');
  eq('10:59', await scheduler.tick(at(15, 10, 59)), []);
  eq('11:00 sent to Hila', await scheduler.tick(at(15, 11, 0)), [HILA]);
  eq('exact text', sends.at(-1), { to: HILA, body: 'היי הילה מזכיר לך לעדכן מידע אם יש 🙂' });
  eq('11:01 not again', await scheduler.tick(at(15, 11, 1)), []);
  eq('13:00 not again', await scheduler.tick(at(15, 13, 0)), []);
  eq('one send that day', sends.length, 1);

  console.log('\n=== it is in her conversation, so "אין עדכונים" makes sense to the bot ===');
  const turns = db.prepare(`SELECT m.role, m.content FROM chatbot_messages m
    JOIN chatbot_conversations c ON c.id = m.conversation_id
    WHERE c.phone_number = ? AND c.account_id = 'bot-account'`).all(HILA) as any[];
  eq('recorded as the bot speaking', turns.map(t => [t.role, t.content]), [['assistant', 'היי הילה מזכיר לך לעדכן מידע אם יש 🙂']]);

  console.log('\n=== next day again ===');
  eq('16th 11:00', await scheduler.tick(at(16, 11, 0)), [HILA]);

  console.log('\n=== WhatsApp down at 11:00, back at 11:20 -> sent at 11:20 ===');
  failFor = new Set([HILA]);
  eq('11:00 fails', await scheduler.tick(at(17, 11, 0)), []);
  failFor = new Set();
  eq('11:20 sent', await scheduler.tick(at(17, 11, 20)), [HILA]);
  eq('11:21 not again', await scheduler.tick(at(17, 11, 21)), []);

  console.log('\n=== no manager yet (still starting) -> retried, not lost ===');
  managerAvailable = false;
  eq('11:00 nothing', await scheduler.tick(at(18, 11, 0)), []);
  managerAvailable = true;
  eq('11:02 sent', await scheduler.tick(at(18, 11, 2)), [HILA]);

  console.log('\n=== two editors, one fails -> only that one is retried ===');
  const DANA = '972501112233';
  saveChatbotConfig(db, { knowledgeEditors: [
    { phone: HILA, name: 'הילה בר לב', role: 'קה״ד יח״ש' },
    { phone: DANA, name: 'דנה כהן', role: '' },
  ] } as any);
  failFor = new Set([DANA]);
  eq('11:00 Hila only', await scheduler.tick(at(19, 11, 0)), [HILA]);
  failFor = new Set();
  eq('11:05 Dana only, Hila not twice', await scheduler.tick(at(19, 11, 5)), [DANA]);
  eq('Dana greeted by her name', sends.at(-1)?.body, 'היי דנה מזכיר לך לעדכן מידע אם יש 🙂');

  console.log('\n=== changing the time and text from settings ===');
  saveChatbotConfig(db, { knowledgeEditors: [{ phone: HILA, name: 'הילה בר לב', role: '' }], knowledgeReminderTime: '09:30', knowledgeReminderText: 'בוקר טוב {שם}, יש מידע חדש?' } as any);
  eq('09:29 nothing', await scheduler.tick(at(20, 9, 29)), []);
  eq('09:30 sent', await scheduler.tick(at(20, 9, 30)), [HILA]);
  eq('new text', sends.at(-1)?.body, 'בוקר טוב הילה, יש מידע חדש?');

  console.log('\n=== clearing the time switches it off (and stays off) ===');
  saveChatbotConfig(db, { knowledgeReminderTime: '' } as any);
  eq('stored empty stays empty', getChatbotConfig(db).knowledgeReminderTime, '');
  eq('nothing sent', await scheduler.tick(at(21, 9, 30)), []);
  saveChatbotConfig(db, { knowledgeReminderTime: 'בבוקר' } as any);
  eq('garbage falls back to 11:00', getChatbotConfig(db).knowledgeReminderTime, '11:00');
  saveChatbotConfig(db, { knowledgeReminderText: '   ' } as any);
  eq('blank text falls back to the default', getChatbotConfig(db).knowledgeReminderText, DEFAULT_REMINDER_TEXT);

  raw.close();
  console.log(`\n${pass} passed, ${fail} failed   (in memory; nothing was sent to anyone)`);
  process.exit(fail ? 1 : 0);
})();
