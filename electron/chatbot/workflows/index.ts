/**
 * Workflow registry.
 *
 * Each workflow owns its intent, required fields, allowed tools, instructions
 * and completion action. Adding a capability (הרשמה לכנס, בדיקת שיבוץ, טפסים…)
 * means appending one WorkflowDefinition here — the chatbot engine, conversation
 * state, and IPC layer stay untouched.
 */
import type { ChatbotIntent, WorkflowDefinition } from '../types';
import { submitVehicleEntry } from '../tools';

const vehicleEntry: WorkflowDefinition = {
  id: 'vehicle_entry',
  intent: 'VEHICLE_ENTRY',
  label: 'אישור כניסת רכב לקסטינה',
  instructions: `המשתמש מבקש אישור כניסת רכב לקסטינה.
אסוף בשיחה טבעית רק את הפרטים שעדיין חסרים. אל תשאל שוב על מה שכבר נמסר.
שאל שאלה אחת או שתיים בכל הודעה — לא שאלון שלם.
כשכל השדות הנדרשים קיימים, קרא ל-sendVehicleEntryRequest ורק אחרי שהכלי מחזיר הצלחה אמור למשתמש שהבקשה נשלחה.`,
  requiredFields: [
    { key: 'fullName', label: 'שם מלא' },
    { key: 'vehicleNumber', label: 'מספר רכב' },
    { key: 'date', label: 'תאריך כניסה' },
    { key: 'time', label: 'שעת כניסה' },
    { key: 'unit', label: 'יחידה / מסגרת' },
    { key: 'reason', label: 'סיבת כניסה' },
  ],
  tools: ['sendVehicleEntryRequest', 'escalateToStaff'],
  complete: async (data, ctx) => {
    const result = await submitVehicleEntry(data, ctx);
    if (result.ok) {
      return {
        ok: true,
        message:
          `הבקשה נשלחה לסגל ✅\n\n` +
          `שם: ${data.fullName}\n` +
          `מספר רכב: ${data.vehicleNumber}\n` +
          `תאריך: ${data.date}\n` +
          `שעה: ${data.time}\n` +
          `יחידה: ${data.unit ?? '—'}\n` +
          `סיבת כניסה: ${data.reason ?? '—'}\n\n` +
          `נעדכן אותך כשיהיה אישור.`,
      };
    }
    return { ok: false, message: `לא הצלחתי לשלוח את הבקשה כרגע. ${result.error ?? ''}`.trim() };
  },
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
2) לפרסם קול קורא חדש — אסוף בשיחה טבעית: נושא, תיאור, קהל יעד ותאריך אחרון להגשה, ואז קרא ל-sendMessageToStaff עם kind="open_call".
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

const generalQuestion: WorkflowDefinition = {
  id: 'general_question',
  intent: 'GENERAL_QUESTION',
  label: 'שאלה כללית לסגל היח״ש',
  instructions: `שאלה כללית על מערך היח״ש.
1. חפש קודם ב-searchGeneralKnowledge.
2. אם נמצאה תשובה אמינה — ענה עליה בקצרה.
3. אם לא — אל תמציא. קרא ל-escalateToStaff עם השאלה וסיכום קצר, ואז אמור למשתמש:
"לא מצאתי כרגע תשובה מספיק ודאית, אז העברתי את השאלה לסגל היח״ש לבדיקה."`,
  tools: ['searchGeneralKnowledge', 'escalateToStaff'],
};

const other: WorkflowDefinition = {
  id: 'other',
  intent: 'OTHER',
  label: 'אחר',
  instructions: `הבקשה לא נכנסת לאף קטגוריה מוגדרת.
נסה להבין מה נדרש בשאלת הבהרה קצרה אחת. אם זו שאלה על היח״ש — טפל בה כמו שאלה כללית והשתמש ב-searchGeneralKnowledge, ואם אין תשובה העבר לסגל.`,
  tools: ['searchGeneralKnowledge', 'escalateToStaff', 'sendMessageToStaff'],
};

export const WORKFLOWS: WorkflowDefinition[] = [
  vehicleEntry,
  orderDistribution,
  replacementSchedule,
  openCall,
  developmentTracks,
  generalQuestion,
  other,
];

export const WORKFLOW_BY_ID: Record<string, WorkflowDefinition> = Object.fromEntries(
  WORKFLOWS.map(w => [w.id, w]),
);

export function workflowForIntent(intent: ChatbotIntent): WorkflowDefinition | null {
  return WORKFLOWS.find(w => w.intent === intent) ?? null;
}

/** Every tool any workflow can reach — used when no workflow is active yet. */
export function allWorkflowTools(): string[] {
  return Array.from(new Set(WORKFLOWS.flatMap(w => w.tools)));
}
