/**
 * Tool registry — the boundary between AI reasoning and business logic.
 *
 * The model decides *which* tool to call; this code performs the operation and
 * reports what actually happened. The model is never allowed to conclude that a
 * send/save succeeded — only a tool result can say so.
 */
import { randomUUID } from 'crypto';
import type { ChatbotTool, ToolResult, WorkflowContext } from '../types';
import { KnowledgeService } from '../knowledge/KnowledgeService';
import { resolveStaffPhone } from '../config';

function knowledge(ctx: WorkflowContext) {
  return new KnowledgeService(ctx.db);
}

/** Formats knowledge rows for the model, keeping metadata visible. */
function present(entries: ReturnType<KnowledgeService['search']>) {
  return entries.map(e => ({
    title: e.title,
    content: e.content,
    ...e.metadata,
  }));
}

const searchGeneralKnowledge: ChatbotTool = {
  name: 'searchGeneralKnowledge',
  description:
    'Search the general מערך היח״ש knowledge base (FAQs, procedures, contacts, instructions, links). ' +
    'Use for any general question about the unit. Returns notFound when nothing relevant exists — ' +
    'in that case do not invent an answer; escalate to staff instead.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The user question, in Hebrew' } },
    required: ['query'],
  },
  execute: (input, ctx) => {
    const results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'general' });
    return results.length
      ? { ok: true, data: present(results) }
      : { ok: true, notFound: true, error: 'לא נמצא מידע במאגר הכללי' };
  },
};

const searchOrders: ChatbotTool = {
  name: 'searchOrders',
  description:
    'Search the orders/directives (פקודות) data source by name, month or keyword. ' +
    'Returns each matching order with its distribution status. NEVER guess whether an order was distributed.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Order name, month, or keyword' } },
    required: ['query'],
  },
  execute: (input, ctx) => {
    const results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'orders' });
    return results.length
      ? { ok: true, data: present(results) }
      : { ok: true, notFound: true, error: 'לא נמצאה פקודה מתאימה במאגר' };
  },
};

const getOrderStatus: ChatbotTool = {
  name: 'getOrderStatus',
  description:
    'Get the distribution status of one specific order by its exact name. ' +
    'Returns notFound if the order is not in the data source — say so plainly rather than assuming.',
  input_schema: {
    type: 'object',
    properties: { orderName: { type: 'string', description: 'Exact order name' } },
    required: ['orderName'],
  },
  execute: (input, ctx) => {
    const results = knowledge(ctx).search({ query: String(input.orderName ?? ''), category: 'orders', limit: 1 });
    if (!results.length) return { ok: true, notFound: true, error: 'הפקודה לא נמצאה במאגר' };
    const order = results[0];
    return {
      ok: true,
      data: {
        title: order.title,
        status: order.metadata?.status ?? 'לא ידוע',
        distributedAt: order.metadata?.distributed_at ?? null,
        details: order.content,
      },
    };
  },
};

const searchReplacementSchedule: ChatbotTool = {
  name: 'searchReplacementSchedule',
  description:
    'Search the replacement schedule (לו״ז החלפה) — entry/exit dates for replacement cycles. ' +
    'Pass an empty query to list upcoming replacements.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Month, cycle name, or empty for upcoming' } },
    required: [],
  },
  execute: (input, ctx) => {
    const results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'replacements' });
    return results.length
      ? { ok: true, data: present(results) }
      : { ok: true, notFound: true, error: 'לא נמצא לו״ז החלפה במאגר' };
  },
};

const getUpcomingReplacement: ChatbotTool = {
  name: 'getUpcomingReplacement',
  description: 'Get the next upcoming replacement cycle relative to today. Use for "מתי ההחלפה הבאה?".',
  input_schema: { type: 'object', properties: {}, required: [] },
  execute: (_input, ctx) => {
    const all = knowledge(ctx).list('replacements');
    const today = ctx.now.toISOString().slice(0, 10);
    const upcoming = all
      .filter(e => typeof e.metadata?.entry_date === 'string' && (e.metadata.entry_date as string) >= today)
      .sort((a, b) => String(a.metadata.entry_date).localeCompare(String(b.metadata.entry_date)));
    return upcoming.length
      ? { ok: true, data: present([upcoming[0]]) }
      : { ok: true, notFound: true, error: 'לא נמצאה החלפה עתידית במאגר' };
  },
};

const searchDevelopmentTracks: ChatbotTool = {
  name: 'searchDevelopmentTracks',
  description:
    'Search unit development tracks (מסלולי פיתוח). Filter by audience (e.g. נגדים, קצינים) when the user mentions one. ' +
    'Only report tracks returned here — never invent a track or its conditions.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Track name or keyword; empty lists all' },
      audience: { type: 'string', description: 'Target audience if the user specified one' },
    },
    required: [],
  },
  execute: (input, ctx) => {
    const filters = input.audience ? { audience: String(input.audience) } : undefined;
    let results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'development_tracks', filters, limit: 10 });
    // An audience filter that matches nothing shouldn't look like "no tracks exist".
    if (!results.length && filters) {
      results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'development_tracks', limit: 10 });
    }
    return results.length
      ? { ok: true, data: present(results) }
      : { ok: true, notFound: true, error: 'לא נמצאו מסלולי פיתוח במאגר' };
  },
};

const searchOpenCalls: ChatbotTool = {
  name: 'searchOpenCalls',
  description: 'Search existing "קול קורא" publications. Pass an empty query to list currently open ones.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Keyword, or empty for all open calls' } },
    required: [],
  },
  execute: (input, ctx) => {
    const results = knowledge(ctx).search({ query: String(input.query ?? ''), category: 'open_calls' });
    return results.length
      ? { ok: true, data: present(results) }
      : { ok: true, notFound: true, error: 'לא נמצא קול קורא פתוח במאגר' };
  },
};

const sendVehicleEntryRequest: ChatbotTool = {
  name: 'sendVehicleEntryRequest',
  description:
    'Submit a completed vehicle-entry authorization request to the designated staff member over WhatsApp. ' +
    'Only call this once every required field is known. Returns ok:false if it could not be delivered.',
  input_schema: {
    type: 'object',
    properties: {
      fullName: { type: 'string' },
      vehicleNumber: { type: 'string' },
      date: { type: 'string', description: 'Resolved date, yyyy-mm-dd' },
      time: { type: 'string', description: 'HH:MM' },
      unit: { type: 'string', description: 'יחידה / מסגרת' },
      reason: { type: 'string', description: 'סיבת כניסה' },
    },
    required: ['fullName', 'vehicleNumber', 'date', 'time'],
  },
  execute: async (input, ctx) => submitVehicleEntry(input, ctx),
};

const escalateToStaff: ChatbotTool = {
  name: 'escalateToStaff',
  description:
    'Forward a question the knowledge base cannot answer to the מערך היח״ש staff WhatsApp number. ' +
    'Call this INSTEAD of guessing whenever you lack a reliable answer.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: "The user's question, verbatim" },
      summary: { type: 'string', description: 'Short Hebrew summary of the conversation so far' },
    },
    required: ['question'],
  },
  execute: async (input, ctx) => {
    const to = resolveStaffPhone(ctx.config, 'general');
    const senderName = (ctx.conversation.collectedData?.fullName as string) || 'לא ידוע';
    const body =
      `שאלה חדשה מהבוט 🤖\n` +
      `שם: ${senderName}\n` +
      `טלפון: ${ctx.phoneNumber}\n\n` +
      `שאלה:\n${input.question}\n\n` +
      `סיכום השיחה:\n${input.summary || '—'}`;

    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO chatbot_escalations (id, conversation_id, phone_number, question, summary, staff_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, ctx.conversation.id, ctx.phoneNumber, String(input.question ?? ''), String(input.summary ?? ''), to, to ? 'pending' : 'unconfigured');

    if (!to) {
      // Recorded for staff review even though delivery is impossible.
      return { ok: false, error: 'לא הוגדר מספר סגל להעברת שאלות. הפנייה נשמרה במערכת.' };
    }

    try {
      await ctx.sendWhatsApp(to, body);
      ctx.db.prepare(`UPDATE chatbot_escalations SET status = 'sent' WHERE id = ?`).run(id);
      ctx.db.prepare(`UPDATE chatbot_conversations SET status = 'escalated' WHERE id = ?`).run(ctx.conversation.id);
      return { ok: true, data: { deliveredTo: to } };
    } catch (e: any) {
      ctx.db.prepare(`UPDATE chatbot_escalations SET status = 'failed', error = ? WHERE id = ?`).run(String(e?.message ?? e), id);
      return { ok: false, error: `העברת השאלה לסגל נכשלה: ${e?.message ?? e}` };
    }
  },
};

const sendMessageToStaff: ChatbotTool = {
  name: 'sendMessageToStaff',
  description:
    'Forward a request to a staff member — used for "קול קורא" publication requests and similar submissions.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['open_call', 'general'], description: 'Which staff destination' },
      title: { type: 'string' },
      details: { type: 'string' },
    },
    required: ['kind', 'details'],
  },
  execute: async (input, ctx) => {
    const kind = input.kind === 'open_call' ? 'open_call' : 'general';
    const to = resolveStaffPhone(ctx.config, kind as any);
    if (!to) return { ok: false, error: 'לא הוגדר מספר סגל ליעד הזה.' };

    const body =
      `פנייה חדשה מהבוט 🤖\n` +
      `סוג: ${kind === 'open_call' ? 'בקשה לפרסום קול קורא' : 'פנייה כללית'}\n` +
      `טלפון: ${ctx.phoneNumber}\n` +
      (input.title ? `נושא: ${input.title}\n` : '') +
      `\nפרטים:\n${input.details}`;

    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO chatbot_requests (id, conversation_id, phone_number, type, payload, staff_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(id, ctx.conversation.id, ctx.phoneNumber, kind === 'open_call' ? 'open_call' : 'general', JSON.stringify(input), to);

    try {
      await ctx.sendWhatsApp(to, body);
      ctx.db.prepare(`UPDATE chatbot_requests SET status = 'sent' WHERE id = ?`).run(id);
      return { ok: true, data: { deliveredTo: to } };
    } catch (e: any) {
      ctx.db.prepare(`UPDATE chatbot_requests SET status = 'failed', error = ? WHERE id = ?`).run(String(e?.message ?? e), id);
      return { ok: false, error: `שליחה לסגל נכשלה: ${e?.message ?? e}` };
    }
  },
};

/** Shared by the tool and by the vehicle-entry workflow's completion step. */
export async function submitVehicleEntry(
  input: Record<string, any>,
  ctx: WorkflowContext,
): Promise<ToolResult> {
  const to = resolveStaffPhone(ctx.config, 'vehicle');
  const body =
    `בקשת אישור כניסת רכב 🚗\n` +
    `שם: ${input.fullName ?? '—'}\n` +
    `טלפון: ${ctx.phoneNumber}\n` +
    `מספר רכב: ${input.vehicleNumber ?? '—'}\n` +
    `תאריך: ${input.date ?? '—'}\n` +
    `שעה: ${input.time ?? '—'}\n` +
    `יחידה: ${input.unit ?? '—'}\n` +
    `סיבת כניסה: ${input.reason ?? '—'}`;

  const id = randomUUID();
  ctx.db
    .prepare(
      `INSERT INTO chatbot_requests (id, conversation_id, phone_number, type, payload, staff_phone, status)
       VALUES (?, ?, ?, 'vehicle_entry', ?, ?, ?)`,
    )
    .run(id, ctx.conversation.id, ctx.phoneNumber, JSON.stringify(input), to, to ? 'pending' : 'unconfigured');

  if (!to) {
    return { ok: false, error: 'לא הוגדר מספר סגל לאישורי רכב. הבקשה נשמרה במערכת אך לא נשלחה.' };
  }

  try {
    await ctx.sendWhatsApp(to, body);
    ctx.db.prepare(`UPDATE chatbot_requests SET status = 'sent' WHERE id = ?`).run(id);
    return { ok: true, data: { deliveredTo: to, requestId: id } };
  } catch (e: any) {
    ctx.db.prepare(`UPDATE chatbot_requests SET status = 'failed', error = ? WHERE id = ?`).run(String(e?.message ?? e), id);
    return { ok: false, error: `שליחת הבקשה נכשלה: ${e?.message ?? e}` };
  }
}

export const TOOLS: ChatbotTool[] = [
  searchGeneralKnowledge,
  searchOrders,
  getOrderStatus,
  searchReplacementSchedule,
  getUpcomingReplacement,
  searchDevelopmentTracks,
  searchOpenCalls,
  sendVehicleEntryRequest,
  sendMessageToStaff,
  escalateToStaff,
];

export const TOOL_MAP: Record<string, ChatbotTool> = Object.fromEntries(TOOLS.map(t => [t.name, t]));

/** Anthropic tool definitions for the subset a workflow is allowed to use. */
export function toolDefinitionsFor(names: string[]) {
  return names
    .map(n => TOOL_MAP[n])
    .filter(Boolean)
    .map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
