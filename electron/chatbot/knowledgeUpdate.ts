/**
 * Updating the knowledge base from a WhatsApp message.
 *
 * An authorised editor sends "להלן מידע חדש" followed by the information. It is
 * split into items, each is compared with what the bot already knows, and the
 * editor decides per item before anything changes.
 *
 * Two properties are non-negotiable, because this edits what the bot tells
 * everyone:
 *
 *  - The stored text is the editor's own words, taken from her message as it
 *    was received. The model never retypes it. A model restating a long update
 *    can drop a line, "tidy" a date or run out of output tokens halfway through,
 *    and any of those would put something into the knowledge base she did not
 *    write.
 *
 *  - Nothing is replaced silently. Where new information conflicts with old,
 *    both are shown and she chooses. Newer information is the default, because
 *    she is the one sending it, but it is still her decision.
 *
 * Free of Electron and database imports so the matching rules can be tested
 * directly.
 */

/**
 * Who may change the knowledge base over WhatsApp.
 *
 * Deliberately narrower than the FYI senders: an FYI goes out once and is
 * gone, but an update rewrites what the bot tells everyone from now on. Stored
 * in settings and editable in the app; this is only the initial value.
 */
export const DEFAULT_KNOWLEDGE_EDITORS = [
  { phone: '972548323665', name: 'הילה בר לב', role: 'קה״ד יח״ש' },
];

/** Daily reminder to the editors. `{שם}` becomes each recipient's first name. */
export const DEFAULT_REMINDER_TEXT = 'היי {שם} מזכיר לך לעדכן מידע אם יש 🙂';

export const UPDATE_TRIGGER = /(?:להלן|הנה)\s+מידע\s+חדש\s*[:：\-–—]?/;

/** True when a message is asking to update the knowledge base. */
export function isKnowledgeUpdate(text: string): boolean {
  return UPDATE_TRIGGER.test(String(text ?? ''));
}

/** The information itself, with the trigger phrase removed. */
export function extractUpdateBody(text: string): string {
  return String(text ?? '').replace(UPDATE_TRIGGER, '').trim();
}

export interface UpdateItem {
  title: string;
  content: string;
}

const BULLET = /^\s*(?:[-*•●▪◦]|\d{1,3}[.)])\s+/;

/**
 * Splits the information into items, in the editor's own words.
 *
 * A schedule becomes one item per line, because "קק״צ 94" and "קק״צ 95" are
 * separate facts that have to be matched, and replaced, separately. A heading
 * directly above such a list is carried into each item so the context is not
 * lost.
 *
 * Anything else stays ONE item. A policy update — a heading, "שלום לכולם,",
 * numbered sections, a couple of sub-bullets — was being cut at every blank
 * line, which produced items like "שלום לכולם," and asked the editor to
 * approve nine fragments none of which was a fact on its own. It also broke
 * the sentences apart in the knowledge base, so the bot could later quote a
 * rule without the paragraph that qualifies it. A document is one thing to
 * decide about and one thing to store.
 */
export function splitUpdateIntoItems(body: string): UpdateItem[] {
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = allLines.filter(isListEntry).length;

  // Mostly list entries -> a schedule. Otherwise -> a document, kept whole.
  if (!entries || entries * 2 < allLines.length) {
    return [{ title: titleFrom(allLines[0] ?? text), content: text }];
  }

  const items: UpdateItem[] = [];

  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (!lines.length) continue;

    const bulletLines = lines.filter(l => BULLET.test(l));

    if (bulletLines.length >= 1 && bulletLines.length >= lines.length - 1) {
      // A list, optionally under a single heading line.
      const heading = BULLET.test(lines[0]) ? null : lines[0].trim();
      for (const line of lines) {
        if (!BULLET.test(line)) continue;
        const bullet = line.replace(BULLET, '').trim();
        if (!bullet) continue;
        items.push({
          title: titleFrom(bullet),
          content: heading ? `${heading}\n${bullet}` : bullet,
        });
      }
    } else {
      items.push({ title: titleFrom(lines[0]), content: lines.join('\n').trim() });
    }
  }

  return items;
}

/** A line that reads as an entry in a list: a bullet, a numbered line, or a dated one. */
function isListEntry(line: string): boolean {
  return BULLET.test(line) || hasDate(line);
}

/** DATE_PATTERN is global, so its lastIndex has to be cleared before every test. */
function hasDate(text: string): boolean {
  DATE_PATTERN.lastIndex = 0;
  return DATE_PATTERN.test(text);
}

function titleFrom(line: string): string {
  // The content keeps her formatting exactly; the title is what the bot matches
  // and displays, so WhatsApp's bold markers around a heading come off here.
  const clean = line
    .replace(BULLET, '')
    .replace(/^[*_~"״'׳\s]+/, '')
    .replace(/[*_~"״'׳\s]+$/, '')
    .trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

/* ------------------------------------------------------------------------ */
/* Matching new items against what is already known                          */
/* ------------------------------------------------------------------------ */

/**
 * Dates, written in the forms the unit uses. These are what CHANGE between an
 * old and a new version of the same fact, so they are removed before deciding
 * whether two items are about the same thing.
 */
const DATE_PATTERN =
  /\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?(?:\s*[-–—]\s*\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?)?|\d{4}-\d{2}-\d{2}/g;

const STOPWORDS = new Set([
  'של', 'את', 'על', 'עם', 'אל', 'או', 'גם', 'רק', 'כי', 'אם', 'זה', 'זו', 'הוא', 'היא',
  'תאריך', 'מתוך', 'לוח', 'האירועים', 'אירועים', 'מערך', 'היחש', 'לשנת',
]);

/**
 * The identity of an item: what it is about, stripped of the values that vary.
 *
 * "קק״צ 94 — 15/09/26–01/12/26" and "15/09/26–08/12/26 — קק״צ 94" are the same
 * subject with different dates; both reduce to {קקצ, 94}. Numbers that are not
 * dates are kept, because they ARE identity — קק״צ 94 is a different course
 * from קק״צ 93, and טופס 102 is not טופס 101.
 */
export function subjectTokens(text: string): string[] {
  const withoutDates = String(text ?? '').replace(DATE_PATTERN, ' ');
  const normalised = withoutDates
    .toLowerCase()
    .replace(/["'`״׳]/g, '')
    .replace(/[,.?!:;()\[\]{}/\\\-–—|*•●▪◦]/g, ' ');
  const tokens = normalised
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
    // A leading ו/ה/ב/ל on a long word is usually a prefix, not part of it.
    .map(t => (t.length > 3 && /^[והבל]/.test(t) ? t.slice(1) : t));
  return Array.from(new Set(tokens));
}

/** Overlap between two subjects, 0..1. */
export function subjectSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter(t => setB.has(t)).length;
  return shared / (a.length + b.length - shared);
}

/**
 * Two items are about the same thing when their subjects mostly coincide.
 *
 * 0.6 is chosen so that "שבוע הכנה קק״צ 94" does NOT match "קק״צ 94" (0.5 —
 * different event), while a change of dates on the same event matches fully.
 */
export const SAME_SUBJECT_THRESHOLD = 0.6;

export interface ExistingEntry {
  id: string;
  category: string;
  title: string;
  content: string;
}

export type ItemKind = 'new' | 'changed' | 'unchanged';

/** A line inside another entry that states the same fact, e.g. in a month summary. */
export interface LineMention {
  entryId: string;
  entryTitle: string;
  lineIndex: number;
  line: string;
}

export interface ProposedItem extends UpdateItem {
  number: number;
  kind: ItemKind;
  /** Existing rows describing the same subject — every copy, across categories. */
  matches: ExistingEntry[];
  /** The same fact repeated inside other entries, which must change with it. */
  mentions: LineMention[];
  similarity: number;
}

/** Whitespace- and punctuation-insensitive comparison of two texts. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) => String(s ?? '').replace(/["'`״׳]/g, '').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** Every date mentioned, normalised, as a comparable set. */
function datesIn(text: string): string[] {
  const found = String(text ?? '').match(DATE_PATTERN) ?? [];
  return found
    .map(d => d.replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/\./g, '/'))
    .sort();
}

/**
 * Whether an existing entry already says what the new item says.
 *
 * Text equality alone is not enough: the same event can be stored as
 * "קק״צ 93 / תאריך: 15/06/26–25/08/26" and sent as "15/06/26–25/08/26 — קק״צ 93".
 * Those are the same fact in a different layout, and asking the editor to
 * approve a "change" that changes nothing would train her to approve without
 * reading. When both sides carry dates, identical dates on the same subject
 * count as unchanged.
 */
function saysTheSame(existing: ExistingEntry, item: UpdateItem): boolean {
  if (sameText(existing.content, item.content)) return true;
  const oldDates = datesIn(`${existing.title}\n${existing.content}`);
  const newDates = datesIn(`${item.title}\n${item.content}`);
  if (!oldDates.length || !newDates.length) return false;
  return JSON.stringify(oldDates) === JSON.stringify(newDates);
}

/**
 * Finds the same fact stated on a line inside other entries.
 *
 * The calendar is stored twice over: one row per event and one per month
 * listing them all. Replacing an event's row while its line in the month
 * summary still shows the old dates would leave the bot contradicting itself,
 * answering differently depending on which row a question happened to reach.
 */
function findMentions(itemTokens: string[], existing: ExistingEntry[], exclude: Set<string>): LineMention[] {
  const mentions: LineMention[] = [];
  for (const entry of existing) {
    if (exclude.has(entry.id)) continue;
    const lines = entry.content.split('\n');
    lines.forEach((line, lineIndex) => {
      // Only lines that carry a date are statements of a scheduled fact; a
      // passing reference in prose is not something to rewrite.
      if (!datesIn(line).length) return;
      if (subjectSimilarity(subjectTokens(line), itemTokens) >= SAME_SUBJECT_THRESHOLD) {
        mentions.push({ entryId: entry.id, entryTitle: entry.title, lineIndex, line });
      }
    });
  }
  return mentions;
}

/**
 * Compares each new item with the existing knowledge and classifies it.
 *
 * A match collects every row with the same title, not only the best-scoring one,
 * because the same fact can be filed in more than one category (the officer
 * track is in both general and development_tracks). Replacing only one copy
 * would leave the bot giving a different answer depending on how a question
 * happened to be routed.
 */
export function proposeItems(items: UpdateItem[], existing: ExistingEntry[]): ProposedItem[] {
  const existingTokens = existing.map(e => ({ entry: e, tokens: subjectTokens(e.title) }));

  return items.map((item, index) => {
    const itemTokens = subjectTokens(item.title);

    let best: { entry: ExistingEntry; score: number } | null = null;
    for (const { entry, tokens } of existingTokens) {
      const score = subjectSimilarity(itemTokens, tokens);
      if (score >= SAME_SUBJECT_THRESHOLD && (!best || score > best.score)) best = { entry, score };
    }

    if (!best) {
      return { ...item, number: index + 1, kind: 'new' as const, matches: [], mentions: [], similarity: 0 };
    }

    const bestSubject = subjectTokens(best.entry.title).join(' ');
    const matches = existing.filter(e => subjectTokens(e.title).join(' ') === bestSubject);
    const mentions = findMentions(itemTokens, existing, new Set(matches.map(m => m.id)));

    const unchanged =
      matches.every(m => saysTheSame(m, item)) &&
      mentions.every(m => JSON.stringify(datesIn(m.line)) === JSON.stringify(datesIn(item.content)));

    return {
      ...item,
      number: index + 1,
      kind: unchanged ? ('unchanged' as const) : ('changed' as const),
      matches,
      mentions,
      similarity: best.score,
    };
  });
}

/* ------------------------------------------------------------------------ */
/* Decisions                                                                 */
/* ------------------------------------------------------------------------ */

export type ItemAction = 'add' | 'replace' | 'keep' | 'skip';

/**
 * What happens to an item if the editor accepts the defaults.
 *
 * New information is added, and a conflicting item replaces the old one —
 * the editor is the source of the newer information. An identical item does
 * nothing.
 */
export function defaultAction(kind: ItemKind): ItemAction {
  if (kind === 'new') return 'add';
  if (kind === 'changed') return 'replace';
  return 'skip';
}

/** Which actions make sense for an item. Anything else is rejected. */
export function allowedActions(kind: ItemKind): ItemAction[] {
  if (kind === 'new') return ['add', 'skip'];
  if (kind === 'changed') return ['replace', 'keep'];
  return ['skip'];
}

export interface ResolvedDecisions {
  actions: Map<number, ItemAction>;
  errors: string[];
}

/**
 * Turns the editor's reply into one action per item.
 *
 * Every item must end up with an explicit action. Defaults fill the gaps only
 * when she agreed to them — without that, unmentioned items are an error rather
 * than something quietly applied on her behalf.
 */
export function resolveDecisions(
  items: ProposedItem[],
  overrides: Array<{ item: number; action: string }>,
  acceptDefaultsForRest: boolean,
): ResolvedDecisions {
  const actions = new Map<number, ItemAction>();
  const errors: string[] = [];
  const byNumber = new Map(items.map(i => [i.number, i]));

  for (const o of overrides ?? []) {
    const item = byNumber.get(Number(o.item));
    if (!item) {
      errors.push(`אין פריט מספר ${o.item}`);
      continue;
    }
    const action = String(o.action) as ItemAction;
    if (!allowedActions(item.kind).includes(action)) {
      errors.push(`פריט ${item.number}: הפעולה "${o.action}" לא מתאימה לפריט ${kindLabel(item.kind)}`);
      continue;
    }
    actions.set(item.number, action);
  }

  const unresolved: number[] = [];
  for (const item of items) {
    if (actions.has(item.number)) continue;
    if (acceptDefaultsForRest || item.kind === 'unchanged') actions.set(item.number, defaultAction(item.kind));
    else unresolved.push(item.number);
  }
  if (unresolved.length) errors.push(`לא התקבלה החלטה לפריטים: ${unresolved.join(', ')}`);

  return { actions, errors };
}

export function kindLabel(kind: ItemKind): string {
  return kind === 'new' ? 'חדש' : kind === 'changed' ? 'שמתעדכן' : 'זהה';
}

/* ------------------------------------------------------------------------ */
/* Preview                                                                   */
/* ------------------------------------------------------------------------ */

/** WhatsApp renders very long single messages poorly; split on item boundaries. */
const PREVIEW_CHUNK_CHARS = 3500;

/**
 * The exact preview sent to the editor — built in code, not by the model, so
 * what she approves is precisely what will be written.
 */
export function renderPreview(items: ProposedItem[]): string[] {
  const actionable = items.filter(i => i.kind !== 'unchanged');
  const unchanged = items.filter(i => i.kind === 'unchanged');

  const blocks: string[] = [];
  const counts = `${items.filter(i => i.kind === 'new').length} חדשים · ${items.filter(i => i.kind === 'changed').length} מתעדכנים · ${unchanged.length} זהים`;
  blocks.push(`📥 *עדכון למאגר המידע*\n${counts}`);

  for (const item of actionable) {
    if (item.kind === 'new') {
      blocks.push(`*${item.number}. חדש*\n${item.content}\n_ברירת מחדל: להוסיף_`);
    } else {
      const old = item.matches[0];
      const copies = item.matches.length > 1 ? `${item.matches.length} עותקים` : '';
      const alsoIn = item.mentions.length
        ? `מופיע גם ב: ${Array.from(new Set(item.mentions.map(m => m.entryTitle))).join(', ')}`
        : '';
      const where = [copies, alsoIn].filter(Boolean).join(' · ');
      blocks.push(
        `*${item.number}. מתעדכן*\n` +
        `היום במאגר:\n${old.content}\n\n` +
        `המידע החדש:\n${item.content}\n` +
        (where ? `_(${where} — יתעדכנו כולם יחד)_\n` : '') +
        `_ברירת מחדל: לגרוס — החדש מחליף את הישן_`,
      );
    }
  }

  if (unchanged.length) {
    blocks.push(`✔️ ${unchanged.length} פריטים זהים למה שכבר קיים — לא ישתנו.`);
  }

  if (!actionable.length) {
    blocks.push('אין שינויים — כל המידע כבר קיים במאגר בדיוק כך.');
  } else {
    blocks.push(
      actionable.length === 1
        // Offering "2 להשאיר" when there is only item 1 reads as if something
        // is missing from the preview.
        ? 'איך להמשיך:\n' +
          '• "מאשרת" — לעדכן\n' +
          '• "בטל" — לא לשנות כלום'
        : 'איך להמשיך:\n' +
          '• "מאשרת" — הכל לפי ברירת המחדל\n' +
          '• או לפי פריטים, למשל: "2 להשאיר", "3 לא להוסיף"',
    );
  }

  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > PREVIEW_CHUNK_CHARS && current) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
