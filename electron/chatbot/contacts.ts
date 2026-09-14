/**
 * The bot's contact registry: parsing and validation for manual edits and bulk
 * import.
 *
 * Kept free of Electron and database imports so the rules can be tested
 * directly, and so the same parser serves both a paste from Excel and an
 * uploaded spreadsheet — each input is reduced to rows of cells first.
 */
import { toWhatsAppNumber } from './phone';
import { classifyRank } from './ranks';

export interface RegistryContact {
  phone_number: string;
  full_name: string | null;
  personal_number: string | null;
  rank: string | null;
  /** 'YYYY-MM-DD', or '--MM-DD' when the year is unknown. */
  birthday: string | null;
}

export interface ParsedImportRow {
  /** 1-based line in the source, so errors point somewhere the user can find. */
  line: number;
  contact: RegistryContact | null;
  errors: string[];
  /** The original cells, shown back when a row cannot be read. */
  raw: string;
}

/* ------------------------------------------------------------------------ */
/* Birthdays                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Reads a birthday in the forms people actually type.
 *
 * Day-first throughout: 03/04/1995 is the 3rd of April, as it is written in
 * Israel. ISO (1995-04-03) is recognised by its four-digit leading year, which
 * cannot be confused with a day. A year is optional — many people will give
 * only the day and month, and forcing a year would mean inventing one.
 *
 * Returns null for anything that is not a real calendar date. 31/02 must be an
 * error, not silently rolled into March by the Date constructor.
 */
export function parseBirthday(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // Excel serial date, e.g. 34800 — what a date cell becomes when read raw.
  if (/^\d{4,5}(\.\d+)?$/.test(raw)) {
    // Round to the nearest whole day rather than truncating.
    //
    // A date typed into Excel is a whole number and needs no help. A fraction
    // appears when a program wrote a JS Date into the file: the writer's
    // timezone offset lands in it — 34792.125 from Israel, 34791.79 from UTC-5,
    // both meaning 3 April. Truncating reads the second as 2 April, which is
    // wrong for every timezone west of UTC. Rounding is right for any offset
    // within ±12 hours, which is effectively everywhere.
    const serial = Math.round(Number(raw));
    if (serial > 59 && serial < 80000) {
      // Excel's epoch is 1899-12-30 once its fictional 1900-02-29 is accounted for.
      const ms = (serial - 25569) * 86_400_000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      }
    }
  }

  // ISO: YYYY-MM-DD
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  // Day first: DD/MM/YYYY, DD.MM.YY, DD-MM-YYYY
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let year = Number(m[3]);
    // Two-digit years: a birthday is in the past, so 95 is 1995 and 03 is 2003.
    if (m[3].length === 2) {
      const pivot = (new Date().getFullYear() % 100) + 1;
      year += year >= pivot ? 1900 : 2000;
    }
    return toIso(year, Number(m[2]), Number(m[1]));
  }

  // Day and month only: DD/MM
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return toMonthDay(Number(m[2]), Number(m[1]));

  return null;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > new Date().getFullYear()) return null;
  if (!isRealDate(year, month, day)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toMonthDay(month: number, day: number): string | null {
  // A leap year, so 29/02 is accepted when no year is given.
  if (!isRealDate(2000, month, day)) return null;
  return `--${pad(month)}-${pad(day)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** For display: 1995-04-03 -> 03/04/1995, --04-03 -> 03/04. */
export function formatBirthday(stored: string | null | undefined): string {
  if (!stored) return '';
  const full = stored.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[3]}/${full[2]}/${full[1]}`;
  const partial = stored.match(/^--(\d{2})-(\d{2})$/);
  if (partial) return `${partial[2]}/${partial[1]}`;
  return stored;
}

/**
 * Days until the next occurrence, 0 meaning today.
 *
 * Someone born on 29 February is celebrated on the 28th in years without one,
 * rather than skipped for three years out of four.
 */
export function daysUntilBirthday(stored: string | null | undefined, today = new Date()): number | null {
  if (!stored) return null;
  const m = stored.match(/^(?:\d{4}|-)-?(\d{2})-(\d{2})$/) ?? stored.match(/^--(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);

  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const occurrence = (year: number) => {
    const safeDay = month === 2 && day === 29 && !isRealDate(year, 2, 29) ? 28 : day;
    return new Date(year, month - 1, safeDay);
  };

  let next = occurrence(base.getFullYear());
  if (next < base) next = occurrence(base.getFullYear() + 1);
  return Math.round((next.getTime() - base.getTime()) / 86_400_000);
}

/* ------------------------------------------------------------------------ */
/* Import                                                                    */
/* ------------------------------------------------------------------------ */

type Field = 'full_name' | 'phone_number' | 'personal_number' | 'rank' | 'birthday';

/** Header names people use for each column, compared without punctuation. */
const HEADER_ALIASES: Record<Field, string[]> = {
  full_name: ['שם', 'שםמלא', 'שםפרטי', 'name', 'fullname'],
  phone_number: ['טלפון', 'נייד', 'פלאפון', 'מספרטלפון', 'טלפוןנייד', 'phone', 'mobile', 'tel'],
  personal_number: ['מספראישי', 'מא', 'מסאישי', 'personalnumber', 'id'],
  rank: ['דרגה', 'rank'],
  birthday: ['יוםהולדת', 'תאריךלידה', 'תאריךיוםהולדת', 'יומולדת', 'birthday', 'dob', 'dateofbirth'],
};

function headerKey(cell: string): string {
  return cell.toLowerCase().replace(/["'`״׳.\-_\s]/g, '');
}

function matchHeader(cell: string): Field | null {
  const key = headerKey(cell);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

/** An IDF personal number: seven digits, occasionally written with a leading zero dropped. */
function looksLikePersonalNumber(cell: string): boolean {
  return /^\d{6,8}$/.test(cell.trim());
}

/**
 * Splits pasted text into rows of cells.
 *
 * A copy from Excel is tab-separated, which is by far the most likely input.
 * When a line has no tab, comma, semicolon or pipe, the cells are left as one
 * and classified token by token later — that way "מתן בנרויו 0509620042" typed
 * on a single line still works, with the name kept whole.
 */
export function splitPastedText(text: string): string[][] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(line => {
      if (line.includes('\t')) return line.split('\t');
      if (/[;|]/.test(line)) return line.split(/[;|]/);
      // Commas only when they separate columns, not inside a single value.
      if (line.includes(',')) return line.split(',');
      return [line];
    })
    .map(cells => cells.map(c => c.trim().replace(/^["']|["']$/g, '')));
}

/**
 * Turns rows of cells into contacts.
 *
 * With a header row, columns are mapped by name. Without one, each cell is
 * classified by what it looks like: a phone number, a seven-digit personal
 * number, a date, a known rank — and whatever is left is the name. That second
 * path matters because pastes are rarely tidy.
 *
 * The phone is mandatory: it is the key the bot looks people up by. Every other
 * field is optional, and a row that fails is reported with its line number
 * rather than dropped, because a silently skipped row is a person who is
 * missing from the registry without anyone knowing.
 */
export function parseContactRows(rows: string[][]): ParsedImportRow[] {
  const nonEmpty = rows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter(r => r.cells.some(c => c.trim()));
  if (!nonEmpty.length) return [];

  // A header row is one where at least two cells name a known column.
  const firstMapping = nonEmpty[0].cells.map(matchHeader);
  const hasHeader = firstMapping.filter(Boolean).length >= 2;
  const dataRows = hasHeader ? nonEmpty.slice(1) : nonEmpty;
  const seenPhones = new Map<string, number>();

  return dataRows.map(({ cells, line }) => {
    const errors: string[] = [];
    const fields: Partial<Record<Field, string>> = {};

    if (hasHeader) {
      firstMapping.forEach((field, i) => {
        if (field && cells[i] !== undefined && cells[i].trim()) fields[field] = cells[i].trim();
      });
    } else {
      classifyCells(cells, fields);
    }

    const phone = fields.phone_number ? toWhatsAppNumber(fields.phone_number) : null;
    if (!fields.phone_number) errors.push('חסר מספר טלפון');
    else if (!phone) errors.push(`מספר טלפון לא תקין: ${fields.phone_number}`);

    let birthday: string | null = null;
    if (fields.birthday) {
      birthday = parseBirthday(fields.birthday);
      if (!birthday) errors.push(`תאריך לידה לא תקין: ${fields.birthday}`);
    }

    if (phone) {
      const earlier = seenPhones.get(phone);
      if (earlier !== undefined) errors.push(`מספר כפול — כבר מופיע בשורה ${earlier}`);
      else seenPhones.set(phone, line);
    }

    const contact: RegistryContact | null = errors.length === 0 && phone
      ? {
          phone_number: phone,
          full_name: fields.full_name?.trim() || null,
          personal_number: fields.personal_number?.trim() || null,
          rank: fields.rank ? (classifyRank(fields.rank)?.canonical ?? fields.rank.trim()) : null,
          birthday,
        }
      : null;

    return { line, contact, errors, raw: cells.filter(c => c.trim()).join(' | ') };
  });
}

/** Assigns fields by content when there is no header row to go by. */
function classifyCells(cells: string[], fields: Partial<Record<Field, string>>): void {
  // A single unsplit line: classify its words instead, keeping the name whole.
  const tokens = cells.length === 1 ? cells[0].split(/\s+/) : cells;
  const leftovers: string[] = [];

  for (const token of tokens) {
    const value = token.trim();
    if (!value) continue;

    if (!fields.phone_number && toWhatsAppNumber(value) && /\d{9,}/.test(value.replace(/\D/g, ''))) {
      fields.phone_number = value;
    } else if (!fields.birthday && /[-/.]/.test(value) && parseBirthday(value)) {
      fields.birthday = value;
    } else if (!fields.personal_number && looksLikePersonalNumber(value)) {
      fields.personal_number = value;
    } else if (!fields.rank && classifyRank(value)) {
      fields.rank = value;
    } else {
      leftovers.push(value);
    }
  }

  if (leftovers.length) fields.full_name = leftovers.join(' ');
}

/**
 * Validates a single contact from the edit dialog.
 *
 * Unlike import, an empty field here is a deliberate choice to clear it, so it
 * becomes null rather than being ignored.
 */
export function validateManualContact(input: {
  phone_number?: string;
  full_name?: string;
  personal_number?: string;
  rank?: string;
  birthday?: string;
}): { contact: RegistryContact | null; errors: string[] } {
  const errors: string[] = [];

  const phone = toWhatsAppNumber(input.phone_number);
  if (!input.phone_number?.trim()) errors.push('חובה למלא מספר טלפון');
  else if (!phone) errors.push('מספר הטלפון לא תקין');

  let birthday: string | null = null;
  if (input.birthday?.trim()) {
    birthday = parseBirthday(input.birthday);
    if (!birthday) errors.push('תאריך הלידה לא תקין (לדוגמה 03/04/1995 או 03/04)');
  }

  if (input.personal_number?.trim() && !/^\d{5,9}$/.test(input.personal_number.trim())) {
    errors.push('מספר אישי צריך להכיל ספרות בלבד');
  }

  if (errors.length || !phone) return { contact: null, errors };

  return {
    contact: {
      phone_number: phone,
      full_name: input.full_name?.trim() || null,
      personal_number: input.personal_number?.trim() || null,
      rank: input.rank?.trim() ? (classifyRank(input.rank)?.canonical ?? input.rank.trim()) : null,
      birthday,
    },
    errors: [],
  };
}
