/** Verifies the relay's guard rails. No real sending: sendWhatsApp is captured. */
import { TOOLS } from '../../electron/chatbot/tools/index';
import { DEFAULT_FYI_SENDERS } from '../../electron/chatbot/fyi';
import { toWhatsAppNumber } from '../../electron/chatbot/phone';

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `   ${detail}`}`);
};

console.log('=== number conversion (a wrong number here messages a stranger) ===');
check('0505556699 -> 972505556699', toWhatsAppNumber('0505556699') === '972505556699', String(toWhatsAppNumber('0505556699')));
check('050-555-6699 punctuated', toWhatsAppNumber('050-555-6699') === '972505556699', String(toWhatsAppNumber('050-555-6699')));
check('+972 50 555 6699', toWhatsAppNumber('+972 50 555 6699') === '972505556699', String(toWhatsAppNumber('+972 50 555 6699')));
check('already 972505556699', toWhatsAppNumber('972505556699') === '972505556699', String(toWhatsAppNumber('972505556699')));
check('bare 505556699', toWhatsAppNumber('505556699') === '972505556699', String(toWhatsAppNumber('505556699')));
check('garbage -> null (refuses to guess)', toWhatsAppNumber('12') === null, String(toWhatsAppNumber('12')));
check('empty -> null', toWhatsAppNumber('') === null, String(toWhatsAppNumber('')));

// --- stub world -------------------------------------------------------------
const rows: any[] = [];
let turnCount = 1;
const sent: Array<{ to: string; body: string; media?: string }> = [];

const stubDb = {
  prepare: (sql: string) => ({
    run: (...args: any[]) => {
      if (/INSERT INTO chatbot_relays/i.test(sql)) {
        rows.push({
          id: args[0], conversation_id: args[1], requester_phone: args[2], requester_name: args[3],
          target_phone: args[4], target_raw: args[5], body: args[6], media_filename: args[7],
          status: 'pending', prepared_turn: args[8], created_at: new Date().toISOString(),
        });
      }
      if (/UPDATE chatbot_relays SET status = 'superseded'/i.test(sql)) {
        for (const r of rows) if (r.requester_phone === args[0] && r.status === 'pending') r.status = 'superseded';
      }
      if (/UPDATE chatbot_relays SET status='sent'/i.test(sql)) {
        const r = rows.find(x => x.id === args[0]); if (r) r.status = 'sent';
      }
      if (/UPDATE chatbot_relays SET status='failed'/i.test(sql)) {
        const r = rows.find(x => x.id === args[1]); if (r) { r.status = 'failed'; r.error = args[0]; }
      }
    },
    get: (..._a: any[]) => {
      if (/COUNT\(\*\) n FROM chatbot_messages/i.test(sql)) return { n: turnCount };
      if (/FROM chatbot_relays/i.test(sql)) return rows.filter(r => r.status === 'pending').slice(-1)[0];
      if (/media_filename/i.test(sql)) return null; // no attached image in these cases
      return undefined;
    },
    all: () => [],
  }),
  transaction: (fn: any) => fn,
};

const ctxFor = (phone: string): any => ({
  accountId: 'test',
  phoneNumber: phone,
  conversation: { id: 'conv-relay', collectedData: {} },
  config: { fyiSenders: DEFAULT_FYI_SENDERS },
  db: stubDb,
  sendWhatsApp: async (to: string, body: string) => { sent.push({ to, body }); },
  sendWhatsAppMedia: async (to: string, filePath: string, caption?: string) => { sent.push({ to, body: caption ?? '', media: filePath }); },
  now: new Date(),
});

const tool = (n: string) => TOOLS.find(t => t.name === n)!;
const YUVAL = '972524512658';        // authorised (מפקדת קמפוס)
const OUTSIDER = '972500001111';     // not on the list

(async () => {
  console.log('\n=== an unauthorised number cannot relay ===');
  let r: any = await tool('prepareRelay').execute(
    { targetNumber: '0505556699', messageText: 'שלום' }, ctxFor(OUTSIDER));
  check('prepare refused', r.ok === false, JSON.stringify(r));
  check('nothing queued', rows.length === 0, `${rows.length} rows`);

  console.log('\n=== authorised: prepare does NOT send ===');
  turnCount = 1;
  r = await tool('prepareRelay').execute(
    { targetNumber: '0505556699', messageText: 'בדיקה בבקשה' }, ctxFor(YUVAL));
  check('prepare ok', r.ok === true, JSON.stringify(r));
  check('NOTHING sent yet', sent.length === 0, `${sent.length} sent!`);
  check('preview shows local number', r.data?.target === '0505556699', String(r.data?.target));
  check('preview carries the text verbatim', r.data?.body === 'בדיקה בבקשה', String(r.data?.body));

  console.log('\n=== confirming in the SAME turn is refused ===');
  r = await tool('confirmRelay').execute({}, ctxFor(YUVAL));
  check('refused', r.ok === false, JSON.stringify(r));
  check('still nothing sent', sent.length === 0, `${sent.length} sent!`);

  console.log('\n=== confirming on a LATER turn sends ===');
  turnCount = 3; // the requester replied
  r = await tool('confirmRelay').execute({}, ctxFor(YUVAL));
  check('sent', r.ok === true, JSON.stringify(r));
  check('exactly one message', sent.length === 1, `${sent.length}`);
  check('went to 972505556699', sent[0]?.to === '972505556699', String(sent[0]?.to));
  check('body verbatim', sent[0]?.body === 'בדיקה בבקשה', String(sent[0]?.body));

  console.log('\n=== an unrecognised number is refused, not guessed ===');
  turnCount = 1; rows.length = 0; sent.length = 0;
  r = await tool('prepareRelay').execute({ targetNumber: 'תשלח לרוני', messageText: 'היי' }, ctxFor(YUVAL));
  check('refused', r.ok === false, JSON.stringify(r));
  check('nothing queued', rows.filter(x => x.status === 'pending').length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
