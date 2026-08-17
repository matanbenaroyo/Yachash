/**
 * Chatbot configuration, stored in the existing `settings` key/value table
 * (same pattern as DuoPlusManager). Staff phone numbers and the API key live
 * here so they are configurable from the UI and never hardcoded in the code.
 */
import type { ChatbotConfig } from './types';
import { DEFAULT_SENIOR_STAFF_ROUTING, normalizePhone, type SeniorStaffRoute } from './seniorStaff';
import { DEFAULT_FYI_SENDERS, DEFAULT_FYI_GROUPS, type FyiSender, type FyiGroup } from './fyi';

const PREFIX = 'chatbot_';

export const DEFAULT_GREETING = `שלום 👋
אני הבוט של מערך היח״ש.
אני יכול לעזור לך עם אישורי רכב, פקודות, לו״ז החלפה, מסלולי פיתוח, קול קורא ושאלות נוספות לסגל.
פשוט כתוב לי מה אתה צריך.`;

const DEFAULTS: ChatbotConfig = {
  enabled: false,
  apiKey: '',
  // Sonnet, not Opus: this is a high-volume WhatsApp responder where every
  // incoming message costs a call, and the work — intent detection, form
  // parsing and short Hebrew replies over tool results — does not need the
  // larger model. Changeable per-install from the Chatbot settings page.
  model: 'claude-sonnet-5',
  accountIds: [],
  vehicleEntryStaffPhone: '',
  generalStaffPhone: '',
  openCallStaffPhone: '',
  historyTurns: 12,
  greeting: DEFAULT_GREETING,
  seniorStaffRouting: DEFAULT_SENIOR_STAFF_ROUTING,
  fyiSenders: DEFAULT_FYI_SENDERS,
  fyiGroups: DEFAULT_FYI_GROUPS,
  fyiDigestTime: '16:00',
};

export function getChatbotConfig(db: any): ChatbotConfig {
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key LIKE '${PREFIX}%'`)
    .all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map(r => [r.key, r.value]));

  const read = (k: keyof ChatbotConfig, fallback: string) =>
    map.get(PREFIX + toSnake(k)) ?? fallback;

  let accountIds: string[] = [];
  try {
    accountIds = JSON.parse(read('accountIds', '[]') as string);
    if (!Array.isArray(accountIds)) accountIds = [];
  } catch {
    accountIds = [];
  }

  const historyTurns = Number(read('historyTurns', String(DEFAULTS.historyTurns)));

  // A corrupted or hand-edited routing value must not silently disable
  // escalation — fall back to the defaults rather than an empty menu.
  let seniorStaffRouting: SeniorStaffRoute[] = DEFAULT_SENIOR_STAFF_ROUTING;
  try {
    const raw = map.get(PREFIX + 'senior_staff_routing');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        seniorStaffRouting = parsed
          .filter((r: any) => r && r.label && r.phone)
          .map((r: any, i: number) => ({
            option: Number(r.option) || i + 1,
            label: String(r.label),
            name: String(r.name ?? ''),
            phone: normalizePhone(r.phone),
          }));
        if (!seniorStaffRouting.length) seniorStaffRouting = DEFAULT_SENIOR_STAFF_ROUTING;
      }
    }
  } catch {
    seniorStaffRouting = DEFAULT_SENIOR_STAFF_ROUTING;
  }

  // Same defensive treatment as the routing table: a corrupted value must not
  // silently disable FYI broadcasting or, worse, widen who may send one.
  let fyiSenders: FyiSender[] = DEFAULT_FYI_SENDERS;
  try {
    const raw = map.get(PREFIX + 'fyi_senders');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((r: any) => r && r.phone)
          .map((r: any) => ({ phone: normalizePhone(r.phone), name: String(r.name ?? ''), role: String(r.role ?? '') }))
          .filter((r: FyiSender) => r.phone.length >= 9);
        // An empty list is a legitimate choice (nobody may broadcast), but only
        // when it was stored deliberately as an empty array.
        if (cleaned.length || parsed.length === 0) fyiSenders = cleaned;
      }
    }
  } catch {
    fyiSenders = DEFAULT_FYI_SENDERS;
  }

  let fyiGroups: FyiGroup[] = DEFAULT_FYI_GROUPS;
  try {
    const raw = map.get(PREFIX + 'fyi_groups');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .filter((g: any) => g && g.chatId)
          .map((g: any) => ({ chatId: String(g.chatId).trim(), label: String(g.label ?? '') }));
        if (cleaned.length || parsed.length === 0) fyiGroups = cleaned;
      }
    }
  } catch {
    fyiGroups = DEFAULT_FYI_GROUPS;
  }

  const digestTime = (read('fyiDigestTime', '16:00') as string).trim();

  return {
    enabled: read('enabled', '0') === '1',
    apiKey: read('apiKey', DEFAULTS.apiKey) as string,
    model: (read('model', DEFAULTS.model) as string) || DEFAULTS.model,
    accountIds,
    vehicleEntryStaffPhone: read('vehicleEntryStaffPhone', '') as string,
    generalStaffPhone: read('generalStaffPhone', '') as string,
    openCallStaffPhone: read('openCallStaffPhone', '') as string,
    historyTurns: Number.isFinite(historyTurns) && historyTurns > 0 ? historyTurns : DEFAULTS.historyTurns,
    greeting: (read('greeting', DEFAULTS.greeting) as string) || DEFAULTS.greeting,
    seniorStaffRouting,
    fyiSenders,
    fyiGroups,
    fyiDigestTime: /^\d{1,2}:\d{2}$/.test(digestTime) ? digestTime : '16:00',
  };
}

export function saveChatbotConfig(db: any, patch: Partial<ChatbotConfig>): void {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const save = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const stored =
        key === 'enabled'
          ? value ? '1' : '0'
          : key === 'accountIds'
            ? JSON.stringify(value ?? [])
            : key === 'seniorStaffRouting'
              ? JSON.stringify(
                  (Array.isArray(value) ? value : []).map((r: any, i: number) => ({
                    option: Number(r.option) || i + 1,
                    label: String(r.label ?? ''),
                    name: String(r.name ?? ''),
                    phone: normalizePhone(r.phone),
                  })),
                )
              : key === 'fyiSenders'
                ? JSON.stringify(
                    (Array.isArray(value) ? value : []).map((r: any) => ({
                      phone: normalizePhone(r.phone),
                      name: String(r.name ?? ''),
                      role: String(r.role ?? ''),
                    })),
                  )
                : key === 'fyiGroups'
                  ? JSON.stringify(
                      (Array.isArray(value) ? value : []).map((g: any) => ({
                        chatId: String(g.chatId ?? '').trim(),
                        label: String(g.label ?? ''),
                      })),
                    )
                  : String(value);
      upsert.run(PREFIX + toSnake(key), stored);
    }
  });

  save();
}

/**
 * Which staff number a workflow escalates to. Falls back to the general number
 * so a half-configured install still reaches a human rather than silently
 * dropping the request.
 */
export function resolveStaffPhone(
  config: ChatbotConfig,
  kind: 'vehicle' | 'open_call' | 'general',
): string {
  const specific =
    kind === 'vehicle' ? config.vehicleEntryStaffPhone
      : kind === 'open_call' ? config.openCallStaffPhone
        : config.generalStaffPhone;
  return (specific || config.generalStaffPhone || '').trim();
}

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
}
