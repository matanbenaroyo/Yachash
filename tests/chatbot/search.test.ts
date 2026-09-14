/**
 * Knowledge retrieval against the real knowledge base (read-only).
 *
 * Covers the two failures that reached users: gershayim abbreviations never
 * matching because only one side was normalised, and a schedule question
 * searching only its own category while the answer sat in `general`.
 */
import { LIVE_DB } from './_env';
import { DatabaseSync } from 'node:sqlite';
import { KnowledgeService } from '../../electron/chatbot/knowledge/KnowledgeService';
import { TOOLS } from '../../electron/chatbot/tools/index';

const raw = new DatabaseSync(LIVE_DB, { readOnly: true });
const db: any = { prepare: (sql: string) => raw.prepare(sql) };
const svc = new KnowledgeService(db);

let pass = 0, fail = 0;
const hit = (label: string, query: string, category: any, expect: string) => {
  const results = svc.search({ query, category });
  const ok = results.some(r => r.title.includes(expect));
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   top: ${results[0]?.title ?? '(nothing)'}`}`);
};

console.log('=== abbreviations, typed with or without gershayim ===');
hit('קקצ 95', 'קקצ 95', 'general', 'קק״צ 95');
hit('קק"צ 94', 'מתי קק"צ 94', 'general', 'קק״צ 94');
hit('סאלים', 'מתי כנס סאלים', 'general', 'סא״לים');
hit('בהד 1', 'איפה בהד 1', 'development_tracks', 'בה״ד 1');
hit('מבדקים', 'מה זה מבדקים', 'development_tracks', 'מבד״קים');
hit('עצרת היחש', 'עצרת היחש', 'general', 'עצרת');

console.log('\n=== short function words must not outrank the real term ===');
hit('"מה יש בספטמבר" finds the month', 'מה יש בספטמבר', 'general', 'ספטמבר');
hit('"לוח אירועים נובמבר"', 'לוח אירועים נובמבר', 'general', 'נובמבר');

console.log('\n=== officer track ===');
hit('מתאם קצונה', 'מה זה מתאם קצונה', 'development_tracks', 'מתאם');
hit('טופס 102', 'טופס 102', 'development_tracks', '102');
hit('תנאי סף', 'תנאי סף לקצונה דפר', 'development_tracks', 'סף');

console.log('\n=== the threshold contradiction travels with the numbers ===');
const threshold = svc.search({ query: 'דפר קבא תנאי סף', category: 'development_tracks' })
  .find(r => r.title.includes('סף'));
const both = Boolean(threshold && threshold.content.includes('50') && threshold.content.includes('60'));
const warns = Boolean(threshold && /סתירה|סותר/.test(threshold.content));
both ? pass++ : fail++; console.log(`${both ? 'PASS' : 'FAIL'}  both figures present in one row`);
warns ? pass++ : fail++; console.log(`${warns ? 'PASS' : 'FAIL'}  contradiction stated in the same row`);

console.log('\n=== category tools fall back to general knowledge ===');
const ctx: any = {
  accountId: 't', phoneNumber: '972500000000', conversation: { id: 'c', collectedData: {} },
  config: {}, db, sendWhatsApp: async () => {}, sendWhatsAppMedia: async () => {},
  createWhatsAppGroup: async () => ({ ok: false, results: [] }), now: new Date(),
};
const tool = (n: string) => TOOLS.find(t => t.name === n)!;

(async () => {
  for (const [name, query, expect] of [
    ['searchReplacementSchedule', 'קקצ 93', 'קק״צ 93'],
    ['searchReplacementSchedule', 'אוגוסט', 'אוגוסט'],
    ['searchOrders', 'הפצת פקודה דשב פברואר', 'דש״ב פברואר'],
  ] as const) {
    const r: any = await tool(name).execute({ query }, ctx);
    const ok = !r.notFound && (r.data ?? []).some((d: any) => String(d.title).includes(expect));
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}("${query}")${ok ? '' : `   ${r.error ?? JSON.stringify(r.data?.[0]?.title)}`}`);
  }

  raw.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
