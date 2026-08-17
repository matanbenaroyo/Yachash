/**
 * "פורמט הפצת מידע - FYI" — authorized information broadcasts.
 *
 * Distinct from קול קורא: only a fixed list of staff may send an FYI, and an
 * accepted one is edited and broadcast to the unit's WhatsApp groups, then
 * included in a daily digest.
 *
 * Both the sender list and the destination groups are DATA — stored in the
 * `settings` table and editable from the UI. The values here are the initial
 * defaults only.
 */

import { toLocalIsraeliPhone } from './phone';

export interface FyiSender {
  /** Digits only, e.g. 972532840405. */
  phone: string;
  name: string;
  /** Role, included in the broadcast so recipients know who sent it. */
  role: string;
}

export interface FyiGroup {
  /** WhatsApp chat id, e.g. 120363361331855880@g.us */
  chatId: string;
  label: string;
}

export const DEFAULT_FYI_SENDERS: FyiSender[] = [
  { phone: '972532840405', name: 'רוני אשר', role: 'רמ״ד סגל קצונה' },
  { phone: '972528891059', name: 'נוי עזרי', role: 'רמ״ד סגל זוטר' },
  { phone: '972525729643', name: 'גלי קטאש', role: 'רמ״ד סגל בכיר' },
  { phone: '972529217523', name: 'לירז אהרון', role: 'רמ״ד נגדים' },
  { phone: '972524512658', name: 'יובל אביב', role: 'מפקדת קמפוס' },
  { phone: '972524622805', name: 'סהר ארבל לנדאו', role: 'רת״ח היח״ש' },
  { phone: '972529572306', name: 'קורל חטאב', role: 'ע׳ קמ״ד סגל זוטר' },
  { phone: '972524452056', name: 'מורן רחמני', role: 'קמ״ד סגל בכיר' },
  { phone: '972524679733', name: 'שחר דהן', role: 'קמ״ד נגדים' },
  { phone: '972548323665', name: 'הילה בר לב', role: 'קה״ד יח״ש' },
  { phone: '972542379893', name: 'מירב ברוקר טוויטו', role: 'רת״ח ייעוץ והשמה' },
  { phone: '972535550481', name: 'בקי אלבוחר', role: 'קמ״ד ארגון ותקינה' },
  { phone: '972525832927', name: 'חן בירון בלינדר', role: 'קמ״ד תיאום והפקה' },
];

export const DEFAULT_FYI_GROUPS: FyiGroup[] = [
  { chatId: '972529437897-1434030286@g.us', label: 'קבוצת משא״ן' },
  { chatId: '120363361331855880@g.us', label: 'קבוצת נאמני יח״ש' },
];

/** The blank form an authorized sender fills in. */
export const FYI_FORMAT = `פורמט הפצת מידע - FYI

נושא ההודעה:

אוכלוסיה:

דגשים:

תג״ב (אם יש):`;

/** Fields, in canonical order. תג״ב is optional by design. */
export const FYI_FIELDS = ['נושא ההודעה', 'אוכלוסיה', 'דגשים', 'תג״ב'] as const;
const MANDATORY: string[] = ['נושא ההודעה', 'אוכלוסיה', 'דגשים'];

export interface ParsedFyi {
  values: Record<string, string>;
  missing: string[];
  complete: boolean;
}

/**
 * Parses a filled FYI form.
 *
 * Values may span several lines (דגשים is often a bulleted list), so a field
 * collects everything up to the next recognised label rather than just the
 * remainder of its own line.
 */
export function parseFyiForm(text: string): ParsedFyi {
  const values: Record<string, string> = {};
  const lines = (text || '').split(/\r?\n/);

  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      const joined = buffer.join('\n').trim();
      if (joined) values[current] = joined;
    }
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    // Skip the form's own title line.
    if (/^(פורמט|פרומט)\s+הפצת\s+מידע/.test(line)) continue;

    const idx = line.indexOf(':');
    const label = idx > -1 ? matchField(line.slice(0, idx)) : null;

    if (label) {
      flush();
      current = label;
      const inline = line.slice(idx + 1).trim();
      if (inline) buffer.push(inline);
    } else if (current && line) {
      buffer.push(line);
    }
  }
  flush();

  const missing = MANDATORY.filter(f => !values[f]);
  return { values, missing, complete: missing.length === 0 };
}

function matchField(rawLabel: string): string | null {
  const n = normalize(rawLabel);
  return (
    FYI_FIELDS.find(f => normalize(f) === n) ??
    FYI_FIELDS.find(f => n.startsWith(normalize(f))) ??
    null
  );
}

/** Recognises a message as an FYI form even before it is parsed. */
export function looksLikeFyi(text: string): boolean {
  if (/הפצת\s+מידע|\bfyi\b/i.test(text || '')) return true;
  const parsed = parseFyiForm(text);
  return Object.keys(parsed.values).length >= 2;
}

/** Finds the authorized sender for an incoming phone number, or null. */
export function findSender(phone: string, senders: FyiSender[]): FyiSender | null {
  const incoming = digits(phone);
  if (!incoming) return null;
  return (
    senders.find(s => digits(s.phone) === incoming) ??
    // Tolerate country-code / leading-zero differences by comparing the last 9.
    senders.find(s => {
      const a = digits(s.phone).slice(-9);
      const b = incoming.slice(-9);
      return a.length === 9 && a === b;
    }) ??
    null
  );
}

/** The broadcast body sent to the groups. */
export function renderFyiBroadcast(values: Record<string, string>, sender: FyiSender): string {
  const parts = [`הפצת מידע - FYI 📢`, ''];
  for (const f of FYI_FIELDS) {
    if (values[f]) parts.push(`${f}: ${values[f]}`);
  }
  parts.push('', `נשלח על ידי: ${sender.name}${sender.role ? ` — ${sender.role}` : ''}`);
  return parts.join('\n');
}

/**
 * One entry of the daily digest. Per the spec this carries the contact and
 * their phone number, and omits the form's title line.
 */
export function renderDigestEntry(values: Record<string, string>, sender: FyiSender): string {
  const parts = [
    `איש קשר: ${sender.name}${sender.role ? ` — ${sender.role}` : ''} (${toLocalIsraeliPhone(sender.phone)})`,
  ];
  for (const f of FYI_FIELDS) {
    parts.push(`${f}: ${values[f] ?? '—'}`);
  }
  return parts.join('\n');
}

export function normalizePhone(input: string): string {
  return digits(input);
}

function digits(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

function normalize(s: string): string {
  return s
    .replace(/[״"'`׳]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[.\s]/g, '')
    .replace(/[יו]/g, '')
    .toLowerCase();
}
