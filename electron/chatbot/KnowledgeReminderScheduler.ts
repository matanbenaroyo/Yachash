/**
 * Daily nudge to the knowledge editors.
 *
 * Once a day at the configured time (default 11:00) everyone on the
 * knowledge-editors list gets a short personal reminder to send new
 * information if they have any. `{שם}` in the text becomes the recipient's
 * first name, so adding a second editor does not greet them as someone else.
 *
 * Two choices differ from the FYI digest and the heartbeat:
 *
 *   - A missed reminder is dropped, not sent late. The digest catches up
 *     whenever the machine comes back because its content must not be lost;
 *     a "remember to update" arriving in the evening is just noise. Being a
 *     little late (WhatsApp reconnecting, a reboot) still sends.
 *
 *   - The reminder is written into the recipient's conversation with the bot.
 *     Her natural reply is "אין עדכונים" or "תודה", and without the reminder in
 *     the history the bot would receive that out of nowhere.
 */
import { getChatbotConfig } from './config';
import { ConversationManager } from './ConversationManager';
import { DEFAULT_REMINDER_TEXT } from './knowledgeUpdate';
import type { FyiSender } from './fyi';

const CHECK_INTERVAL_MS = 60 * 1000;

/** How late a reminder may still go out. Past this, today's is skipped. */
export const MAX_LATE_MS = 3 * 60 * 60 * 1000;

const SENT_KEY = 'chatbot_knowledge_reminder_sent';

/** Local calendar day. The ISO string is UTC, which is yesterday until 03:00 in Israel. */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whether a reminder at `time` ("HH:MM") should go out now, if not already sent today. */
export function isDue(now: Date, time: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return false;
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const late = now.getTime() - target.getTime();
  return late >= 0 && late <= MAX_LATE_MS;
}

export function renderReminder(template: string, editor: Pick<FyiSender, 'name'>): string {
  const firstName = (editor.name ?? '').trim().split(/\s+/)[0] ?? '';
  return template
    .replace(/\{שם\}/g, firstName)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export class KnowledgeReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private resolveDb: () => any,
    private getWhatsAppManager: () => any,
    private getSendAccountId: () => string | null,
  ) {}

  private get db() {
    return this.resolveDb();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(e => console.error('⏰ Knowledge reminder tick failed:', e?.message ?? e));
    }, CHECK_INTERVAL_MS);
    console.log('⏰ KnowledgeReminderScheduler started');
    this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check. `now` is injectable so the schedule can be tested without waiting a day. */
  async tick(now: Date = new Date()): Promise<string[]> {
    if (this.running) return [];           // a slow send must not overlap the next tick
    this.running = true;
    try {
      const config = getChatbotConfig(this.db);
      if (!config.enabled || !config.knowledgeReminderTime) return [];
      if (!isDue(now, config.knowledgeReminderTime)) return [];

      const today = localDateKey(now);
      const sent = this.getSent();
      const pending = config.knowledgeEditors.filter(e => e.phone && sent[e.phone] !== today);
      if (!pending.length) return [];

      const manager = this.getWhatsAppManager();
      const accountId = this.getSendAccountId();
      if (!manager || !accountId) return [];   // retried on the next tick

      const delivered: string[] = [];
      for (const editor of pending) {
        const body = renderReminder(config.knowledgeReminderText || DEFAULT_REMINDER_TEXT, editor);
        try {
          await manager.sendMessage(accountId, editor.phone, body);
        } catch (e: any) {
          console.warn(`⏰ Reminder to ${editor.name || editor.phone} failed; will retry:`, e?.message ?? e);
          continue;
        }

        // Recorded per person, straight after their send: if one of two
        // recipients fails, the retry must not remind the other one twice.
        sent[editor.phone] = today;
        this.setSent(sent);
        delivered.push(editor.phone);
        this.recordInConversation(accountId, editor.phone, body);
        console.log(`⏰ Knowledge reminder sent to ${editor.name || editor.phone}`);
      }
      return delivered;
    } finally {
      this.running = false;
    }
  }

  private recordInConversation(accountId: string, phone: string, body: string): void {
    try {
      const conversations = new ConversationManager(this.resolveDb);
      const conversation = conversations.getOrCreate(accountId, phone);
      conversations.appendTurn(conversation.id, { role: 'assistant', content: body });
    } catch (e: any) {
      // The reminder already went out; losing the history entry is not worth failing over.
      console.warn('⏰ Could not record the reminder in the conversation:', e?.message ?? e);
    }
  }

  private getSent(): Record<string, string> {
    try {
      const raw = (this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SENT_KEY) as any)?.value;
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private setSent(sent: Record<string, string>): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SENT_KEY, JSON.stringify(sent));
  }
}
