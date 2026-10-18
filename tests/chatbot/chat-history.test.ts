/**
 * What the bot gets to read before answering.
 *
 * The 18.10.2026 case: a campaign asked 87 people "האם תגיע.י לאירוע 😊: 1. כן
 * 2. לא 3. לא יודע.ת". They replied "1", "2", "3". The bot's own conversation
 * with each of them began with that digit and nothing else, so it opened with
 * its greeting and asked what they needed.
 */
import { buildHistory, toModelTurns, unansweredUnitMessage } from '../../electron/chatbot/chatHistory';

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const truthy = (label: string, cond: boolean, detail = '') => eq(label + (cond ? '' : `  ${detail}`), cond, true);

const INVITE = 'האם תגיע.י לאירוע 😊:\n1. כן\n2. לא \n3. לא יודע.ת';

console.log('=== the campaign message is part of the history ===');
let history = buildHistory(
  [
    { is_from_me: 1, message_text: INVITE, message_type: 'image', timestamp: '2026-10-18T15:15:02.000Z' },
    { is_from_me: 0, message_text: '1', message_type: 'text', timestamp: '2026-10-18T15:15:30.000Z' },
  ],
  [{ role: 'user', content: '1', createdAt: '2026-10-18 15:15:30' }],
  12,
);
eq('two turns, not three', history.length, 2);
eq('the campaign message comes first', history[0].content, INVITE);
eq('and is marked as sent by the unit', history[0].origin, 'unit');
eq('her answer is hers', [history[1].role, history[1].origin], ['user', 'them']);
eq('her answer is not duplicated', history.filter(t => t.content === '1').length, 1);

console.log('\n=== and the model is told who sent it ===');
const modelTurns = toModelTurns(history);
truthy('the campaign message is labelled', modelTurns[0].content.includes('נשלחה אליה מהמערכת'));
truthy('the original text is kept intact', modelTurns[0].content.includes('3. לא יודע.ת'));
eq('her own message is untouched', modelTurns[1].content, '1');

console.log('\n=== what she is answering ===');
eq('the campaign message', unansweredUnitMessage(history.slice(0, -1))?.content, INVITE);
eq('nothing, when the bot spoke last', unansweredUnitMessage(buildHistory(
  [],
  [{ role: 'user', content: 'מתי קק״צ 94?', createdAt: '2026-10-18 10:00:00' },
   { role: 'assistant', content: 'קק״צ 94 מתחיל ב-15/09', createdAt: '2026-10-18 10:00:05' }],
  12,
)) ?? null, null);
eq('nothing, on a genuinely fresh conversation', unansweredUnitMessage(buildHistory(
  [{ is_from_me: 0, message_text: 'היי, יש לי שאלה', message_type: 'text', timestamp: '2026-10-18T09:00:00.000Z' }],
  [{ role: 'user', content: 'היי, יש לי שאלה', createdAt: '2026-10-18 09:00:00' }],
  12,
)) ?? null, null);

console.log('\n=== the bot is not shown its own words twice ===');
history = buildHistory(
  [
    { is_from_me: 0, message_text: 'מתי הכנס?', message_type: 'text', timestamp: '2026-10-18T09:00:00.000Z' },
    { is_from_me: 1, message_text: 'הכנס ב-20/10 🙂', message_type: 'text', timestamp: '2026-10-18T09:00:04.000Z' },
  ],
  [
    { role: 'user', content: 'מתי הכנס?', createdAt: '2026-10-18 09:00:00' },
    { role: 'assistant', content: 'הכנס ב-20/10 🙂', createdAt: '2026-10-18 09:00:04' },
  ],
  12,
);
eq('two turns', history.length, 2);
eq('the answer is attributed to the bot', history[1].origin, 'bot');

console.log('\n=== a line someone from the unit typed by hand counts too ===');
history = buildHistory(
  [
    { is_from_me: 1, message_text: 'תודה רבה הוספתי :)', message_type: 'text', timestamp: '2026-10-18T15:16:40.000Z' },
    { is_from_me: 0, message_text: 'מעולה, תודה', message_type: 'text', timestamp: '2026-10-18T15:17:10.000Z' },
  ],
  [{ role: 'user', content: 'מעולה, תודה', createdAt: '2026-10-18 15:17:10' }],
  12,
);
eq('the hand-typed line is there', history[0].content, 'תודה רבה הוספתי :)');
eq('marked as the unit', history[0].origin, 'unit');

console.log('\n=== media without text, and empty rows that are not media ===');
history = buildHistory(
  [
    { is_from_me: 0, message_text: null, message_type: 'image', timestamp: '2026-10-18T12:00:00.000Z' },
    // WhatsApp delivers these for reactions and protocol messages; one appeared
    // in the 18.10 chat and was being shown to the bot as "[מדיה]".
    { is_from_me: 0, message_text: null, message_type: 'text', timestamp: '2026-10-18T12:00:30.000Z' },
    { is_from_me: 0, message_text: '   ', message_type: 'text', timestamp: '2026-10-18T12:00:40.000Z' },
  ],
  [],
  12,
);
eq('the image is described, the empty rows are dropped', history.map(t => t.content), ['[תמונה]']);

console.log('\n=== bounds and ordering ===');
const many = Array.from({ length: 30 }, (_, i) => ({
  is_from_me: i % 2, message_text: `m${i}`, message_type: 'text',
  timestamp: new Date(Date.UTC(2026, 9, 18, 9, i)).toISOString(),
}));
history = buildHistory(many, [], 8);
eq('limited to the last 8', history.length, 8);
eq('oldest first', history.map(t => t.content), ['m22', 'm23', 'm24', 'm25', 'm26', 'm27', 'm28', 'm29']);
eq('an empty chat is fine', buildHistory([], [], 10), []);

console.log('\n=== the simulator, which writes no chat rows ===');
history = buildHistory([], [
  { role: 'user', content: 'שאלה בסימולטור', createdAt: '2026-10-18 10:00:00' },
], 12);
eq('still has the conversation', history.length, 1);
eq('and it is hers', history[0].origin, 'them');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
