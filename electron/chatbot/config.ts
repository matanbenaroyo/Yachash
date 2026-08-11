/**
 * Chatbot configuration, stored in the existing `settings` key/value table
 * (same pattern as DuoPlusManager). Staff phone numbers and the API key live
 * here so they are configurable from the UI and never hardcoded in the code.
 */
import type { ChatbotConfig } from './types';

const PREFIX = 'chatbot_';

export const DEFAULT_GREETING = `שלום 👋
אני הבוט של מערך היח״ש.
אני יכול לעזור לך עם אישורי רכב, פקודות, לו״ז החלפה, מסלולי פיתוח, קול קורא ושאלות נוספות לסגל.
פשוט כתוב לי מה אתה צריך.`;

const DEFAULTS: ChatbotConfig = {
  enabled: false,
  apiKey: '',
  model: 'claude-opus-5',
  accountIds: [],
  vehicleEntryStaffPhone: '',
  generalStaffPhone: '',
  openCallStaffPhone: '',
  historyTurns: 12,
  greeting: DEFAULT_GREETING,
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
