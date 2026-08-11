/**
 * ChatbotService — the conversational engine for מערך היח״ש.
 *
 * Pipeline:  WhatsApp message → intent detection → workflow → tools/data →
 *            AI-formulated Hebrew reply → WhatsApp
 *
 * The AI is the conversational layer only. Every fact and every action comes
 * from a tool executed by this code; the model may not decide that an operation
 * succeeded. Nothing here touches campaign sending or warm-up.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatbotConfig,
  ChatbotIntent,
  ConversationState,
  WorkflowContext,
  WorkflowDefinition,
} from './types';
import { getChatbotConfig } from './config';
import { ConversationManager } from './ConversationManager';
import { detectIntent } from './intentRouter';
import { buildSystemPrompt } from './prompts/system';
import { TOOL_MAP, toolDefinitionsFor } from './tools';
import { WORKFLOW_BY_ID, allWorkflowTools, workflowForIntent } from './workflows';
import { extractHebrewMonth, parseHebrewDate, parseHebrewTime } from './dateParser';

/** Guard against a tool-call loop burning tokens on a single message. */
const MAX_TOOL_ROUNDS = 5;

export interface HandleResult {
  handled: boolean;
  reply?: string;
  intent?: ChatbotIntent;
  error?: string;
}

export class ChatbotService {
  private conversations: ConversationManager;
  private whatsappManager: any = null;
  /** Serializes turns per phone number so rapid messages don't interleave. */
  private inFlight: Map<string, Promise<unknown>> = new Map();

  constructor(private db: any) {
    this.conversations = new ConversationManager(db);
  }

  setWhatsAppManager(manager: any) {
    this.whatsappManager = manager;
  }

  getConfig(): ChatbotConfig {
    return getChatbotConfig(this.db);
  }

  getConversationManager(): ConversationManager {
    return this.conversations;
  }

  /** True when the bot is switched on, keyed, and allowed on this account. */
  isEnabledFor(accountId: string): boolean {
    const config = this.getConfig();
    if (!config.enabled || !config.apiKey) return false;
    return config.accountIds.length === 0 || config.accountIds.includes(accountId);
  }

  /**
   * Entry point from WhatsAppManager. Returns handled:false when the chatbot is
   * off or not responsible, so the caller can fall through to existing behavior.
   */
  async handleIncomingMessage(
    accountId: string,
    phoneNumber: string,
    body: string,
  ): Promise<HandleResult> {
    if (!this.isEnabledFor(accountId)) return { handled: false };
    const text = (body ?? '').trim();
    if (!text) return { handled: false };

    // Queue behind any turn already running for this contact.
    const key = `${accountId}:${phoneNumber}`;
    const previous = this.inFlight.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.processTurn(accountId, phoneNumber, text, true));
    this.inFlight.set(key, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    }
  }

  /**
   * Runs one turn without sending over WhatsApp — used by the management UI's
   * test console so the flow can be exercised without a live account.
   */
  async simulate(phoneNumber: string, body: string, accountId = 'simulator'): Promise<HandleResult> {
    return this.processTurn(accountId, phoneNumber, (body ?? '').trim(), false);
  }

  private async processTurn(
    accountId: string,
    phoneNumber: string,
    text: string,
    deliver: boolean,
  ): Promise<HandleResult> {
    const config = this.getConfig();
    if (!config.apiKey) return { handled: false, error: 'לא הוגדר מפתח API' };

    const now = new Date();
    const isFirstContact = this.conversations.isFirstContact(accountId, phoneNumber);
    let conversation = this.conversations.getOrCreate(accountId, phoneNumber, now);
    this.conversations.appendTurn(conversation.id, { role: 'user', content: text });

    const client = new Anthropic({ apiKey: config.apiKey });

    try {
      const recentTurns = this.conversations.recentTurns(conversation.id, config.historyTurns);

      // 1. Classify. Prior turns are included so a bare "12345678" is understood
      //    as the answer to the question the bot just asked.
      const decision = await detectIntent({
        client,
        model: config.model,
        message: text,
        conversation,
        recentTurns: recentTurns.slice(0, -1),
      });

      // 2. Resolve extracted values into concrete data (dates/times are business
      //    logic, not something the model is trusted to compute).
      const normalized = this.normalizeExtracted(decision.extractedData, now);

      // 3. Pick the workflow. An active workflow is kept unless the user clearly
      //    switched topic with reasonable confidence.
      const workflow = this.resolveWorkflow(conversation, decision.intent, decision.confidence);
      if (workflow && workflow.id !== conversation.activeWorkflow) {
        this.conversations.setIntent(conversation.id, workflow.intent, workflow.id);
      }

      if (Object.keys(normalized.data).length) {
        this.conversations.mergeCollected(conversation.id, normalized.data);
      }

      // Re-read so the prompt sees merged state.
      conversation = this.reload(conversation.id);

      // A genuinely ambiguous date must be clarified before any action runs.
      const extra = normalized.clarification
        ? `שים לב: ${normalized.clarification} — שאל את המשתמש להבהרה לפני ביצוע פעולה.`
        : undefined;

      const greeting =
        isFirstContact && !workflow
          ? `זו ההודעה הראשונה מהמשתמש הזה. פתח בהצגה עצמית קצרה בנוסח הבא (אפשר לנסח מחדש בטבעיות): "${config.greeting}"`
          : undefined;

      // 4. Let the model converse, with only this workflow's tools available.
      const reply = await this.runConversation({
        client,
        config,
        conversation,
        workflow,
        recentTurns: this.conversations.recentTurns(conversation.id, config.historyTurns),
        accountId,
        phoneNumber,
        now,
        extraContext: [extra, greeting].filter(Boolean).join('\n\n') || undefined,
      });

      const finalReply = reply || 'לא בטוח שהבנתי בדיוק מה אתה צריך. תוכל להסביר לי במשפט אחד?';
      this.conversations.appendTurn(conversation.id, { role: 'assistant', content: finalReply });

      if (deliver) await this.sendWhatsApp(accountId, phoneNumber, finalReply);

      return { handled: true, reply: finalReply, intent: workflow?.intent ?? decision.intent };
    } catch (e: any) {
      const message = String(e?.message ?? e);
      console.error('🤖 Chatbot error:', message);
      this.db
        .prepare(`INSERT INTO chatbot_errors (id, conversation_id, phone_number, error) VALUES (lower(hex(randomblob(16))), ?, ?, ?)`)
        .run(conversation.id, phoneNumber, message);
      return { handled: false, error: message };
    }
  }

  /**
   * The tool-use loop. The model may call tools; this code executes them and
   * feeds real results back, repeating until it produces a text answer.
   */
  private async runConversation(params: {
    client: Anthropic;
    config: ChatbotConfig;
    conversation: ConversationState;
    workflow: WorkflowDefinition | null;
    recentTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
    accountId: string;
    phoneNumber: string;
    now: Date;
    extraContext?: string;
  }): Promise<string> {
    const { client, config, workflow, recentTurns, accountId, phoneNumber, now, extraContext } = params;
    let conversation = params.conversation;

    const ctx: WorkflowContext = {
      accountId,
      phoneNumber,
      conversation,
      config,
      db: this.db,
      sendWhatsApp: (to, message) => this.sendWhatsApp(accountId, to, message),
      now,
    };

    const toolNames = workflow ? workflow.tools : allWorkflowTools();
    const tools = toolDefinitionsFor(toolNames);

    const messages: any[] = recentTurns.map(t => ({ role: t.role, content: t.content }));
    if (!messages.length || messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(תחילת שיחה)' });
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const system = buildSystemPrompt({
        conversation,
        workflow,
        todayISO: now.toISOString().slice(0, 10),
        extraContext,
      });

      const response = await client.messages.create({
        model: config.model,
        max_tokens: 2048,
        system,
        tools: tools.length ? tools : undefined,
        messages,
      } as any);

      if ((response as any).stop_reason === 'refusal') {
        return 'לא אוכל לעזור בבקשה הזו. אפשר לנסח אותה אחרת?';
      }

      const toolUses = response.content.filter((b: any) => b.type === 'tool_use') as any[];

      if (!toolUses.length) {
        return response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
          .trim();
      }

      messages.push({ role: 'assistant', content: response.content });

      const results: any[] = [];
      for (const use of toolUses) {
        const tool = TOOL_MAP[use.name];
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'הכלי אינו זמין', is_error: true });
          continue;
        }
        try {
          ctx.conversation = conversation;
          const result = await tool.execute(use.input ?? {}, ctx);

          // A completed vehicle-entry request ends the workflow so the next
          // message starts clean instead of resuming a finished form.
          if (tool.name === 'sendVehicleEntryRequest' && result.ok) {
            this.conversations.clearWorkflow(conversation.id);
          }

          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(result),
            is_error: !result.ok && !result.notFound,
          });
        } catch (e: any) {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: results });
      conversation = this.reload(conversation.id);
    }

    return 'משהו לקח יותר מדי זמן. תוכל לנסות לנסח את הבקשה שוב?';
  }

  /**
   * Turns the model's raw extractions into stored fields. Relative dates are
   * resolved here, and genuine ambiguity is surfaced instead of guessed.
   */
  private normalizeExtracted(
    extracted: Record<string, unknown>,
    now: Date,
  ): { data: Record<string, unknown>; clarification?: string } {
    const data: Record<string, unknown> = {};
    let clarification: string | undefined;

    for (const key of ['fullName', 'vehicleNumber', 'unit', 'reason', 'orderName', 'audience', 'topic'] as const) {
      const v = extracted[key];
      if (typeof v === 'string' && v.trim()) data[key] = v.trim();
    }

    const dateText = typeof extracted.dateText === 'string' ? extracted.dateText : '';
    if (dateText) {
      const parsed = parseHebrewDate(dateText, now);
      if (parsed.date) data.date = parsed.date;
      else if (parsed.ambiguous) clarification = parsed.clarification;
      data.dateText = dateText;
    }

    const timeText = typeof extracted.timeText === 'string' ? extracted.timeText : '';
    if (timeText) {
      const t = parseHebrewTime(timeText);
      if (t) data.time = t;
    }

    const monthName = typeof extracted.monthName === 'string' ? extracted.monthName : '';
    if (monthName) data.monthName = extractHebrewMonth(monthName) ?? monthName;

    return { data, clarification };
  }

  /**
   * Keeps the active workflow unless the user clearly moved on. Without this a
   * bare "12345678" answering "מה מספר הרכב?" could be re-classified as UNKNOWN
   * and drop the half-finished request.
   */
  private resolveWorkflow(
    conversation: ConversationState,
    intent: ChatbotIntent,
    confidence: number,
  ): WorkflowDefinition | null {
    const active = conversation.activeWorkflow ? WORKFLOW_BY_ID[conversation.activeWorkflow] : null;

    if (active) {
      const switched =
        intent !== active.intent &&
        intent !== 'UNKNOWN' &&
        intent !== 'OTHER' &&
        confidence >= 0.7;
      return switched ? workflowForIntent(intent) ?? active : active;
    }

    if (intent === 'UNKNOWN') return null;
    return workflowForIntent(intent);
  }

  private reload(id: string): ConversationState {
    return this.conversations.get(id)!;
  }

  private async sendWhatsApp(accountId: string, to: string, message: string): Promise<void> {
    if (!this.whatsappManager) throw new Error('WhatsApp manager not available');
    await this.whatsappManager.sendMessage(accountId, to, message);
  }
}
