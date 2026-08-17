/**
 * Senior-staff escalation routing (הפניה לסגל בכיר).
 *
 * When someone asks to reach senior staff or her רמ״דית — or when the bot has
 * no reliable answer and the question clearly needs a person — she is asked
 * which rank category she belongs to, and the question is routed to the staff
 * member who handles that category.
 *
 * The table is DATA, not code: it is stored in the `settings` table and edited
 * from the UI, so names and numbers change without a release. The values below
 * are only the initial defaults.
 */

import { classifyRank, mentionsGenericNco, routeForCategory } from './ranks';

export interface SeniorStaffRoute {
  /** The number the user picks, 1-based. */
  option: number;
  /** Rank/category description shown to the user, verbatim. */
  label: string;
  /** Who receives the escalation. */
  name: string;
  /** Destination WhatsApp number, digits only. */
  phone: string;
}

export const DEFAULT_SENIOR_STAFF_ROUTING: SeniorStaffRoute[] = [
  {
    option: 1,
    label: 'אני בלבנת החובה שלי (שיבוץ השלמה/שינוי שיבוץ/פיקוד והדרכה)',
    name: 'רוני אשר',
    phone: '972532840405',
  },
  {
    option: 2,
    label: 'אני סרן קבע (שובצתי בוע״ס)',
    name: 'נוי עזרי',
    phone: '972528891059',
  },
  {
    option: 3,
    label: 'רס״ן ומעלה',
    name: 'גלי קטאש',
    phone: '972525729643',
  },
  {
    option: 4,
    label: 'נגד/ת בקבע ראשוני',
    name: 'לירז אהרון',
    phone: '972529217523',
  },
  {
    // Same destination number as option 3 — treated as the same person.
    option: 5,
    label: 'נגד/ת מובהק',
    name: 'גלי קאטש',
    phone: '972525729643',
  },
];

/**
 * The exact menu sent to the user. Built from the routing table so editing a
 * label in the UI changes what she sees — the wording is never retyped in a
 * prompt, where the model could drift from it.
 */
export function buildRankMenu(routes: SeniorStaffRoute[]): string {
  const lines = routes
    .slice()
    .sort((a, b) => a.option - b.option)
    .map(r => `${r.option}. ${r.label}`)
    .join('\n');

  return `כדי להעביר אותך לגורם הנכון, באיזו דרגה את?\nסמני אחת מהתשובות הבאות:\n\n${lines}`;
}

/**
 * Resolves the user's answer to a route.
 *
 * Accepts a bare number ("3"), a number with punctuation ("3."), or free text
 * that contains one — people reply to a numbered menu in all of those ways.
 * Returns null when the answer is not one of the offered options, so the caller
 * asks again instead of guessing a destination.
 */
export function resolveRoute(answer: unknown, routes: SeniorStaffRoute[]): SeniorStaffRoute | null {
  return resolveRankRouting(answer, routes).route;
}

/**
 * What a rank answer resolves to.
 *
 * `belowMenu` is distinct from "no match": the rank was understood and is
 * simply below everything the menu covers, which is a routable outcome (the
 * configured fallback) rather than a reason to re-ask.
 */
export interface RankRouting {
  route: SeniorStaffRoute | null;
  belowMenu: boolean;
  /** The rank that was recognised, for the message sent onward. */
  rank: string | null;
  /** True when she said "נגד/ת" without saying which — ask for the exact rank. */
  needsExactNcoRank: boolean;
}

/**
 * Resolves the user's answer to a route.
 *
 * Accepts a menu number ("3", "3.", "אני 3"), the category label, or — most
 * commonly in practice — the rank itself ("סמ״ר", "אני רס״ל"). Rank answers
 * used to fall through entirely, which is how someone answering "סמר" ended up
 * in an unrelated workflow.
 */
export function resolveRankRouting(answer: unknown, routes: SeniorStaffRoute[]): RankRouting {
  const empty: RankRouting = { route: null, belowMenu: false, rank: null, needsExactNcoRank: false };
  if (answer === null || answer === undefined) return empty;

  const text = String(answer).trim();
  if (!text) return empty;

  // A stated rank wins over a bare digit: "רס״ל" contains no digit, but an
  // answer like "אני 4 - רס״ל" should agree either way, and the rank is the
  // more specific signal.
  const rank = classifyRank(text);
  if (rank) {
    if (rank.category === 'below_menu') {
      return { route: null, belowMenu: true, rank: rank.canonical, needsExactNcoRank: false };
    }
    const routed = routeForCategory(rank.category, routes);
    if (routed) return { route: routed, belowMenu: false, rank: rank.canonical, needsExactNcoRank: false };
  }

  // "נגד/ת" alone does not say whether she is בקבע ראשוני or מובהק, and those
  // go to different people — ask instead of picking one.
  if (mentionsGenericNco(text) && !rank) {
    return { route: null, belowMenu: false, rank: null, needsExactNcoRank: true };
  }

  // A standalone number anywhere in the reply.
  const match = text.match(/(?:^|\s|[.)\-])([1-9])(?:[.)\s]|$)/) ?? text.match(/^([1-9])$/);
  if (match) {
    const picked = Number(match[1]);
    const byOption = routes.find(r => r.option === picked) ?? null;
    if (byOption) return { route: byOption, belowMenu: false, rank: rank?.canonical ?? null, needsExactNcoRank: false };
  }

  // Fall back to matching the label text if she typed the category instead.
  const normalized = normalize(text);
  const byLabel =
    routes.find(r => normalize(r.label) === normalized) ??
    routes.find(r => normalized.length >= 4 && normalize(r.label).includes(normalized)) ??
    null;

  return { route: byLabel, belowMenu: false, rank: rank?.canonical ?? null, needsExactNcoRank: false };
}

function normalize(s: string): string {
  return s
    .replace(/[״"'`׳]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[.\s/]/g, '')
    .replace(/[יו]/g, '')
    .toLowerCase();
}

/** Digits-only form; tolerates "+972 53-284-0405" style input from the UI. */
export function normalizePhone(input: string): string {
  return String(input ?? '').replace(/\D/g, '');
}
