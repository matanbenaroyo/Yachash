/**
 * Knowledge updates: splitting, matching, conflicts and decisions — run against
 * the REAL knowledge base (read-only), so the matching is tested on the rows
 * Hila's updates will actually meet.
 */
import { LIVE_DB, TMP } from './_env';
import { DatabaseSync } from 'node:sqlite';
import {
  isKnowledgeUpdate, extractUpdateBody, splitUpdateIntoItems, subjectTokens, subjectSimilarity,
  proposeItems, resolveDecisions, renderPreview, SAME_SUBJECT_THRESHOLD, type ExistingEntry,
} from '../../electron/chatbot/knowledgeUpdate';

const raw = new DatabaseSync(LIVE_DB, { readOnly: true });
const existing = raw.prepare('SELECT id, category, title, content FROM chatbot_knowledge WHERE is_active = 1').all() as unknown as ExistingEntry[];
raw.close();

let pass = 0, fail = 0;
const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const truthy = (label: string, cond: boolean, detail = '') => eq(label + (cond ? '' : `  ${detail}`), cond, true);

console.log(`(real knowledge base: ${existing.length} active rows)\n`);

console.log('=== trigger ===');
eq('"להלן מידע חדש:" detected', isKnowledgeUpdate('להלן מידע חדש:\nקק״צ 94 זז'), true);
eq('"הנה מידע חדש" detected', isKnowledgeUpdate('הנה מידע חדש - משהו'), true);
eq('ordinary question not detected', isKnowledgeUpdate('מתי יש קק"צ 94?'), false);
eq('body extracted without the trigger', extractUpdateBody('להלן מידע חדש:\nשורה'), 'שורה');

console.log('\n=== splitting keeps her words and separates list items ===');
let items = splitUpdateIntoItems(`ספטמבר 2026
* 15/09/26–08/12/26 — קק״צ 94
* 20/09/26 — כנס חדש לגמרי

נוהל חדש: מעכשיו אישורי כניסה נשלחים עד 48 שעות מראש.`);
eq('three items (two bullets + one paragraph)', items.length, 3);
eq('bullet keeps the heading as context', items[0].content, 'ספטמבר 2026\n15/09/26–08/12/26 — קק״צ 94');
eq('paragraph kept verbatim', items[2].content, 'נוהל חדש: מעכשיו אישורי כניסה נשלחים עד 48 שעות מראש.');

console.log('\n=== a policy document stays ONE item (15.09.2026 incident) ===');
// Same shape as the update that was cut into nine fragments in production:
// a bold heading, a greeting, numbered sections and two sub-bullets inside one
// of them. Content is invented; only the structure is what matters here.
const DOCUMENT = `*עדכון והנחיה – נוהל לדוגמה*

שלום לכולם,

בהתאם להחלטה, חל שינוי בנוהל לדוגמה.

1. השלב הראשון, שיבוצע ע"י הגורם המוסמך, יחליף את השלב שהיה נהוג עד כה.
בהתאם לכך, השלב הקודם מבוטל ולא יתקיים עוד.
לאחר ביצועו, כל גורם יעביר:
▪️ סעיף ראשון
▪️ סעיף שני

הגורם המרכז יבצע את התהליך בהתאם לקריטריונים הקבועים ולצרכים.
בסיום התהליך יופץ סיכום ובו הפרטים הרלוונטיים.

2. *בנוסף, החל ממועד זה נעצרת ההקצאה לדוגמה.*

המשמעות היא כי לא תאושר הקצאה לגורמים בעלי ותק של 19 חודשים ומעלה.

מצורפת מדיניות לדוגמה, אשר תהווה חלק מהתהליך.`;

items = splitUpdateIntoItems(DOCUMENT);
eq('one item, not nine', items.length, 1);
eq('her words, whole and untouched', items[0].content, DOCUMENT);
eq('titled by the heading, without the bold markers', items[0].title, 'עדכון והנחיה – נוהל לדוגמה');
truthy('the greeting is not an item of its own', !items.some(i => i.content.trim() === 'שלום לכולם,'));

console.log('\n=== the shapes on either side of the line ===');
eq('a dated list is still split per line',
  splitUpdateIntoItems('* 15/09/26 — אירוע א\n* 20/09/26 — אירוע ב').length, 2);
eq('a list under a heading is still split',
  splitUpdateIntoItems('ספטמבר 2026\n* 15/09/26 — אירוע א\n* 20/09/26 — אירוע ב').length, 2);
eq('a single dated line is one item, without the bullet marker',
  splitUpdateIntoItems('* 15/09/26–08/12/26 — קק״צ 94')[0].content, '15/09/26–08/12/26 — קק״צ 94');
eq('a short real update stays one item',
  splitUpdateIntoItems('היי\nתחילת קק״צ ב23.9').length, 1);
eq('two prose paragraphs are one item, not two',
  splitUpdateIntoItems('עדכון: הטופס מוגש מעכשיו במערכת.\n\nבנוסף, אין צורך בחתימה ידנית.').length, 1);
eq('prose that happens to mention two dates is still one item',
  splitUpdateIntoItems('שימו לב: הכנס נדחה.\nהמועד החדש הוא 15/10.\nההרשמה נסגרת ב-01/10.\nפרטים יישלחו בהמשך בהודעה נפרדת.').length, 1);

console.log('\n=== subject identity: dates vary, numbers do not ===');
eq('same event, different dates -> same subject',
  subjectTokens('קק״צ 94 — 15/09/26–01/12/26'), subjectTokens('15/09/26–08/12/26 — קק״צ 94'));
truthy('קק״צ 94 vs קק״צ 93 are different',
  subjectSimilarity(subjectTokens('קק״צ 94'), subjectTokens('קק״צ 93')) < SAME_SUBJECT_THRESHOLD);
truthy('"שבוע הכנה קק״צ 94" is not "קק״צ 94"',
  subjectSimilarity(subjectTokens('שבוע הכנה קק״צ 94'), subjectTokens('קק״צ 94')) < SAME_SUBJECT_THRESHOLD);
truthy('טופס 102 vs טופס 101 are different',
  subjectSimilarity(subjectTokens('טופס 102'), subjectTokens('טופס 101')) < SAME_SUBJECT_THRESHOLD);

console.log('\n=== against the real base: a changed date is a CONFLICT ===');
let proposed = proposeItems(splitUpdateIntoItems('* 15/09/26–08/12/26 — קק״צ 94'), existing);
eq('classified as changed', proposed[0].kind, 'changed');
truthy('matched the existing קק״צ 94 row', proposed[0].matches.some(m => m.title.startsWith('קק״צ 94')),
  JSON.stringify(proposed[0].matches.map(m => m.title)));
truthy('did NOT match קק״צ 93 or 95', proposed[0].matches.every(m => !/קק״צ 9[35]/.test(m.title)),
  JSON.stringify(proposed[0].matches.map(m => m.title)));
truthy('did NOT match "שבוע הכנה קק״צ 94"', proposed[0].matches.every(m => !m.title.includes('שבוע הכנה')));
truthy('found it inside the September month summary too',
  proposed[0].mentions.some(m => m.entryTitle.includes('ספטמבר')), JSON.stringify(proposed[0].mentions.map(m => m.entryTitle)));

console.log('\n=== against the real base: the same dates in a new layout are UNCHANGED ===');
proposed = proposeItems(splitUpdateIntoItems('* 15/06/26–25/08/26 — קק״צ 93'), existing);
eq('not flagged as a change', proposed[0].kind, 'unchanged');

console.log('\n=== against the real base: a genuinely new fact is NEW ===');
proposed = proposeItems(splitUpdateIntoItems('* 03/01/27 — כנס פתיחת שנה לדוגמה ייחודי'), existing);
eq('classified as new', proposed[0].kind, 'new');
eq('no matches', proposed[0].matches.length, 0);

console.log('\n=== duplicated across categories: every copy is matched ===');
proposed = proposeItems([{ title: 'מתאם קצונה', content: 'טקסט מעודכן על מתאם קצונה' }], existing);
eq('changed', proposed[0].kind, 'changed');
truthy('both copies (general + development_tracks) matched',
  new Set(proposed[0].matches.map(m => m.category)).size >= 2, JSON.stringify(proposed[0].matches.map(m => m.category)));

console.log('\n=== decisions ===');
const sample = proposeItems(splitUpdateIntoItems(
  '* 15/09/26–08/12/26 — קק״צ 94\n* 03/01/27 — כנס פתיחת שנה לדוגמה ייחודי\n* 15/06/26–25/08/26 — קק״צ 93'), existing);
eq('kinds: changed, new, unchanged', sample.map(i => i.kind), ['changed', 'new', 'unchanged']);

let d = resolveDecisions(sample, [], true);
eq('"approve all": replace, add, skip', [1, 2, 3].map(n => d.actions.get(n)), ['replace', 'add', 'skip']);
eq('no errors', d.errors, []);

d = resolveDecisions(sample, [{ item: 1, action: 'keep' }], true);
eq('"1 to keep", rest default', [1, 2, 3].map(n => d.actions.get(n)), ['keep', 'add', 'skip']);

d = resolveDecisions(sample, [{ item: 1, action: 'keep' }], false);
eq('without agreeing to defaults, item 2 is left unresolved — not silently added', d.errors, ['לא התקבלה החלטה לפריטים: 2']);

d = resolveDecisions(sample, [{ item: 2, action: 'replace' }], true);
truthy('"replace" on a NEW item is rejected', d.errors.some(e => e.startsWith('פריט 2')), JSON.stringify(d.errors));

d = resolveDecisions(sample, [{ item: 9, action: 'keep' }], true);
truthy('unknown item number rejected', d.errors.some(e => e.includes('9')), JSON.stringify(d.errors));

console.log('\n=== preview ===');
const preview = renderPreview(sample).join('\n\n');
truthy('shows the counts', preview.includes('1 חדשים') && preview.includes('1 מתעדכנים') && preview.includes('1 זהים'));
truthy('shows old AND new for the conflict', preview.includes('היום במאגר') && preview.includes('08/12/26'));
truthy('says the summary will change with it', preview.includes('ספטמבר'));
truthy('does not list the unchanged item in full', !preview.includes('15/06/26–25/08/26'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
