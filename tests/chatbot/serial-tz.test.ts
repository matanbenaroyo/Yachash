/** Excel serial dates carrying a timezone fraction must still land on the right day. */
import { parseBirthday } from '../../electron/chatbot/contacts';

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${actual}, expected ${expected}`}`);
};

// 3 April 1995 is serial 34792. The fraction is the writer's UTC offset / 24.
eq('typed in Excel (whole number)', parseBirthday('34792'), '1995-04-03');
eq('written from Israel, UTC+3  (+0.125)', parseBirthday('34792.125'), '1995-04-03');
eq('written from UTC-5          (-0.208)', parseBirthday('34791.79'), '1995-04-03');
eq('written from UTC-10         (-0.417)', parseBirthday('34791.583'), '1995-04-03');
eq('written from UTC+10         (+0.417)', parseBirthday('34792.417'), '1995-04-03');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
