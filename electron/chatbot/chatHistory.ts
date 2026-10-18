/**
 * What the bot gets to read before it answers.
 *
 * The bot used to see only its own conversation: the turns it had exchanged
 * with this person. Everything else in the same WhatsApp chat was invisible to
 * it — a campaign that went out an hour ago, an announcement, a line someone
 * from the unit typed by hand in the app.
 *
 * On 18.10.2026 a campaign asked 87 people "האם תגיע.י לאירוע 😊: 1. כן 2. לא
 * 3. לא יודע.ת". They answered "1", "2", "3", "ויסי/ זום", "תשלחו זימון במייל".
 * The bot, seeing a conversation that began with "1", opened with its greeting
 * and asked what they needed. It was answering a question it could not see.
 *
 * So the history comes from the chat itself, with the bot's own stored turns
 * merged in, and each outgoing message marked by who actually sent it.
 */

export type TurnRole = 'user' | 'assistant';

/** Who produced an outgoing message — the bot, or the unit through the app. */
export type TurnOrigin = 'bot' | 'unit' | 'them';

export interface HistoryTurn {
  role: TurnRole;
  content: string;
  origin: TurnOrigin;
  at: string;
}

export interface ChatRow {
  is_from_me: number | boolean;
  message_text: string | null;
  message_type?: string | null;
  timestamp: string;
}

export interface BotTurn {
  role: TurnRole;
  content: string;
  createdAt?: string;
}

/** How close in time two copies of the same text have to be to count as one. */
const SAME_MESSAGE_WINDOW_MS = 5 * 60 * 1000;

const normalise = (text: string) => String(text ?? '').replace(/\s+/g, ' ').trim();

function toMillis(value: string | undefined): number {
  if (!value) return 0;
  // The chat stores ISO timestamps; the bot's own turns are SQLite datetimes in UTC.
  const iso = /\dT\d/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * What to show for a message with no text. Null for anything that is not
 * actually media: WhatsApp delivers empty rows of type 'text' (reactions,
 * protocol messages), and calling those "[מדיה]" tells the bot something
 * happened that did not.
 */
function describeMedia(row: ChatRow): string | null {
  switch (String(row.message_type ?? '').toLowerCase()) {
    case 'image': return '[תמונה]';
    case 'video': return '[סרטון]';
    case 'audio':
    case 'ptt': return '[הודעה קולית]';
    case 'document': return '[מסמך]';
    case 'sticker': return '[סטיקר]';
    case 'vcard':
    case 'contact_card': return '[איש קשר]';
    case 'location': return '[מיקום]';
    default: return null;
  }
}

/**
 * The last `limit` messages of this chat, oldest first.
 *
 * The bot's own turns are the authority on what it said — they are the exact
 * text it produced — so a chat row that repeats one of them is dropped rather
 * than shown twice. What remains of the outgoing side is what the unit sent
 * some other way, and that is the context worth having.
 */
export function buildHistory(chatRows: ChatRow[], botTurns: BotTurn[], limit: number): HistoryTurn[] {
  const fromBot: HistoryTurn[] = botTurns
    .filter(turn => normalise(turn.content))
    .map(turn => ({
      role: turn.role,
      content: turn.content,
      origin: turn.role === 'assistant' ? ('bot' as const) : ('them' as const),
      at: turn.createdAt ?? '',
    }));

  const botByText = new Map<string, number[]>();
  for (const turn of fromBot) {
    const key = `${turn.role}:${normalise(turn.content)}`;
    const times = botByText.get(key) ?? [];
    times.push(toMillis(turn.at));
    botByText.set(key, times);
  }

  const fromChat: HistoryTurn[] = [];
  for (const row of chatRows) {
    const outgoing = Boolean(row.is_from_me);
    const role: TurnRole = outgoing ? 'assistant' : 'user';
    const text = normalise(row.message_text ?? '') ? String(row.message_text) : describeMedia(row);
    if (!text) continue;
    const at = row.timestamp;

    const key = `${role}:${normalise(text)}`;
    const times = botByText.get(key);
    const when = toMillis(at);
    // Already present as one of the bot's own turns.
    if (times && times.some(t => Math.abs(t - when) <= SAME_MESSAGE_WINDOW_MS)) continue;

    fromChat.push({ role, content: text, origin: outgoing ? 'unit' : 'them', at });
  }

  return [...fromBot, ...fromChat]
    .sort((a, b) => toMillis(a.at) - toMillis(b.at))
    .slice(-Math.max(1, limit));
}

/**
 * The history as the model receives it.
 *
 * A message the unit sent some other way is labelled, because the model must
 * not read it as something it said itself — it has to understand that the
 * person is answering THAT.
 */
export function toModelTurns(history: HistoryTurn[]): Array<{ role: TurnRole; content: string }> {
  return history.map(turn => ({
    role: turn.role,
    content: turn.origin === 'unit'
      ? `(הודעה שנשלחה אליה מהמערכת — קמפיין, הפצה או מישהו מהסגל. לא את כתבת אותה)\n${turn.content}`
      : turn.content,
  }));
}

/**
 * The message the person is most likely answering, when it did not come from
 * the bot. Null when the bot itself spoke last, or nobody did.
 */
export function unansweredUnitMessage(history: HistoryTurn[]): HistoryTurn | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn.role === 'user') continue;       // their own message; keep looking back
    return turn.origin === 'unit' ? turn : null;
  }
  return null;
}
