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
import {
  VEHICLE_ENTRY_FORMAT,
  parseVehicleEntryForm,
  renderVehicleEntryForm,
} from '../workflows/vehicleEntryFormat';
import { buildRankMenu, resolveRankRouting } from '../seniorStaff';
import { toLocalIsraeliPhone } from '../phone';
import {
  FYI_FORMAT,
  findSender,
  parseFyiForm,
  renderDigestEntry,
} from '../fyi';

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
    const { results, fromGeneral } = searchWithGeneralFallback(ctx, String(input.query ?? ''), 'orders');
    return results.length
      ? { ok: true, data: present(results), fromGeneralKnowledge: fromGeneral || undefined }
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

/**
 * Searches a category, then the general base if that category has nothing.
 *
 * Category scoping was absolute, so a fact was findable only if it happened to
 * be filed under the category the intent classifier picked. "מתי יש קק״צ 93"
 * classifies as a schedule question and searched only `replacements`; the event
 * was in `general`, so the bot reported that it had no such information while
 * the row sat one category away. The unit's material does not divide cleanly
 * into five buckets, and the phrasing of a question should not decide whether
 * an answer exists.
 *
 * The fallback is flagged in the result so the model can see the answer came
 * from general knowledge rather than from that specific register.
 */
function searchWithGeneralFallback(
  ctx: WorkflowContext,
  query: string,
  category: 'replacements' | 'orders' | 'development_tracks' | 'open_calls',
  opts: { filters?: Record<string, string>; limit?: number } = {},
) {
  const svc = knowledge(ctx);
  const primary = svc.search({ query, category, ...opts });
  if (primary.length) return { results: primary, fromGeneral: false };

  const general = svc.search({ query, category: 'general', ...opts });
  return { results: general, fromGeneral: general.length > 0 };
}

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
    const { results, fromGeneral } = searchWithGeneralFallback(ctx, String(input.query ?? ''), 'replacements');
    return results.length
      ? { ok: true, data: present(results), fromGeneralKnowledge: fromGeneral || undefined }
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
    let fromGeneral = false;
    if (!results.length) {
      const fallback = searchWithGeneralFallback(ctx, String(input.query ?? ''), 'development_tracks', { limit: 10 });
      results = fallback.results;
      fromGeneral = fallback.fromGeneral;
    }
    return results.length
      ? { ok: true, data: present(results), fromGeneralKnowledge: fromGeneral || undefined }
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
    const { results, fromGeneral } = searchWithGeneralFallback(ctx, String(input.query ?? ''), 'open_calls');
    return results.length
      ? { ok: true, data: present(results), fromGeneralKnowledge: fromGeneral || undefined }
      : { ok: true, notFound: true, error: 'לא נמצא קול קורא פתוח במאגר' };
  },
};

const getVehicleEntryFormat: ChatbotTool = {
  name: 'getVehicleEntryFormat',
  description:
    'Returns the official vehicle-entry form (פורמט אישור כניסה) that the user must fill in. ' +
    'Call this as soon as someone asks for entry authorization to קסטינה, and send the returned ' +
    'text to the user EXACTLY as-is — do not reword it, reorder it, or add/remove fields.',
  input_schema: { type: 'object', properties: {}, required: [] },
  execute: () => ({ ok: true, data: { format: VEHICLE_ENTRY_FORMAT } }),
};

const sendVehicleEntryRequest: ChatbotTool = {
  name: 'sendVehicleEntryRequest',
  description:
    'Forwards a FILLED vehicle-entry form to the designated staff member over WhatsApp. ' +
    'Pass the full text the user sent, verbatim, as filledForm. The form is validated here: if ' +
    'mandatory fields are blank this returns ok:false listing them, and nothing is sent — in that ' +
    'case ask the user only for the fields named in the response.',
  input_schema: {
    type: 'object',
    properties: {
      filledForm: {
        type: 'string',
        description: "The complete filled form exactly as the user sent it",
      },
    },
    required: ['filledForm'],
  },
  execute: async (input, ctx) => submitVehicleEntry(input, ctx),
};

const saveContactDetails: ChatbotTool = {
  name: 'saveContactDetails',
  description:
    'Stores the details of the person you are talking to (name, personal number, rank) so they are ' +
    'never asked again. Call this as soon as she gives them. Partial is fine — pass what you have.',
  input_schema: {
    type: 'object',
    properties: {
      fullName: { type: 'string', description: 'שם מלא' },
      personalNumber: { type: 'string', description: 'מספר אישי' },
      rank: { type: 'string', description: 'דרגה' },
    },
    required: [],
  },
  execute: (input, ctx) => {
    const name = String(input.fullName ?? '').trim();
    const personal = String(input.personalNumber ?? '').trim();
    const rank = String(input.rank ?? '').trim();
    if (!name && !personal && !rank) return { ok: false, error: 'לא התקבלו פרטים לשמירה' };

    // COALESCE(NULLIF(...)) keeps an existing value when this turn supplied a
    // blank one, so a partial update never erases what we already knew.
    ctx.db
      .prepare(
        `INSERT INTO chatbot_known_contacts (phone_number, full_name, personal_number, rank)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(phone_number) DO UPDATE SET
           full_name       = COALESCE(NULLIF(excluded.full_name, ''), chatbot_known_contacts.full_name),
           personal_number = COALESCE(NULLIF(excluded.personal_number, ''), chatbot_known_contacts.personal_number),
           rank            = COALESCE(NULLIF(excluded.rank, ''), chatbot_known_contacts.rank),
           updated_at      = CURRENT_TIMESTAMP`,
      )
      .run(ctx.phoneNumber, name, personal, rank);

    return { ok: true, data: { saved: { fullName: name, personalNumber: personal, rank } } };
  },
};

const getFyiFormat: ChatbotTool = {
  name: 'getFyiFormat',
  description:
    'Returns the blank "פורמט הפצת מידע - FYI" form. Only authorized senders may use it — this tool ' +
    'checks that and returns ok:false for anyone else. Send the returned text EXACTLY as-is.',
  input_schema: { type: 'object', properties: {}, required: [] },
  execute: (_input, ctx) => {
    const sender = findSender(ctx.phoneNumber, ctx.config.fyiSenders);
    if (!sender) {
      return {
        ok: false,
        error: 'המספר הזה אינו מורשה לשלוח הפצת מידע. אל תשלח את הפורמט, והסבר בנימוס שההרשאה שמורה לסגל בלבד.',
      };
    }
    return { ok: true, data: { format: FYI_FORMAT, senderName: sender.name, senderRole: sender.role } };
  },
};

const broadcastFyi: ChatbotTool = {
  name: 'broadcastFyi',
  description:
    'Queues a filled FYI form for the next daily digest to the unit WhatsApp groups. It is NOT sent ' +
    'immediately — everything received is accumulated and delivered as one consolidated message once ' +
    'every 24 hours. Pass the sender\'s message verbatim as filledForm, and your lightly edited version ' +
    'of each field in editedFields (fix wording, spelling and formatting only — never add, remove or ' +
    'reinterpret information). Authorization and completeness are enforced here: an unauthorized sender ' +
    'or a form missing mandatory fields is rejected and nothing is queued.',
  input_schema: {
    type: 'object',
    properties: {
      filledForm: { type: 'string', description: 'The form exactly as the sender wrote it' },
      editedFields: {
        type: 'object',
        description: 'Lightly cleaned-up values; omit a field to use the original',
        properties: {
          'נושא ההודעה': { type: 'string' },
          'אוכלוסיה': { type: 'string' },
          'דגשים': { type: 'string' },
          'תג״ב': { type: 'string' },
        },
      },
    },
    required: ['filledForm'],
  },
  execute: async (input, ctx) => {
    // 1. Authorization — code-side, never a prompt decision.
    const sender = findSender(ctx.phoneNumber, ctx.config.fyiSenders);
    if (!sender) {
      return { ok: false, error: 'המספר הזה אינו מורשה לשלוח הפצת מידע. לא נשלח דבר.' };
    }

    // 2. Completeness — also code-side.
    const parsed = parseFyiForm(String(input.filledForm ?? ''));
    if (!parsed.complete) {
      return {
        ok: false,
        error: `הפורמט לא מלא. חסר: ${parsed.missing.join(', ')}. בקשי מהשולח/ת רק את מה שחסר.`,
        data: { missingFields: parsed.missing },
      };
    }

    // 3. Merge the model's edits over the parsed original. Only known fields are
    //    taken, so the model cannot introduce a field that was never sent.
    const edited: Record<string, string> = { ...parsed.values };
    const proposals = (input.editedFields ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(proposals)) {
      if (typeof v === 'string' && v.trim() && parsed.values[k] !== undefined) edited[k] = v.trim();
    }

    const groups = ctx.config.fyiGroups.filter(g => g.chatId);
    if (!groups.length) return { ok: false, error: 'לא הוגדרו קבוצות להפצה. ההודעה לא נקלטה.' };

    // 4. Queue it. Nothing goes to the groups here.
    //
    // FYI messages are accumulated and delivered as ONE consolidated digest per
    // 24 hours (FyiDigestScheduler), so the groups get a single message a day
    // rather than one per submission. The stored text is the digest entry —
    // which drops the "הפצת מידע - FYI" form title and carries the contact and
    // their number instead.
    const entry = renderDigestEntry(edited, sender);
    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO chatbot_fyi_messages
           (id, sender_phone, sender_name, sender_role, subject, audience, highlights, tagav, raw_text, broadcast_text, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
      )
      .run(
        id, sender.phone, sender.name, sender.role,
        edited['נושא ההודעה'] ?? '', edited['אוכלוסיה'] ?? '',
        edited['דגשים'] ?? '', edited['תג״ב'] ?? '',
        String(input.filledForm ?? ''), entry,
      );

    const pending = ctx.db
      .prepare(`SELECT COUNT(*) n FROM chatbot_fyi_messages WHERE status = 'queued' AND digest_sent_at IS NULL`)
      .get() as { n: number };

    return {
      ok: true,
      data: {
        queued: true,
        digestTime: ctx.config.fyiDigestTime || '16:00',
        groups: groups.map(g => g.label || g.chatId),
        pendingCount: pending?.n ?? 1,
        note:
          'ההודעה נקלטה ותופץ בריכוז היומי — לא נשלחה עכשיו. אמרי לה את זה במפורש, ' +
          'וציני לאיזו שעה ולאילו קבוצות.',
      },
    };
  },
};

const getSeniorStaffOptions: ChatbotTool = {
  name: 'getSeniorStaffOptions',
  description:
    'Returns the rank menu to show someone who needs to reach senior staff or her רמ״דית. ' +
    'Send the returned text to the user EXACTLY as-is — the options and their numbering must not ' +
    'be reworded, reordered or abbreviated. Call this before escalateToSeniorStaff.',
  input_schema: { type: 'object', properties: {}, required: [] },
  execute: (_input, ctx) => ({
    ok: true,
    data: { menu: buildRankMenu(ctx.config.seniorStaffRouting) },
  }),
};

/** A resolved escalation destination, or the reason one could not be resolved. */
type RankDestination =
  | { ok: true; phone: string; name: string; category: string; rank: string | null }
  | { ok: false; result: ToolResult };

/**
 * Resolves who an escalation should go to, from whatever the user said about
 * her rank.
 *
 * Every path that forwards a person's question runs through here, so "check the
 * rank before forwarding" is enforced in code rather than trusted to the model.
 * Without it, every unanswerable question went to the single general staff
 * number — which is why one person was receiving nearly all of them.
 */
function resolveRankDestination(rankAnswer: unknown, ctx: WorkflowContext): RankDestination {
  const routes = ctx.config.seniorStaffRouting;
  const routing = resolveRankRouting(rankAnswer, routes);

  if (routing.needsExactNcoRank) {
    return {
      ok: false,
      result: {
        ok: false,
        error:
          'לא צוינה הדרגה המדויקת. שאלי מה הדרגה בדיוק (סמ״ר / רס״ל / רס״ר / רס״מ / רס״ב / רנ״ג) ואז נסי שוב.',
      },
    };
  }

  // A rank below everything the menu covers still has a destination — the
  // general staff contact — so this is a routable answer, not a failed one.
  if (routing.belowMenu) {
    const fallback = resolveStaffPhone(ctx.config, 'general');
    if (!fallback) {
      return { ok: false, result: { ok: false, error: 'לא הוגדר מספר סגל לפניות מדרגות זוטרות. יש להשלים בהגדרות.' } };
    }
    return {
      ok: true,
      phone: fallback,
      name: 'סגל היח״ש',
      category: `דרגה מתחת לקטגוריות התפריט${routing.rank ? ` (${routing.rank})` : ''}`,
      rank: routing.rank,
    };
  }

  if (routing.route) {
    if (!routing.route.phone) {
      return { ok: false, result: { ok: false, error: `לא מוגדר מספר טלפון עבור "${routing.route.label}". יש להשלים בהגדרות.` } };
    }
    return {
      ok: true,
      phone: routing.route.phone,
      name: routing.route.name,
      category: routing.route.label,
      rank: routing.rank,
    };
  }

  return {
    ok: false,
    result: {
      ok: false,
      error: 'צריך לדעת את הדרגה לפני העברת הפנייה. שלחי את התפריט ובקשי לבחור מספר או לציין דרגה.',
      data: { menu: buildRankMenu(routes) },
    },
  };
}

const escalateToSeniorStaff: ChatbotTool = {
  name: 'escalateToSeniorStaff',
  description:
    'Routes a question to the senior staff member responsible for the user\'s rank, over WhatsApp. ' +
    'Pass rankAnswer exactly as the user replied — a menu digit (1-5), a category, or the rank itself ' +
    '("סמ״ר", "רס״ל", "רס״ר"). Ranks are resolved here, so never map a rank to a number yourself. ' +
    'If the answer cannot be resolved this returns ok:false — re-send the menu instead of guessing. ' +
    'Include the question and, if known, her name.',
  input_schema: {
    type: 'object',
    properties: {
      rankAnswer: { type: 'string', description: "The user's rank or menu reply, verbatim" },
      question: { type: 'string', description: "The user's question or request, in Hebrew" },
      fullName: { type: 'string', description: 'Her name if she gave it' },
      summary: { type: 'string', description: 'Short Hebrew summary of the conversation' },
    },
    required: ['rankAnswer', 'question'],
  },
  execute: async (input, ctx) => {
    const dest = resolveRankDestination(input.rankAnswer, ctx);
    if (!dest.ok) return dest.result;

    const body =
      `פנייה חדשה מהבוט 🤖\n` +
      `קטגוריה: ${dest.category}\n` +
      (dest.rank ? `דרגה: ${dest.rank}\n` : '') +
      `שם: ${input.fullName || 'לא נמסר'}\n` +
      `טלפון: ${toLocalIsraeliPhone(ctx.phoneNumber)}\n\n` +
      `השאלה:\n${input.question}` +
      (input.summary ? `\n\nסיכום השיחה:\n${input.summary}` : '');

    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO chatbot_escalations (id, conversation_id, phone_number, question, summary, staff_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        id,
        ctx.conversation.id,
        ctx.phoneNumber,
        String(input.question ?? ''),
        `[${dest.category}] → ${dest.name}\n${input.summary ?? ''}`.trim(),
        dest.phone,
      );

    try {
      await ctx.sendWhatsApp(dest.phone, body);
      ctx.db.prepare(`UPDATE chatbot_escalations SET status = 'sent' WHERE id = ?`).run(id);
      ctx.db.prepare(`UPDATE chatbot_conversations SET status = 'escalated' WHERE id = ?`).run(ctx.conversation.id);
      return { ok: true, data: { routedTo: dest.name, category: dest.category, rank: dest.rank ?? undefined } };
    } catch (e: any) {
      ctx.db.prepare(`UPDATE chatbot_escalations SET status = 'failed', error = ? WHERE id = ?`).run(String(e?.message ?? e), id);
      return { ok: false, error: `העברת הפנייה נכשלה: ${e?.message ?? e}` };
    }
  },
};

const escalateToStaff: ChatbotTool = {
  name: 'escalateToStaff',
  description:
    'Forward a question the knowledge base cannot answer to the right staff member. ' +
    'Call this INSTEAD of guessing whenever you lack a reliable answer. ' +
    'You MUST pass rank — the destination depends on it. If you do not know it yet, ask her first ' +
    '("מה הדרגה שלך?"); this returns ok:false with the menu when the rank is missing or unclear.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: "The user's question, verbatim" },
      rank: { type: 'string', description: 'Her rank or rank-menu answer, verbatim (e.g. "רס״ל", "4")' },
      summary: { type: 'string', description: 'Short Hebrew summary of the conversation so far' },
    },
    required: ['question', 'rank'],
  },
  execute: async (input, ctx) => {
    // Routing by rank happens here for the same reason as in
    // escalateToSeniorStaff: this used to send every unanswerable question to
    // one general number regardless of who was asking.
    const dest = resolveRankDestination(input.rank, ctx);
    if (!dest.ok) return dest.result;

    const senderName = (ctx.conversation.collectedData?.fullName as string) || 'לא ידוע';
    const body =
      `שאלה חדשה מהבוט 🤖\n` +
      `קטגוריה: ${dest.category}\n` +
      (dest.rank ? `דרגה: ${dest.rank}\n` : '') +
      `שם: ${senderName}\n` +
      `טלפון: ${toLocalIsraeliPhone(ctx.phoneNumber)}\n\n` +
      `שאלה:\n${input.question}\n\n` +
      `סיכום השיחה:\n${input.summary || '—'}`;

    const id = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO chatbot_escalations (id, conversation_id, phone_number, question, summary, staff_phone, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(
        id,
        ctx.conversation.id,
        ctx.phoneNumber,
        String(input.question ?? ''),
        `[${dest.category}] → ${dest.name}\n${input.summary ?? ''}`.trim(),
        dest.phone,
      );

    try {
      await ctx.sendWhatsApp(dest.phone, body);
      ctx.db.prepare(`UPDATE chatbot_escalations SET status = 'sent' WHERE id = ?`).run(id);
      ctx.db.prepare(`UPDATE chatbot_conversations SET status = 'escalated' WHERE id = ?`).run(ctx.conversation.id);
      return { ok: true, data: { routedTo: dest.name, category: dest.category, rank: dest.rank ?? undefined } };
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
      `טלפון: ${toLocalIsraeliPhone(ctx.phoneNumber)}\n` +
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

/**
 * Validates and forwards a filled vehicle-entry form.
 *
 * Completeness is checked HERE, not by the model: a form missing mandatory
 * fields is never forwarded, and the caller is told exactly which fields to
 * ask for. That keeps a half-filled request from reaching staff.
 */
export async function submitVehicleEntry(
  input: Record<string, any>,
  ctx: WorkflowContext,
): Promise<ToolResult> {
  const filledForm = String(input.filledForm ?? '').trim();
  if (!filledForm) {
    return { ok: false, error: 'לא התקבל פורמט מלא. שלח למשתמש את הפורמט וחכה שימלא אותו.' };
  }

  const parsed = parseVehicleEntryForm(filledForm);
  if (!parsed.complete) {
    return {
      ok: false,
      error: `הפורמט לא מלא. חסרים השדות הבאים: ${parsed.missing.join(', ')}. בקש מהמשתמש רק אותם.`,
      data: { missingFields: parsed.missing },
    };
  }

  const to = resolveStaffPhone(ctx.config, 'vehicle');
  const body =
    `בקשת אישור כניסה 🚗\n` +
    `נשלח מהבוט של מערך היח״ש\n` +
    `טלפון הפונה: ${toLocalIsraeliPhone(ctx.phoneNumber)}\n\n` +
    renderVehicleEntryForm(parsed.values);

  const id = randomUUID();
  ctx.db
    .prepare(
      `INSERT INTO chatbot_requests (id, conversation_id, phone_number, type, payload, staff_phone, status)
       VALUES (?, ?, ?, 'vehicle_entry', ?, ?, ?)`,
    )
    .run(id, ctx.conversation.id, ctx.phoneNumber, JSON.stringify(parsed.values), to, to ? 'pending' : 'unconfigured');

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
  saveContactDetails,
  getFyiFormat,
  broadcastFyi,
  getVehicleEntryFormat,
  searchGeneralKnowledge,
  searchOrders,
  getOrderStatus,
  searchReplacementSchedule,
  getUpcomingReplacement,
  searchDevelopmentTracks,
  searchOpenCalls,
  sendVehicleEntryRequest,
  sendMessageToStaff,
  getSeniorStaffOptions,
  escalateToSeniorStaff,
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
