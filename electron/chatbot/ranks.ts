/**
 * IDF rank recognition, so a stated rank routes to the right רמ״דית.
 *
 * The rank menu asks people to pick a number, but they very often just answer
 * with their rank — "סמ״ר", "רס״ל", "אני רס״ר". Before this existed the bot did
 * not recognise those as rank answers at all: a message reading "סמר" fell
 * through to intent detection and was classified as something unrelated
 * (a vehicle-entry request, in the case that prompted this), so the person was
 * sent a form instead of being routed to a person.
 *
 * Matching is by explicit alias, not by stripping letters. A generic Hebrew
 * normaliser that drops י/ו collapses distinct ranks onto each other, and
 * sending someone to the wrong רמ״דית is worse than not recognising the rank.
 */

/** Rank groups, in the routing sense — not the full military hierarchy. */
export type RankCategory =
  /** Below anything the rank menu covers: טוראי, רב״ט, סמל. */
  | 'below_menu'
  /** Warrant officers at the start of permanent service: סמ״ר, רס״ל. */
  | 'nco_initial'
  /** Established warrant officers: רס״ר, רס״מ, רס״ב, רנ״ג. */
  | 'nco_senior'
  /** Junior officers: סג״מ, סגן, סרן. */
  | 'officer_junior'
  /** רס״ן and above. */
  | 'officer_senior';

interface RankDefinition {
  canonical: string;
  category: RankCategory;
  /** Written forms, already punctuation-free and lowercase. */
  aliases: string[];
}

/**
 * Aliases cover the abbreviation, the spelled-out name and the feminine form.
 * Punctuation (״ " ' ׳ . - space) is removed before comparison, so "רס״ל",
 * "רס\"ל" and "רסל" all arrive here as `רסל`.
 */
const RANKS: RankDefinition[] = [
  { canonical: 'טוראי', category: 'below_menu', aliases: ['טוראי', 'טוראית', 'טורא', 'טור'] },
  { canonical: 'רב״ט', category: 'below_menu', aliases: ['רבט', 'רבטית', 'רבטוראי'] },
  { canonical: 'סמל', category: 'below_menu', aliases: ['סמל', 'סמלת'] },

  { canonical: 'סמ״ר', category: 'nco_initial', aliases: ['סמר', 'סמלראשון', 'סמלראשונה'] },
  { canonical: 'רס״ל', category: 'nco_initial', aliases: ['רסל', 'רבסמל'] },

  { canonical: 'רס״ר', category: 'nco_senior', aliases: ['רסר', 'רבסמלראשון', 'רבסמלראשונה'] },
  { canonical: 'רס״מ', category: 'nco_senior', aliases: ['רסמ', 'רסם', 'רבסמלמתקדם', 'רבסמלמתקדמת'] },
  { canonical: 'רס״ב', category: 'nco_senior', aliases: ['רסב', 'רבסמלבכיר', 'רבסמלבכירה'] },
  { canonical: 'רנ״ג', category: 'nco_senior', aliases: ['רנג', 'רבנגד', 'רבנגדת'] },

  { canonical: 'סג״ם', category: 'officer_junior', aliases: ['סגם', 'סגןמשנה'] },
  { canonical: 'סגן', category: 'officer_junior', aliases: ['סגן', 'סגנית'] },
  { canonical: 'סרן', category: 'officer_junior', aliases: ['סרן', 'סרנית'] },

  { canonical: 'רס״ן', category: 'officer_senior', aliases: ['רסן', 'רבסרן', 'רבסרנית'] },
  { canonical: 'סא״ל', category: 'officer_senior', aliases: ['סאל', 'סגןאלוף'] },
  { canonical: 'אל״ם', category: 'officer_senior', aliases: ['אלם', 'אלוףמשנה'] },
  { canonical: 'תא״ל', category: 'officer_senior', aliases: ['תאל', 'תתאלוף'] },
];

/** "נגד/ת" on its own says the family but not the seniority. */
const GENERIC_NCO = ['נגד', 'נגדת', 'נגדית'];

export interface RankMatch {
  canonical: string;
  category: RankCategory;
}

/** Punctuation-free, lowercase form used for all comparisons. */
function normalizeRankToken(s: string): string {
  return String(s ?? '')
    .replace(/[״"'`׳]/g, '')
    .replace(/[.\-–—/\\]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const BY_ALIAS = new Map<string, RankDefinition>();
for (const r of RANKS) {
  for (const a of r.aliases) BY_ALIAS.set(normalizeRankToken(a), r);
}

/**
 * Finds a rank in free text.
 *
 * Whole-string match first, so "סמ״ר" answers cleanly; then word by word, so
 * "אני רס״ל בקבע" also resolves. Returns null when nothing matches — the caller
 * must then ask rather than assume.
 */
export function classifyRank(text: unknown): RankMatch | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const whole = BY_ALIAS.get(normalizeRankToken(raw));
  if (whole) return { canonical: whole.canonical, category: whole.category };

  for (const word of raw.split(/[\s,.;:()\[\]]+/)) {
    if (!word) continue;
    const hit = BY_ALIAS.get(normalizeRankToken(word));
    if (hit) return { canonical: hit.canonical, category: hit.category };
  }
  return null;
}

/** True when the text says "נגד/ת" without saying which. */
export function mentionsGenericNco(text: unknown): boolean {
  const words = String(text ?? '').split(/[\s,.;:()\[\]]+/).map(normalizeRankToken);
  return words.some(w => GENERIC_NCO.includes(w));
}

/**
 * Which rank-menu option a category belongs to.
 *
 * `below_menu` maps to nothing: those ranks are handled by the configured
 * fallback destination instead of a menu option.
 */
export const CATEGORY_TO_OPTION: Record<Exclude<RankCategory, 'below_menu'>, number> = {
  officer_junior: 2,
  officer_senior: 3,
  nco_initial: 4,
  nco_senior: 5,
};

/** Phrases identifying an option by meaning, if its number ever changes. */
const CATEGORY_LABEL_HINTS: Record<Exclude<RankCategory, 'below_menu'>, string[]> = {
  officer_junior: ['סרןקבע', 'סרן'],
  officer_senior: ['רסן', 'ומעלה'],
  nco_initial: ['קבעראשוני'],
  nco_senior: ['מובהק'],
};

/**
 * Resolves a category to one of the configured routes.
 *
 * Prefers the option number, then falls back to matching the label, so
 * reordering the table in the UI does not silently misroute people.
 */
export function routeForCategory<T extends { option: number; label: string }>(
  category: RankCategory,
  routes: T[],
): T | null {
  if (category === 'below_menu') return null;

  const byOption = routes.find(r => r.option === CATEGORY_TO_OPTION[category]);
  const hints = CATEGORY_LABEL_HINTS[category];
  if (byOption && hints.some(h => normalizeRankToken(byOption.label).includes(h))) return byOption;

  const byLabel = routes.find(r => hints.some(h => normalizeRankToken(r.label).includes(h)));
  return byLabel ?? byOption ?? null;
}
