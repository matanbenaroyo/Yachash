/** Group creation: list parsing and guard rails. Nothing real is created. */
import { TOOLS } from '../../electron/chatbot/tools/index';
import { DEFAULT_FYI_SENDERS } from '../../electron/chatbot/fyi';
import { extractPhoneNumbers } from '../../electron/chatbot/phone';

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `   ${detail}`}`);
};

console.log('=== parsing lists the way people actually paste them ===');

const onePerLine = `0501234567
052-765-4321
+972 53 111 2233`;
let r = extractPhoneNumbers(onePerLine);
check('one per line, mixed formats', r.numbers.length === 3 && r.numbers[0] === '972501234567', JSON.stringify(r.numbers));

const numbered = `1. 0501234567
2. 0527654321
3. 0531112233`;
r = extractPhoneNumbers(numbered);
check('numbered list (index not mistaken for a number)', r.numbers.length === 3, JSON.stringify(r.numbers));

const withNames = `רוני 0501234567
נוי - 0527654321
גלי: 0531112233`;
r = extractPhoneNumbers(withNames);
check('names alongside numbers', r.numbers.length === 3, JSON.stringify(r.numbers));

const commas = '0501234567, 0527654321, 0531112233';
r = extractPhoneNumbers(commas);
check('comma separated', r.numbers.length === 3, JSON.stringify(r.numbers));

r = extractPhoneNumbers('0501234567\n0501234567\n0527654321');
check('duplicates collapsed', r.numbers.length === 2, JSON.stringify(r.numbers));

r = extractPhoneNumbers('0501234567\n123\n0527654321');
check('short junk ignored, real ones kept', r.numbers.length === 2, JSON.stringify(r.numbers));

r = extractPhoneNumbers('אין כאן מספרים בכלל');
check('no numbers -> empty', r.numbers.length === 0);

// --- stub world -------------------------------------------------------------
const rows: any[] = [];
let turnCount = 1;
const created: Array<{ title: string; numbers: string[] }> = [];

const stubDb = {
  prepare: (sql: string) => ({
    run: (...args: any[]) => {
      if (/INSERT INTO chatbot_group_creations/i.test(sql)) {
        rows.push({ id: args[0], requester_phone: args[2], group_name: args[4], numbers: args[5], status: 'pending', prepared_turn: args[6] });
      }
      if (/SET status='superseded'/i.test(sql)) {
        for (const x of rows) if (x.requester_phone === args[0] && x.status === 'pending') x.status = 'superseded';
      }
      if (/SET status='created'/i.test(sql)) {
        const x = rows.find(v => v.id === args[2]); if (x) x.status = 'created';
      }
    },
    get: () => {
      if (/COUNT\(\*\) n FROM chatbot_messages/i.test(sql)) return { n: turnCount };
      if (/FROM chatbot_group_creations/i.test(sql)) return rows.filter(x => x.status === 'pending').slice(-1)[0];
      return undefined;
    },
    all: () => [],
  }),
  transaction: (fn: any) => fn,
};

const ctxFor = (phone: string): any => ({
  accountId: 'test', phoneNumber: phone,
  conversation: { id: 'conv-g', collectedData: {} },
  config: { fyiSenders: DEFAULT_FYI_SENDERS },
  db: stubDb,
  sendWhatsApp: async () => {},
  sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async (title: string, numbers: string[]) => {
    created.push({ title, numbers });
    // Mimic the real mix: one added, one privacy-restricted, one not on WhatsApp.
    return {
      ok: true, groupId: 'g1@g.us',
      results: [
        { phone: numbers[0], outcome: 'added' as const, message: 'ok' },
        { phone: numbers[1], outcome: 'invited' as const, message: 'invite' },
        { phone: numbers[2], outcome: 'not_registered' as const, message: 'no wa' },
      ],
    };
  },
  now: new Date(),
});

const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const YUVAL = '972524512658';
const OUTSIDER = '972500001111';
const LIST = '0501234567\n0527654321\n0531112233';

(async () => {
  console.log('\n=== unauthorised cannot create a group ===');
  let x: any = await tool('prepareGroupCreation').execute({ groupName: 'בדיקה', numbersText: LIST }, ctxFor(OUTSIDER));
  check('refused', x.ok === false, JSON.stringify(x));
  check('nothing queued', rows.length === 0);

  console.log('\n=== authorised: prepare creates NOTHING ===');
  turnCount = 1;
  x = await tool('prepareGroupCreation').execute({ groupName: 'מחזור נובמבר', numbersText: LIST }, ctxFor(YUVAL));
  check('prepare ok', x.ok === true, JSON.stringify(x));
  check('no group created yet', created.length === 0, `${created.length}`);
  check('counted 3', x.data?.count === 3, String(x.data?.count));
  check('preview shows local numbers', x.data?.numbers?.[0] === '0501234567', String(x.data?.numbers?.[0]));

  console.log('\n=== same-turn confirmation refused ===');
  x = await tool('confirmGroupCreation').execute({}, ctxFor(YUVAL));
  check('refused', x.ok === false, JSON.stringify(x));
  check('still nothing created', created.length === 0);

  console.log('\n=== later turn creates, and reports outcomes separately ===');
  turnCount = 3;
  x = await tool('confirmGroupCreation').execute({}, ctxFor(YUVAL));
  check('created', x.ok === true, JSON.stringify(x));
  check('group name passed through', created[0]?.title === 'מחזור נובמבר', String(created[0]?.title));
  check('added reported', x.data?.added?.length === 1, JSON.stringify(x.data?.added));
  check('invited NOT counted as added', x.data?.invitedOnly?.length === 1, JSON.stringify(x.data?.invitedOnly));
  check('not-on-whatsapp reported', x.data?.notOnWhatsApp?.length === 1, JSON.stringify(x.data?.notOnWhatsApp));

  console.log('\n=== oversized list refused rather than mass-added ===');
  turnCount = 1; rows.length = 0; created.length = 0;
  const huge = Array.from({ length: 60 }, (_, i) => `05012345${String(i).padStart(2, '0')}`).join('\n');
  x = await tool('prepareGroupCreation').execute({ groupName: 'ענק', numbersText: huge }, ctxFor(YUVAL));
  check('refused over the cap', x.ok === false, JSON.stringify(x).slice(0, 120));
  check('nothing queued', rows.filter(v => v.status === 'pending').length === 0);

  console.log('\n=== missing pieces are asked for, not invented ===');
  x = await tool('prepareGroupCreation').execute({ groupName: '', numbersText: LIST }, ctxFor(YUVAL));
  check('no name -> refused', x.ok === false);
  x = await tool('prepareGroupCreation').execute({ groupName: 'שם', numbersText: 'בלי מספרים' }, ctxFor(YUVAL));
  check('no numbers -> refused', x.ok === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
