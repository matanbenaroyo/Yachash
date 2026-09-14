/** Registry parsing: birthdays, import formats, and the traps in between. */
import {
  parseBirthday, formatBirthday, daysUntilBirthday,
  splitPastedText, parseContactRows, validateManualContact,
} from '../../electron/chatbot/contacts';

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

console.log('=== birthdays: forms people type ===');
eq('03/04/1995 (day first)', parseBirthday('03/04/1995'), '1995-04-03');
eq('3.4.1995', parseBirthday('3.4.1995'), '1995-04-03');
eq('03-04-1995', parseBirthday('03-04-1995'), '1995-04-03');
eq('1995-04-03 ISO', parseBirthday('1995-04-03'), '1995-04-03');
eq('03/04 no year', parseBirthday('03/04'), '--04-03');
eq('03/04/95 two-digit year', parseBirthday('03/04/95'), '1995-04-03');
eq('01/01/05 -> 2005', parseBirthday('01/01/05'), '2005-01-01');

console.log('\n=== birthdays: impossible dates must be rejected, not rolled over ===');
eq('31/02/1995', parseBirthday('31/02/1995'), null);
eq('32/01/1995', parseBirthday('32/01/1995'), null);
eq('00/05/1995', parseBirthday('00/05/1995'), null);
eq('15/13/1995 (month 13)', parseBirthday('15/13/1995'), null);
eq('29/02/2023 (not leap)', parseBirthday('29/02/2023'), null);
eq('29/02/2024 (leap)', parseBirthday('29/02/2024'), '2024-02-29');
eq('29/02 no year allowed', parseBirthday('29/02'), '--02-29');
eq('future year rejected', parseBirthday('01/01/2099'), null);
eq('text rejected', parseBirthday('מחר'), null);
eq('empty -> null', parseBirthday(''), null);

console.log('\n=== Excel serial dates (a date cell read raw) ===');
eq('serial 34797 -> 1995-04-08', parseBirthday('34797'), '1995-04-08');

console.log('\n=== display ===');
eq('format full', formatBirthday('1995-04-03'), '03/04/1995');
eq('format no year', formatBirthday('--04-03'), '03/04');
eq('format empty', formatBirthday(null), '');

console.log('\n=== days until ===');
const today = new Date(2026, 8, 14); // 14 Sep 2026
eq('today -> 0', daysUntilBirthday('1990-09-14', today), 0);
eq('tomorrow -> 1', daysUntilBirthday('--09-15', today), 1);
eq('yesterday -> 364', daysUntilBirthday('1990-09-13', today), 364);
eq('29 Feb in a non-leap year lands on the 28th', daysUntilBirthday('--02-29', new Date(2027, 1, 27)), 1);

console.log('\n=== import: Excel paste with a Hebrew header ===');
let rows = parseContactRows(splitPastedText(
  'שם\tטלפון\tמספר אישי\tדרגה\tיום הולדת\n' +
  'מתן בנרויו\t0509620042\t7643131\tרס"ן\t03/04/1995\n' +
  'טל נבט\t052-123-4567\t9239297\tסמר\t'));
eq('two data rows', rows.length, 2);
eq('row 1 parsed', rows[0].contact, {
  phone_number: '972509620042', full_name: 'מתן בנרויו', personal_number: '7643131', rank: 'רס״ן', birthday: '1995-04-03',
});
eq('row 2 phone normalised', rows[1].contact?.phone_number, '972521234567');
eq('row 2 rank canonicalised', rows[1].contact?.rank, 'סמ״ר');
eq('row 2 no birthday is fine', rows[1].contact?.birthday, null);
eq('line numbers point at the source (header is line 1)', rows.map(r => r.line), [2, 3]);

console.log('\n=== import: no header, cells classified by content ===');
rows = parseContactRows(splitPastedText('0509620042\tמתן בנרויו\t03/04/1995\t7643131'));
eq('phone found out of order', rows[0].contact?.phone_number, '972509620042');
eq('personal number not mistaken for phone', rows[0].contact?.personal_number, '7643131');
eq('date not mistaken for anything else', rows[0].contact?.birthday, '1995-04-03');
eq('name is the leftover', rows[0].contact?.full_name, 'מתן בנרויו');

console.log('\n=== import: one line typed with spaces, name kept whole ===');
rows = parseContactRows(splitPastedText('דניאל קמבצית 0586667713 9152058 סמ״ר 12.11.2001'));
eq('whole row', rows[0].contact, {
  phone_number: '972586667713', full_name: 'דניאל קמבצית', personal_number: '9152058', rank: 'סמ״ר', birthday: '2001-11-12',
});

console.log('\n=== import: rows that must be reported, not dropped ===');
rows = parseContactRows(splitPastedText(
  'שם\tטלפון\tיום הולדת\n' +
  'בלי טלפון\t\t01/01/1990\n' +
  'טלפון שבור\t123\t\n' +
  'תאריך שבור\t0501111111\t31/02/1990\n' +
  'תקין\t0502222222\t\n' +
  'כפול\t050-222-2222\t'));
eq('five data rows returned', rows.length, 5);
eq('missing phone flagged', rows[0].errors, ['חסר מספר טלפון']);
eq('bad phone flagged', rows[1].contact, null);
eq('bad birthday blocks the row', rows[2].contact, null);
eq('valid row kept', rows[3].contact?.phone_number, '972502222222');
eq('duplicate phone flagged with the earlier line', rows[4].errors, ['מספר כפול — כבר מופיע בשורה 5']);

console.log('\n=== import: blank lines do not shift line numbers ===');
rows = parseContactRows(splitPastedText('שם\tטלפון\n\nא\t0503333333\n\nב\t0504444444'));
eq('lines 3 and 5', rows.map(r => r.line), [3, 5]);

console.log('\n=== manual edit ===');
let v = validateManualContact({ phone_number: '0509620042', full_name: 'מתן', birthday: '03/04/1995', rank: 'רסן' });
eq('valid edit', v.contact, { phone_number: '972509620042', full_name: 'מתן', personal_number: null, rank: 'רס״ן', birthday: '1995-04-03' });
v = validateManualContact({ phone_number: '', full_name: 'מתן' });
eq('phone required', v.errors, ['חובה למלא מספר טלפון']);
v = validateManualContact({ phone_number: '0509620042', birthday: '31/02' });
eq('bad birthday rejected', v.contact, null);
v = validateManualContact({ phone_number: '0509620042', personal_number: '76-43' });
eq('non-digit personal number rejected', v.contact, null);
v = validateManualContact({ phone_number: '0509620042', full_name: '' });
eq('empty field clears (null), not ignored', v.contact?.full_name, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
