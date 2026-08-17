/**
 * Daily FYI digest.
 *
 * This is the ONLY thing that posts FYI content to the groups. Submitting an
 * FYI queues it (see broadcastFyi); once a day at the configured time (default
 * 16:00) everything still queued goes out as one consolidated message, each
 * entry carrying the contact who submitted it and their phone number, and
 * dropping the "הפצת מידע - FYI" form title.
 *
 * Sending each submission immediately as well would mean the groups receive
 * every message twice — once on arrival and again in the digest.
 *
 * Modelled on ScheduledCampaignChecker: a plain interval that checks whether
 * the target time has passed, so it survives restarts and does not depend on
 * the process being alive at the exact minute.
 */
import { getChatbotConfig } from './config';
import { renderDigestEntry, type FyiSender } from './fyi';

/** How often to check whether the digest is due. */
const CHECK_INTERVAL_MS = 60 * 1000;

export class FyiDigestScheduler {
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
      this.tick().catch(e => console.error('🗞️ FYI digest tick failed:', e?.message ?? e));
    }, CHECK_INTERVAL_MS);
    console.log('🗞️ FyiDigestScheduler started - checking every 60s');
    // Run once now so a restart after the target time still sends today's digest.
    this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends the digest immediately, regardless of the clock. Used by the UI. */
  async sendNow(): Promise<{ ok: boolean; count: number; delivered: string[]; error?: string }> {
    return this.buildAndSend(new Date(), true);
  }

  private async tick(): Promise<void> {
    if (this.running) return;           // a slow send must not overlap the next tick
    this.running = true;
    try {
      const config = getChatbotConfig(this.db);
      if (!config.enabled || !config.fyiDigestTime) return;

      const now = new Date();
      const [h, m] = config.fyiDigestTime.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return;

      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (now < target) return;                       // not yet due today

      const todayKey = now.toISOString().slice(0, 10);
      if (this.getLastRunDate() === todayKey) return; // already sent today

      await this.buildAndSend(now, false);
      this.setLastRunDate(todayKey);
    } finally {
      this.running = false;
    }
  }

  private async buildAndSend(
    now: Date,
    manual: boolean,
  ): Promise<{ ok: boolean; count: number; delivered: string[]; error?: string }> {
    const db = this.db;
    const config = getChatbotConfig(db);

    // Everything queued since the last digest, rather than a fixed 24-hour
    // window: if a digest fails or the machine was off at the target time,
    // those messages must still go out with the next one instead of expiring
    // unsent. `digest_sent_at` is what makes a message done.
    const rows = db
      .prepare(
        `SELECT * FROM chatbot_fyi_messages
         WHERE digest_sent_at IS NULL AND status = 'queued'
         ORDER BY created_at ASC`,
      )
      .all() as any[];

    if (!rows.length) {
      // Nothing to report is a normal outcome, not a failure — stay silent in
      // the groups rather than sending an empty digest.
      console.log('🗞️ FYI digest: nothing in the last 24h, not sending');
      return { ok: true, count: 0, delivered: [] };
    }

    const entries = rows.map(r => {
      const sender: FyiSender = { phone: r.sender_phone, name: r.sender_name || '', role: r.sender_role || '' };
      return renderDigestEntry(
        {
          'נושא ההודעה': r.subject || '',
          'אוכלוסיה': r.audience || '',
          'דגשים': r.highlights || '',
          'תג״ב': r.tagav || '',
        },
        sender,
      );
    });

    const header =
      `סיכום הפצות מידע — ${formatHebrewDate(now)} 🗞️\n` +
      `(${rows.length} ${rows.length === 1 ? 'הודעה' : 'הודעות'} מאז הסיכום הקודם)`;
    const body = [header, ...entries].join('\n\n———\n\n');

    const manager = this.getWhatsAppManager();
    const accountId = this.getSendAccountId();
    if (!manager || !accountId) {
      const error = 'אין חשבון וואטסאפ מחובר לשליחת הסיכום';
      console.warn('🗞️ FYI digest skipped:', error);
      return { ok: false, count: rows.length, delivered: [], error };
    }

    const delivered: string[] = [];
    const failed: string[] = [];
    for (const g of config.fyiGroups.filter(g => g.chatId)) {
      try {
        await manager.sendMessage(accountId, g.chatId, body);
        delivered.push(g.label || g.chatId);
      } catch (e: any) {
        failed.push(`${g.label || g.chatId} (${e?.message ?? e})`);
      }
    }

    if (delivered.length) {
      const mark = db.prepare(
        `UPDATE chatbot_fyi_messages
         SET digest_sent_at = CURRENT_TIMESTAMP, status = 'sent', delivered_to = ?
         WHERE id = ?`,
      );
      const deliveredJson = JSON.stringify(delivered);
      const markAll = db.transaction((ids: string[]) => { for (const id of ids) mark.run(deliveredJson, id); });
      markAll(rows.map(r => r.id));
    }

    console.log(`🗞️ FYI digest ${manual ? '(manual) ' : ''}sent: ${rows.length} entries -> ${delivered.join(', ') || 'nobody'}`);
    return {
      ok: delivered.length > 0,
      count: rows.length,
      delivered,
      error: failed.length ? failed.join('; ') : undefined,
    };
  }

  private getLastRunDate(): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'chatbot_fyi_digest_last_run'`).get();
    return row?.value ?? null;
  }

  private setLastRunDate(date: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('chatbot_fyi_digest_last_run', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(date);
  }
}

function formatHebrewDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
