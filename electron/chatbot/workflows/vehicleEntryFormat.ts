/**
 * The vehicle-entry form (פורמט אישור כניסה).
 *
 * Kept in its own file, and sent to users through a tool rather than written
 * into a prompt, so the model always delivers this text VERBATIM and can never
 * paraphrase a field, drop one, or invent one. To change the form — edit here
 * only; nothing else needs to change.
 */

/** Sent to the user when they ask for vehicle-entry authorization. */
export const VEHICLE_ENTRY_FORMAT = `אנא למלא את הפורמט הבא:

פורמט אישור כניסה 2025:
שם מלא:
ת.ז / מספר אישי:
מספר טלפון:
תאריך הגעה:
מילואים/קבע:
דרגה / אזרח (במידה ואזרח רשאי להכנס עם ליווי בלבד):
ביסלפ / ידין:
סיבת ביקור:
רגלי / רכוב:
מספר רכב:
סוג רכב:
צבע רכב:`;

/**
 * Field labels, in order. Used to check a returned form is actually complete
 * before it is forwarded — this is a code-side check, not something the model
 * is trusted to judge.
 */
export const VEHICLE_ENTRY_FIELDS = [
  'שם מלא',
  'ת.ז / מספר אישי',
  'מספר טלפון',
  'תאריך הגעה',
  'מילואים/קבע',
  'דרגה / אזרח',
  'ביסלפ / ידין',
  'סיבת ביקור',
  'רגלי / רכוב',
  'מספר רכב',
  'סוג רכב',
  'צבע רכב',
] as const;

/** Fields a request cannot be forwarded without. */
const MANDATORY = ['שם מלא', 'ת.ז / מספר אישי', 'מספר טלפון', 'תאריך הגעה'];

export interface ParsedVehicleForm {
  /** label -> value, for whatever the user actually filled in. */
  values: Record<string, string>;
  /** Mandatory labels still blank. */
  missing: string[];
  /** True when every mandatory field has a value. */
  complete: boolean;
}

/**
 * Parses a filled form back into fields.
 *
 * Tolerant on purpose: people reorder lines, drop the colon, use ״ת.ז״ or
 * ״תז״, and add stray blank lines. Matching is done on a normalized form of
 * each label so ordinary WhatsApp typing still parses.
 */
export function parseVehicleEntryForm(text: string): ParsedVehicleForm {
  const values: Record<string, string> = {};
  const lines = (text || '').split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes(':')) continue;

    const idx = line.indexOf(':');
    const rawLabel = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;

    const match = VEHICLE_ENTRY_FIELDS.find(f => normalize(f) === normalize(rawLabel))
      // Fall back to a prefix match so "דרגה / אזרח (במידה ...)" still lands.
      ?? VEHICLE_ENTRY_FIELDS.find(f => normalize(rawLabel).startsWith(normalize(f).slice(0, 6)));

    if (match) values[match] = value;
  }

  const missing = MANDATORY.filter(f => !values[f]);
  return { values, missing, complete: missing.length === 0 };
}

/** Renders the parsed form for forwarding to staff. */
export function renderVehicleEntryForm(values: Record<string, string>): string {
  return VEHICLE_ENTRY_FIELDS.filter(f => values[f])
    .map(f => `${f}: ${values[f]}`)
    .join('\n');
}

/**
 * Normalizes a field label for matching.
 *
 * Also drops י and ו, because Hebrew is written both כתיב מלא and כתיב חסר and
 * people mix them freely — "מלואים/קבע" and "מילואים/קבע" are the same field,
 * as are "תז" and "ת.ז". Verified that all 12 labels stay distinct after this.
 */
function normalize(s: string): string {
  return s
    .replace(/[״"'`׳]/g, '')
    .replace(/\(.*?\)/g, '')   // drop parenthetical hints
    .replace(/[.\s]/g, '')
    .replace(/[יו]/g, '')
    .toLowerCase();
}
