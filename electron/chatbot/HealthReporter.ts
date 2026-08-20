/**
 * Operational alerting for an unattended host.
 *
 * The machine this runs on has no screen and nobody watching it, so a failure
 * that only writes to a log is a failure nobody learns about. Two signals go
 * out over WhatsApp itself, and they are deliberately different in kind:
 *
 *   - An ALERT is sent when something has already failed and did not recover.
 *     Useful, but it depends on the very thing that may be broken.
 *
 *   - A HEARTBEAT is sent once a day when everything is fine. Its value is the
 *     opposite: you are not relying on a broken system managing to shout. If
 *     the daily message does not arrive, that absence IS the signal — it works
 *     even when the machine is off, the network is down, or WhatsApp itself is
 *     the thing that broke.
 *
 * Both are off unless an alert number is configured.
 */
import { getChatbotConfig } from './config';

const CHECK_INTERVAL_MS = 60 * 1000;

/** Never send the same alert more often than this. */
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

export class HealthReporter {
  private timer: NodeJS.Timeout | null = null;
  private lastAlertAt = new Map<string, number>();

  constructor(
    private resolveDb: () => any,
    private getWhatsAppManager: () => any,
  ) {}

  private get db() {
    return this.resolveDb();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(e => console.error('🔔 HealthReporter tick failed:', e?.message ?? e));
    }, CHECK_INTERVAL_MS);
    console.log('🔔 HealthReporter started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Reports a problem, at most once per cooldown per key.
   *
   * Rate limiting is per-key rather than global so a noisy recurring fault
   * cannot crowd out a different, newer one.
   */
  async alert(key: string, message: string): Promise<void> {
    const now = Date.now();
    const last = this.lastAlertAt.get(key) ?? 0;
    if (now - last < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(key, now);

    console.warn(`🔔 ALERT [${key}]: ${message}`);
    await this.send(`⚠️ התרעה מהבוט\n\n${message}\n\nזמן: ${formatTime(new Date())}`);
  }

  private async tick(): Promise<void> {
    const config = getChatbotConfig(this.db);
    if (!config.alertPhone || !config.heartbeatTime) return;

    const now = new Date();
    const [h, m] = config.heartbeatTime.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;

    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (now < target) return;

    const todayKey = now.toISOString().slice(0, 10);
    if (this.getLastHeartbeat() === todayKey) return;

    const summary = this.buildSummary();
    const sent = await this.send(`✅ הבוט פעיל\n\n${summary}\n\n${formatTime(now)}`);
    // Only record the day as done on success, so a failed send is retried on
    // the next tick rather than skipping a day's heartbeat entirely.
    if (sent) this.setLastHeartbeat(todayKey);
  }

  /** A few numbers that make the ping worth reading rather than just noise. */
  private buildSummary(): string {
    const one = (sql: string, fallback = 0) => {
      try { return (this.db.prepare(sql).get() as any)?.n ?? fallback; } catch { return fallback; }
    };

    const accounts = (() => {
      try { return this.db.prepare('SELECT phone_number, status FROM accounts').all() as any[]; }
      catch { return []; }
    })();

    const lines = accounts.map(a => `• ${a.phone_number}: ${a.status === 'connected' ? 'מחובר' : a.status}`);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    return [
      ...lines,
      `• הודעות ב-24 שעות: ${one(`SELECT COUNT(*) n FROM chatbot_messages WHERE created_at >= '${since}'`)}`,
      `• הפצות ממתינות: ${one(`SELECT COUNT(*) n FROM chatbot_fyi_messages WHERE status = 'queued' AND digest_sent_at IS NULL`)}`,
      `• שגיאות ב-24 שעות: ${one(`SELECT COUNT(*) n FROM chatbot_errors WHERE created_at >= '${since}'`)}`,
    ].join('\n');
  }

  /** Sends via any connected account. Returns false rather than throwing. */
  private async send(body: string): Promise<boolean> {
    const config = getChatbotConfig(this.db);
    if (!config.alertPhone) return false;

    const manager = this.getWhatsAppManager();
    if (!manager) return false;

    let accounts: any[] = [];
    try {
      accounts = this.db.prepare("SELECT id FROM accounts WHERE status = 'connected'").all() as any[];
    } catch {
      return false;
    }

    for (const account of accounts) {
      try {
        await manager.sendMessage(account.id, config.alertPhone, body);
        return true;
      } catch {
        // Try the next account; a wedged one is exactly what we may be reporting.
      }
    }
    console.warn('🔔 Could not deliver alert - no working account');
    return false;
  }

  private getLastHeartbeat(): string | null {
    try {
      return (this.db.prepare(`SELECT value FROM settings WHERE key = 'chatbot_heartbeat_last_run'`).get() as any)?.value ?? null;
    } catch {
      return null;
    }
  }

  private setLastHeartbeat(date: string): void {
    try {
      this.db.prepare(
        `INSERT INTO settings (key, value) VALUES ('chatbot_heartbeat_last_run', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(date);
    } catch { /* the next tick will try again */ }
  }
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
