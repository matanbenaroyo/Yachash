/**
 * Per-WhatsApp-user conversation state.
 *
 * State is persisted in SQLite rather than held in memory so a restart doesn't
 * lose an in-progress request, and so the management UI can inspect live
 * conversations. Only a bounded window of recent turns is replayed to the model
 * — the rest is condensed into `conversation_context`.
 */
import { randomUUID } from 'crypto';
import type { ChatbotIntent, ConversationState, ConversationTurn } from './types';

/** A conversation older than this starts fresh rather than resuming stale intent. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

export class ConversationManager {
  private resolveDb: () => any;

  /** Accepts a connection or a getter — see KnowledgeService for why. */
  constructor(dbOrGetter: any) {
    this.resolveDb = typeof dbOrGetter === 'function' ? dbOrGetter : () => dbOrGetter;
  }

  private get db(): any {
    return this.resolveDb();
  }

  /** Returns the live conversation for a phone number, creating one if needed. */
  getOrCreate(accountId: string, phoneNumber: string, now: Date = new Date()): ConversationState {
    const row = this.db
      .prepare(
        `SELECT * FROM chatbot_conversations
         WHERE phone_number = ? AND account_id = ? AND status = 'active'
         ORDER BY last_message_at DESC LIMIT 1`,
      )
      .get(phoneNumber, accountId);

    if (row) {
      const last = row.last_message_at ? Date.parse(row.last_message_at + 'Z') : NaN;
      const stale = Number.isFinite(last) && now.getTime() - last > STALE_AFTER_MS;
      if (!stale) return toState(row);
      // Close the stale one so the next message starts clean.
      this.db.prepare(`UPDATE chatbot_conversations SET status = 'completed' WHERE id = ?`).run(row.id);
    }

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO chatbot_conversations
           (id, account_id, phone_number, active_intent, active_workflow, collected_data, conversation_context, status)
         VALUES (?, ?, ?, NULL, NULL, '{}', '', 'active')`,
      )
      .run(id, accountId, phoneNumber);

    return toState(this.db.prepare(`SELECT * FROM chatbot_conversations WHERE id = ?`).get(id));
  }

  /** True when this phone number has never talked to the bot before. */
  isFirstContact(accountId: string, phoneNumber: string): boolean {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM chatbot_conversations WHERE phone_number = ? AND account_id = ?`)
      .get(phoneNumber, accountId) as { n: number };
    return (row?.n ?? 0) === 0;
  }

  setIntent(id: string, intent: ChatbotIntent | null, workflowId: string | null): void {
    this.db
      .prepare(`UPDATE chatbot_conversations SET active_intent = ?, active_workflow = ? WHERE id = ?`)
      .run(intent, workflowId, id);
  }

  /**
   * Merges newly extracted fields into the conversation. Existing values win —
   * the bot must not overwrite (or re-ask for) something the user already gave.
   */
  mergeCollected(id: string, updates: Record<string, unknown>): Record<string, unknown> {
    const row = this.db.prepare(`SELECT collected_data FROM chatbot_conversations WHERE id = ?`).get(id);
    const current = safeParse(row?.collected_data);
    for (const [k, v] of Object.entries(updates ?? {})) {
      if (v === null || v === undefined || v === '') continue;
      if (current[k] === undefined || current[k] === null || current[k] === '') current[k] = v;
    }
    this.db.prepare(`UPDATE chatbot_conversations SET collected_data = ? WHERE id = ?`).run(JSON.stringify(current), id);
    return current;
  }

  /** Explicit overwrite, used when a workflow completes or the user corrects a value. */
  setCollected(id: string, data: Record<string, unknown>): void {
    this.db.prepare(`UPDATE chatbot_conversations SET collected_data = ? WHERE id = ?`).run(JSON.stringify(data), id);
  }

  appendTurn(conversationId: string, turn: ConversationTurn): void {
    this.db
      .prepare(
        `INSERT INTO chatbot_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`,
      )
      .run(randomUUID(), conversationId, turn.role, turn.content);
    this.db
      .prepare(`UPDATE chatbot_conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(conversationId);
  }

  /** Most recent turns, oldest-first, bounded so the prompt can't grow without limit. */
  recentTurns(conversationId: string, limit: number): ConversationTurn[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, created_at FROM chatbot_messages
         WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(conversationId, limit) as any[];
    return rows
      .reverse()
      .map(r => ({ role: r.role as 'user' | 'assistant', content: r.content, createdAt: r.created_at }));
  }

  setContext(conversationId: string, context: string): void {
    this.db.prepare(`UPDATE chatbot_conversations SET conversation_context = ? WHERE id = ?`).run(context, conversationId);
  }

  complete(conversationId: string): void {
    this.db
      .prepare(`UPDATE chatbot_conversations SET status = 'completed', active_intent = NULL, active_workflow = NULL WHERE id = ?`)
      .run(conversationId);
  }

  /** Clears the active workflow but keeps the conversation open for follow-ups. */
  clearWorkflow(conversationId: string): void {
    this.db
      .prepare(`UPDATE chatbot_conversations SET active_intent = NULL, active_workflow = NULL, collected_data = '{}' WHERE id = ?`)
      .run(conversationId);
  }

  get(id: string): ConversationState | null {
    const row = this.db.prepare(`SELECT * FROM chatbot_conversations WHERE id = ?`).get(id);
    return row ? toState(row) : null;
  }

  list(limit = 100): ConversationState[] {
    const rows = this.db
      .prepare(`SELECT * FROM chatbot_conversations ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map(toState);
  }

  messages(conversationId: string): ConversationTurn[] {
    const rows = this.db
      .prepare(`SELECT role, content, created_at FROM chatbot_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`)
      .all(conversationId) as any[];
    return rows.map(r => ({ role: r.role, content: r.content, createdAt: r.created_at }));
  }
}

function toState(row: any): ConversationState {
  return {
    id: row.id,
    accountId: row.account_id,
    phoneNumber: row.phone_number,
    activeIntent: row.active_intent ?? null,
    activeWorkflow: row.active_workflow ?? null,
    collectedData: safeParse(row.collected_data),
    conversationContext: row.conversation_context ?? '',
    status: row.status ?? 'active',
    lastMessageAt: row.last_message_at ?? null,
    createdAt: row.created_at ?? '',
  };
}

function safeParse(json: any): Record<string, unknown> {
  try {
    const parsed = json ? JSON.parse(json) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
