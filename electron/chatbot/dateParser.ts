/**
 * Resolves Hebrew relative date expressions to concrete ISO dates.
 *
 * Date resolution is business logic, not a prompt concern: the model extracts
 * the phrase the user wrote ("מחר", "20.8"), and this code turns it into a real
 * date. That keeps the model from silently inventing a date, and makes genuine
 * ambiguity detectable so the bot can ask instead of guessing.
 */

const WEEKDAYS: Record<string, number> = {
  // Sunday = 0, matching Date#getDay
  'ראשון': 0, 'א': 0,
  'שני': 1, 'ב': 1,
  'שלישי': 2, 'ג': 2,
  'רביעי': 3, 'ד': 3,
  'חמישי': 4, 'ה': 4,
  'שישי': 5, 'ו': 5,
  'שבת': 6, 'ש': 6,
};

const MONTHS: Record<string, number> = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
};

export interface ParsedDate {
  /** ISO yyyy-mm-dd, or null when nothing could be resolved. */
  date: string | null;
  /** True when the phrase maps to more than one plausible date. */
  ambiguous: boolean;
  /** Hebrew clarification question when ambiguous. */
  clarification?: string;
}

export function parseHebrewDate(input: string, now: Date = new Date()): ParsedDate {
  const text = (input || '').trim().toLowerCase();
  if (!text) return { date: null, ambiguous: false };

  const today = startOfDay(now);

  // NOTE: no \b here — JavaScript's \b is defined against ASCII word chars, so
  // it never matches a Hebrew letter boundary and silently fails every one of
  // these. Order matters: מחרתיים contains מחר, so it must be tested first.
  if (text.includes('מחרתיים')) return { date: iso(addDays(today, 2)), ambiguous: false };
  if (text.includes('היום')) return { date: iso(today), ambiguous: false };
  if (text.includes('מחר')) return { date: iso(addDays(today, 1)), ambiguous: false };
  if (text.includes('אתמול')) return { date: iso(addDays(today, -1)), ambiguous: false };

  // Explicit numeric forms: 20.8, 20/8, 20-8-2026, 2026-08-20
  const isoMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const d = makeDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return d ? { date: iso(d), ambiguous: false } : { date: null, ambiguous: false };
  }

  const dmy = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const d = makeDate(year, month, day);
    if (!d) return { date: null, ambiguous: false };
    // No year given and the date already passed → could be this year or next.
    if (!dmy[3] && d < today) {
      const next = makeDate(year + 1, month, day)!;
      return {
        date: null,
        ambiguous: true,
        clarification: `לתאריך ${day}.${month} — התכוונת ל-${iso(d)} או ל-${iso(next)}?`,
      };
    }
    return { date: iso(d), ambiguous: false };
  }

  // "שבוע הבא"
  if (/שבוע\s+הבא/.test(text)) {
    return {
      date: null,
      ambiguous: true,
      clarification: 'לאיזה יום בשבוע הבא? (תאריך מדויק יעזור לי)',
    };
  }

  // "יום ראשון" / "ביום חמישי" — next occurrence of that weekday.
  const dayMatch = text.match(/יום\s+([א-ת]+)/);
  if (dayMatch) {
    const key = dayMatch[1].replace(/^ה/, '');
    const target = WEEKDAYS[key] ?? WEEKDAYS[key[0]];
    if (target !== undefined) {
      let delta = (target - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // "יום ראשון" said on a Sunday means the next one
      return { date: iso(addDays(today, delta)), ambiguous: false };
    }
  }

  // A bare month name ("אוקטובר") identifies a period, not a day.
  for (const [name, month] of Object.entries(MONTHS)) {
    if (text.includes(name)) {
      return {
        date: null,
        ambiguous: true,
        clarification: `באיזה תאריך ב${name}?`,
      };
    }
  }

  return { date: null, ambiguous: false };
}

/** Extracts HH:MM from free text ("ב-09:30", "בשעה 9"). */
export function parseHebrewTime(input: string): string | null {
  const text = (input || '').trim();
  const hhmm = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (hhmm) return `${hhmm[1].padStart(2, '0')}:${hhmm[2]}`;
  // Again, no \b — the preceding token is Hebrew. Reject a following digit or
  // separator so "ב-9:30" is left to the HH:MM branch above.
  const bare = text.match(/(?:בשעה|ב-)\s*([01]?\d|2[0-3])(?![:.\d])/);
  if (bare) return `${bare[1].padStart(2, '0')}:00`;
  return null;
}

/** Returns the Hebrew month name a text refers to, for order/replacement lookups. */
export function extractHebrewMonth(input: string): string | null {
  const text = (input || '').toLowerCase();
  for (const name of Object.keys(MONTHS)) {
    if (text.includes(name)) return name;
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
