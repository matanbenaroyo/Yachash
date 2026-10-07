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
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
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

/**
 * The last update this editor's information actually went into, for taking it
 * back out. Scoped to the conversation she is in, so "בטל" in a chat today
 * cannot undo something from a different thread.
 */
export function getLastAppliedProposal(
  db: any,
  requesterPhone: string,
  conversationId: string | null,
): (StoredProposal & { undo: any; appliedAt: string | null }) | null {
  const row = db
    .prepare(
      `SELECT * FROM chatbot_knowledge_updates
       WHERE requester_phone = ? AND status = 'applied'
         AND (? IS NULL OR conversation_id = ?)
       ORDER BY applied_at DESC, created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(requesterPhone, conversationId, conversationId) as any;
  if (!row) return null;

  const parse = (json: any, fallback: any) => {
    try { return json ? JSON.parse(json) : fallback; } catch { return fallback; }
  };

  return {
    id: row.id,
    conversationId: row.conversation_id,
    requesterPhone: row.requester_phone,
    requesterName: row.requester_name,
    sourceText: row.source_text,
    items: parse(row.items, []),
    preparedTurn: Number(row.prepared_turn ?? 0),
    status: row.status,
    undo: parse(row.undo, { replacedRows: [], addedRowIds: [], mentionLines: [] }),
    appliedAt: row.applied_at ?? null,
  };
}

export interface UndoResult {
  restored: number;
  removed: number;
  summariesRestored: number;
}

/**
 * Puts an applied update back, from what was recorded when it went in.
 *
 * This is what makes storing information on arrival safe: nothing is approved
 * in advance, so there has to be a way back that does not involve restoring a
 * database backup. Rows that were added are deleted; rows that were overwritten
 * get their previous title and content; lines rewritten inside month summaries
 * get their previous text.
 */
export function undoProposal(db: any, proposal: { id: string; undo: any }): UndoResult {
  const result: UndoResult = { restored: 0, removed: 0, summariesRestored: 0 };
  const undo = proposal.undo ?? {};

  const getRow = db.prepare('SELECT id, title, content FROM chatbot_knowledge WHERE id = ?');
  const updateRow = db.prepare(
    'UPDATE chatbot_knowledge SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  const deleteRow = db.prepare('DELETE FROM chatbot_knowledge WHERE id = ?');

  const run = db.transaction(() => {
    for (const id of undo.addedRowIds ?? []) {
      deleteRow.run(id);
      result.removed++;
    }

    for (const previous of undo.replacedRows ?? []) {
      if (!getRow.get(previous.id)) continue;   // gone since; nothing to restore onto
      updateRow.run(previous.title, previous.content, previous.id);
      result.restored++;
    }

    // Summary lines are restored after the rows, because a restored row may be
    // the summary itself and would otherwise overwrite this.
    for (const mention of undo.mentionLines ?? []) {
      const current = getRow.get(mention.entryId) as any;
      if (!current) continue;
      const lines = String(current.content).split('\n');
      if (mention.lineIndex >= lines.length) continue;
      lines[mention.lineIndex] = mention.line;
      updateRow.run(current.title, lines.join('\n'), mention.entryId);
      result.summariesRestored++;
    }

    db.prepare(`UPDATE chatbot_knowledge_updates SET status = 'undone' WHERE id = ?`).run(proposal.id);
  });

  run();
  return result;
}
