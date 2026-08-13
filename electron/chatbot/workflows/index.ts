/**
 * Workflow registry.
 *
 * Each workflow owns its intent, required fields, allowed tools, instructions
 * and completion action. Adding a capability (הרשמה לכנס, בדיקת שיבוץ, טפסים…)
 * means appending one WorkflowDefinition here — the chatbot engine, conversation
 * state, and IPC layer stay untouched.
 */
import type { ChatbotIntent, WorkflowDefinition } from '../types';

const vehicleEntry: WorkflowDefinition = {
  id: 'vehicle_entry',
  intent: 'VEHICLE_ENTRY',
  label: 'אישור כניסה לקסטינה',
  instructions: `המשתמש מבקש אישור כניסה לקסטינה.

התהליך הוא פורמט — לא שאלון:

שלב 1 — אם המשתמש עדיין לא שלח פורמט מלא:
קרא ל-getVehicleEntryFormat ושלח למשתמש את הטקסט שחוזר **בדיוק כפי שהוא**, מילה במילה.
אל תנסח מחדש, אל תוסיף שדות, אל תוריד שדות ואל תשנה סדר.
אפשר להוסיף לפני הפורמט משפט קצר אחד בלבד, למשל: "בשמחה, אנא מלא/י את הפורמט הבא ושלח/י לי אותו חזרה."
אל תשאל את המשתמש שאלות על השדות בשלב הזה — הוא ממלא את הפורמט בעצמו.

שלב 2 — כשהמשתמש שולח בחזרה פורמט מלא:
קרא ל-sendVehicleEntryRequest והעבר ב-filledForm את הטקסט המלא שהמשתמש שלח, בדיוק כפי שנשלח.
אם הכלי מחזיר שחסרים שדות — בקש מהמשתמש רק את השדות שהכלי ציין, ואז נסה שוב.
רק אחרי שהכלי מחזיר הצלחה אמור למשתמש שהבקשה הועברה.`,
  // No requiredFields: the form itself is the unit of completeness, and it is
  // validated in code by sendVehicleEntryRequest rather than field-by-field.
  tools: ['getVehicleEntryFormat', 'sendVehicleEntryRequest', 'escalateToStaff'],
};

const orderDistribution: WorkflowDefinition = {
  id: 'order_distribution',
  intent: 'ORDER_DISTRIBUTION',
  label: 'בדיקת הפצת פקודה',
  instructions: `המשתמש שואל על סטטוס הפצה של פקודה.
חובה לבדוק במאגר באמצעות searchOrders או getOrderStatus לפני שאתה עונה.
לעולם אל תנחש אם פקודה הופצה. אם הכלי מחזיר notFound — אמור בפירוש שלא מצאת מידע על הפקודה במאגר, והצע להעביר לסגל.`,
  tools: ['searchOrders', 'getOrderStatus', 'escalateToStaff'],
};

const replacementSchedule: WorkflowDefinition = {
  id: 'replacement_schedule',
  intent: 'REPLACEMENT_SCHEDULE',
  label: 'לו״ז החלפה',
  instructions: `המשתמש שואל על לו״ז החלפה (מתי נכנסים, מתי יוצאים, מתי ההחלפה הבאה).
השתמש ב-getUpcomingReplacement לשאלה "מתי ההחלפה הבאה", וב-searchReplacementSchedule לחיפוש לפי חודש או מחזור.
ענה עם התאריכים המדויקים שהוחזרו בלבד.`,
  tools: ['searchReplacementSchedule', 'getUpcomingReplacement', 'escalateToStaff'],
};

const openCall: WorkflowDefinition = {
  id: 'open_call',
  intent: 'OPEN_CALL',
  label: 'קול קורא',
  instructions: `זהה קודם מה המשתמש רוצה:

1) לראות קולות קוראים קיימים — השתמש ב-searchOpenCalls.

2) לפרסם קול קורא חדש — זה התהליך העיקרי:
   בקש מהמשתמש לשלוח את התוכן שהוא רוצה לפרסם, כפי שהוא רוצה שיפורסם.
   ברגע שהוא שולח את התוכן — קרא מיד ל-sendMessageToStaff עם kind="open_call"
   וב-details את הטקסט המלא שהמשתמש שלח, מילה במילה וללא שינוי.
   אל תערוך, אל תקצר ואל תשפר את הניסוח שלו.
   רק אחרי שהכלי מחזיר הצלחה אמור שהבקשה הועברה לפרסום.

אל תניח איזה מהשניים — אם לא ברור, שאל שאלה קצרה אחת.`,
  tools: ['searchOpenCalls', 'sendMessageToStaff', 'escalateToStaff'],
};

const developmentTracks: WorkflowDefinition = {
  id: 'development_tracks',
  intent: 'DEVELOPMENT_TRACKS',
  label: 'מסלולי פיתוח',
  instructions: `המשתמש שואל על מסלולי פיתוח.
חובה להשתמש ב-searchDevelopmentTracks. אם המשתמש ציין קהל יעד (למשל נגדים) — העבר אותו בפרמטר audience.
דווח רק על מסלולים ותנאים שהוחזרו מהמאגר. אל תמציא מסלולים או תנאי קבלה.`,
  tools: ['searchDevelopmentTracks', 'escalateToStaff'],
};

const fyiBroadcast: WorkflowDefinition = {
  id: 'fyi_broadcast',
  intent: 'FYI_BROADCAST',
  label: 'הפצת מידע - FYI',
  instructions: `הפצת מידע (FYI) — זה תהליך נפרד לגמרי מ"קול קורא".
מותר רק למספרים מורשים. ההרשאה נבדקת בכלים, לא על ידך.

שלב 1 — מבקש/ת לשלוח הפצת מידע ועדיין לא שלח/ה פורמט:
קראי ל-getFyiFormat.
• אם הוא מחזיר הצלחה — שלחי את הטקסט שחוזר **בדיוק כפי שהוא**, מילה במילה.
• אם הוא מחזיר שאין הרשאה — הסבירי בנימוס שהפצת מידע פתוחה לסגל בלבד, והציעי עזרה אחרת.
  אל תשלחי את הפורמט במקרה כזה.

שלב 2 — התקבל פורמט מלא:
קראי ל-broadcastFyi:
• filledForm — הטקסט המלא בדיוק כפי שנשלח.
• editedFields — הגרסה הערוכה שלך לכל שדה.

העריכה שלך: תיקון ניסוח, כתיב, פיסוק וסדר — כדי שההודעה תהיה ברורה ומקצועית.
**אסור** להוסיף מידע, להסיר מידע, לשנות מספרים/תאריכים/שמות או לפרש מחדש.
אם משהו לא ברור — עדיף להשאיר כפי שנכתב.

אם הכלי מחזיר שחסרים שדות — בקשי רק את מה שחסר ונסי שוב.
רק אחרי הצלחה אמרי שההודעה הופצה, וציני לאילו קבוצות.`,
  tools: ['getFyiFormat', 'broadcastFyi', 'escalateToStaff'],
};

const seniorStaff: WorkflowDefinition = {
  id: 'senior_staff',
  intent: 'SENIOR_STAFF',
  label: 'הפניה לסגל בכיר / רמ״דית',
  instructions: `המשתמשת רוצה להגיע לסגל בכיר או לרמ״דית שלה, או שהשאלה שלה מחייבת גורם אנושי.

שלב 1 — אם עדיין לא נבחרה דרגה:
קרא ל-getSeniorStaffOptions ושלח את הטקסט שחוזר **בדיוק כפי שהוא**, מילה במילה.
אל תשנה ניסוח, אל תשנה מספור ואל תקצר אפשרויות.
לפני התפריט אפשר משפט קצר אחד בלבד.

שלב 2 — כשהיא עונה (בדרך כלל מספר בין 1 ל-5):
קרא ל-escalateToSeniorStaff עם:
- rankAnswer: התשובה שלה בדיוק כפי שנכתבה
- question: השאלה או הבקשה שלה
- fullName: שמה אם ידוע
- summary: סיכום קצר של השיחה

אם הכלי מחזיר שהתשובה לא תואמת — שלח שוב את התפריט ובקש לבחור מספר.
רק אחרי שהכלי מחזיר הצלחה אמור לה שהפנייה הועברה, וציין למי.

חשוב: אם עדיין לא ברור מה השאלה שלה — שאל אותה קודם מה הנושא, ורק אז את הדרגה.`,
  tools: ['getSeniorStaffOptions', 'escalateToSeniorStaff', 'searchGeneralKnowledge'],
};

const generalQuestion: WorkflowDefinition = {
  id: 'general_question',
  intent: 'GENERAL_QUESTION',
  label: 'שאלה כללית לסגל היח״ש',
  instructions: `שאלה כללית על מערך היח״ש.

1. חפש קודם ב-searchGeneralKnowledge.
2. אם נמצאה תשובה אמינה — ענה עליה בקצרה וסיים.
3. אם לא נמצאה תשובה ודאית — אל תמציא. עבור להפניה לסגל בכיר:
   א. אמור לה: "לא מצאתי כרגע תשובה מספיק ודאית, אז אעביר את השאלה לסגל."
   ב. קרא ל-getSeniorStaffOptions ושלח את התפריט **מילה במילה**.
   ג. כשהיא בוחרת — קרא ל-escalateToSeniorStaff עם rankAnswer, question, ו-summary.
   ד. רק אחרי הצלחה אמור שהפנייה הועברה, וציין למי.`,
  tools: ['searchGeneralKnowledge', 'getSeniorStaffOptions', 'escalateToSeniorStaff'],
};

const other: WorkflowDefinition = {
  id: 'other',
  intent: 'OTHER',
  label: 'אחר',
  instructions: `הבקשה לא נכנסת לאף קטגוריה מוגדרת.
נסה להבין מה נדרש בשאלת הבהרה קצרה אחת.
אם זו שאלה על היח״ש — טפל בה כמו שאלה כללית והשתמש ב-searchGeneralKnowledge.
אם אין תשובה ודאית או שנדרש גורם אנושי — שלח את תפריט הדרגות (getSeniorStaffOptions) והעבר עם escalateToSeniorStaff.`,
  tools: ['searchGeneralKnowledge', 'getSeniorStaffOptions', 'escalateToSeniorStaff', 'sendMessageToStaff'],
};

export const WORKFLOWS: WorkflowDefinition[] = [
  vehicleEntry,
  orderDistribution,
  replacementSchedule,
  openCall,
  developmentTracks,
  generalQuestion,
  seniorStaff,
  fyiBroadcast,
  other,
];

export const WORKFLOW_BY_ID: Record<string, WorkflowDefinition> = Object.fromEntries(
  WORKFLOWS.map(w => [w.id, w]),
);

export function workflowForIntent(intent: ChatbotIntent): WorkflowDefinition | null {
  return WORKFLOWS.find(w => w.intent === intent) ?? null;
}

/**
 * Cross-cutting tools available in every workflow.
 *
 * Identifying details can be volunteered at any point in any conversation, so
 * saveContactDetails must never depend on which workflow happens to be active —
 * otherwise the bot thanks her for the details and silently fails to store them.
 */
export const ALWAYS_AVAILABLE_TOOLS = ['saveContactDetails'];

/** Tools a workflow may use, including the cross-cutting ones. */
export function toolsForWorkflow(workflow: WorkflowDefinition | null): string[] {
  const base = workflow ? workflow.tools : WORKFLOWS.flatMap(w => w.tools);
  return Array.from(new Set([...base, ...ALWAYS_AVAILABLE_TOOLS]));
}

/** Every tool any workflow can reach — used when no workflow is active yet. */
export function allWorkflowTools(): string[] {
  return toolsForWorkflow(null);
}
