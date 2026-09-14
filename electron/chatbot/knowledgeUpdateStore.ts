/**
 * Persistence for knowledge updates sent over WhatsApp.
 *
 * Kept apart from the IPC and tool layers so the rules that decide what gets
 * overwritten are tested against a real database rather than assumed.
 */
import { randomUUID } from 'crypto';
import type { ItemAction, ProposedItem } from './knowledgeUpdate';

export interface StoredProposal {
  id: string;
  conversationId: string | null;
  requesterPhone: string;
  requesterName: string | null;
  sourceText: string;
  items: ProposedItem[];
  preparedTurn: number;
  status: string;
}

const LINE_PREFIX = /^\s*(?:[-*•●▪◦]|\d{1,3}[.)])\s+/;
const HAS_DATE = /\d{1,2}[/.]\d{1,2}/;

export function createProposal(db: any, p: Omit<StoredProposal, 'id' | 'status'>): string {
  const id = randomUUID();
  // Anything still pending from this editor is superseded: a later approval
  // must never apply to an older preview she has moved on from.
  db.prepare(`UPDATE chatbot_knowledge_updates SET status='superseded' WHERE requester_phone=? AND status='pending'`)
    .run(p.requesterPhone);
  db.prepare(
    `INSERT INTO chatbot_knowledge_updates
       (id, conversation_id, requester_phone, requester_name, source_text, items, prepared_turn, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(id, p.conversationId, p.requesterPhone, p.requesterName, p.sourceText, JSON.stringify(p.items), p.preparedTurn);
  return id;
}

export function getPendingProposal(db: any, requesterPhone: string): StoredProposal | null {
  const row = db
    .prepare(
      `SELECT * FROM chatbot_knowledge_updates
       WHERE requester_phone = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(requesterPhone) as any;
  if (!row) return null;
  let items: ProposedItem[] = [];
  try { items = JSON.parse(row.items ?? '[]'); } catch { items = []; }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requesterPhone: row.requester_phone,
    requesterName: row.requester_name,
    sourceText: row.source_text,
    items,
    preparedTurn: Number(row.prepared_turn ?? 0),
    status: row.status,
  };
}

export interface ApplyResult {
  added: number;
  replaced: number;
  kept: number;
  skipped: number;
  summariesUpdated: number;
  /** Items that were not applied because the base changed after the preview. */
  stale: number[];
}

/**
 * Applies the editor's decisions, all or nothing.
 *
 * Before replacing anything, each row is checked against what the preview
 * showed. If it has changed since — another update, an edit in the app — that
 * item is refused rather than overwritten, because she approved replacing the
 * text she saw, not whatever is there now.
 *
 * Everything replaced is recorded with its previous value, so an update can be
 * undone from the audit row without restoring a whole backup.
 */
export function applyProposal(
  db: any,
  proposal: StoredProposal,
  actions: Map<number, ItemAction>,
  requesterName: string | null,
): ApplyResult {
  const result: ApplyResult = { added: 0, replaced: 0, kept: 0, skipped: 0, summariesUpdated: 0, stale: [] };
  const undo: any = { replacedRows: [], addedRowIds: [], mentionLines: [] };

  const getRow = db.prepare('SELECT id, title, content FROM chatbot_knowledge WHERE id = ?');
  const updateRow = db.prepare(
    'UPDATE chatbot_knowledge SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  const insertRow = db.prepare(
    `INSERT INTO chatbot_knowledge (id, category, title, content, metadata, is_active)
     VALUES (?, 'general', ?, ?, ?, 1)`,
  );

  const run = db.transaction(() => {
    for (const item of proposal.items) {
      const action = actions.get(item.number) ?? 'skip';

      if (action === 'keep') { result.kept++; continue; }
      if (action === 'skip') { result.skipped++; continue; }

      if (action === 'add') {
        const id = randomUUID();
        insertRow.run(
          id,
          item.title,
          item.content,
          JSON.stringify({ source: 'whatsapp-update', proposal: proposal.id, by: requesterName }),
        );
        undo.addedRowIds.push(id);
        result.added++;
        continue;
      }

      // replace — verify nothing moved since the preview, then write every copy.
      const staleRow = item.matches.find(m => {
        const current = getRow.get(m.id) as any;
        return !current || current.content !== m.content || current.title !== m.title;
      });
      const staleMention = item.mentions.find(m => {
        const current = getRow.get(m.entryId) as any;
        return !current || current.content.split('\n')[m.lineIndex] !== m.line;
      });
      if (staleRow || staleMention) {
        result.stale.push(item.number);
        continue;
      }

      for (const m of item.matches) {
        undo.replacedRows.push({ id: m.id, title: m.title, content: m.content });
        updateRow.run(item.title, item.content, m.id);
      }

      // The fact as a single line, for rewriting it inside summaries.
      const newLine = item.content.split('\n').filter(l => HAS_DATE.test(l)).pop() ?? item.content;
      for (const mention of item.mentions) {
        const current = getRow.get(mention.entryId) as any;
        const lines = String(current.content).split('\n');
        const prefix = mention.line.match(LINE_PREFIX)?.[0] ?? '';
        undo.mentionLines.push({ entryId: mention.entryId, lineIndex: mention.lineIndex, line: mention.line });
        lines[mention.lineIndex] = prefix + newLine.replace(LINE_PREFIX, '');
        updateRow.run(current.title, lines.join('\n'), mention.entryId);
        result.summariesUpdated++;
      }

      result.replaced++;
    }

    db.prepare(
      `UPDATE chatbot_knowledge_updates
       SET status = 'applied', decisions = ?, undo = ?, applied_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(JSON.stringify(Object.fromEntries(actions)), JSON.stringify(undo), proposal.id);
  });

  run();
  return result;
}
