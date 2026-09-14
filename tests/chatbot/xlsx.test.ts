/**
 * The Excel upload path, end to end, on a real .xlsx.
 *
 * The risk is dates. A date cell is stored as a serial number; read as display
 * text it comes back in whatever locale formatted it, so 03/04/1995 can arrive
 * as "4/3/95" and be read as the 4th of March. Phones stored as numbers also
 * lose their leading zero. This mirrors readSpreadsheetRows in ipc.ts.
 */
import { LIVE_DB, TMP } from './_env';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { parseContactRows } from '../../electron/chatbot/contacts';

const FILE = TMP + '/registry-test.xlsx';

// Build it the way Excel would: a true date cell, and a phone typed as a number.
const ws = XLSX.utils.aoa_to_sheet([
  ['שם', 'טלפון', 'מספר אישי', 'דרגה', 'יום הולדת'],
  ['מתן בנרויו', 509620042, 7643131, 'רס"ן', new Date(Date.UTC(1995, 3, 3))],   // 3 April 1995
  ['טל נבט', '052-123-4567', '9239297', 'סמר', new Date(Date.UTC(2001, 10, 12))], // 12 Nov 2001
  ['בלי יום הולדת', '0531112233', '', '', ''],
], { cellDates: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'contacts');
XLSX.writeFile(wb, FILE);

// Read exactly as the app does.
const read = XLSX.readFile(FILE);
const sheet = read.Sheets[read.SheetNames[0]];
const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][])
  .map(row => row.map(cell => (cell === null || cell === undefined ? '' : String(cell).trim())));

console.log('raw cells as the app sees them:');
for (const r of rows) console.log('  ', JSON.stringify(r));

const parsed = parseContactRows(rows);

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('');
eq('three data rows', parsed.length, 3);
eq('date cell -> 3 April 1995 (not 4 March)', parsed[0].contact?.birthday, '1995-04-03');
eq('phone stored as a number regains its prefix', parsed[0].contact?.phone_number, '972509620042');
eq('personal number stored as a number', parsed[0].contact?.personal_number, '7643131');
eq('second date -> 12 Nov 2001', parsed[1].contact?.birthday, '2001-11-12');
eq('rank canonicalised', parsed[1].contact?.rank, 'סמ״ר');
eq('empty cells are fine', parsed[2].contact, {
  phone_number: '972531112233', full_name: 'בלי יום הולדת', personal_number: null, rank: null, birthday: null,
});
eq('no rows rejected', parsed.filter(p => !p.contact).length, 0);

fs.unlinkSync(FILE);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
