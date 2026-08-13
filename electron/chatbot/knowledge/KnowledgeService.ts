/**
 * Single retrieval surface over every chatbot data source.
 *
 * All knowledge lives in one `chatbot_knowledge` table keyed by category, so a
 * new data source is a new category string rather than new plumbing. The store
 * is deliberately abstracted behind this class: swapping SQLite for a
 * spreadsheet, an API, or a vector index means reimplementing `search` only.
 *
 * The AI never invents organizational facts — it may only report what these
 * queries return, and `notFound` is a first-class result the model must relay
 * honestly rather than paper over.
 */
import { randomUUID } from 'crypto';
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeSearchParams } from '../types';

export class KnowledgeService {
  private resolveDb: () => any;

  /**
   * Accepts a connection or a getter. The getter form matters: if the app
   * reopens a broken connection, a cached handle would keep throwing, while a
   * getter always resolves the live one.
   */
  constructor(dbOrGetter: any) {
    this.resolveDb = typeof dbOrGetter === 'function' ? dbOrGetter : () => dbOrGetter;
  }

  private get db(): any {
    return this.resolveDb();
  }

  /**
   * Keyword search scoped to one category. Scoring is intentionally simple
   * (title hits outrank body hits) — the AI only formulates the answer, so
   * retrieval just has to surface the right rows.
   */
  search({ query, category, filters, limit = 5 }: KnowledgeSearchParams): KnowledgeEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, category, title, content, metadata, updated_at
         FROM chatbot_knowledge
         WHERE category = ? AND is_active = 1`,
      )
      .all(category) as any[];

    const terms = tokenize(query);
    const scored = rows
      .map(row => {
        const entry = toEntry(row);
        if (filters && !matchesFilters(entry, filters)) return null;
        return { entry, score: score(entry, terms) };
      })
      .filter((x): x is { entry: KnowledgeEntry; score: number } => x !== null);

    // An empty query means "list this category" (e.g. "what tracks exist?"),
    // so fall back to recency instead of filtering everything out.
    const relevant = terms.length === 0 ? scored : scored.filter(s => s.score > 0);

    return relevant
      .sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(0, limit)
      .map(s => s.entry);
  }

  list(category?: KnowledgeCategory): KnowledgeEntry[] {
    const rows = category
      ? this.db.prepare(`SELECT * FROM chatbot_knowledge WHERE category = ? ORDER BY updated_at DESC`).all(category)
      : this.db.prepare(`SELECT * FROM chatbot_knowledge ORDER BY category, updated_at DESC`).all();
    return (rows as any[]).map(toEntry);
  }

  create(entry: {
    category: KnowledgeCategory;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): KnowledgeEntry {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO chatbot_knowledge (id, category, title, content, metadata, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(id, entry.category, entry.title, entry.content, JSON.stringify(entry.metadata ?? {}));
    return this.get(id)!;
  }

  update(id: string, patch: Partial<{ title: string; content: string; metadata: Record<string, unknown>; isActive: boolean }>): void {
    const current = this.get(id);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE chatbot_knowledge
         SET title = ?, content = ?, metadata = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.content ?? current.content,
        JSON.stringify(patch.metadata ?? current.metadata),
        patch.isActive === undefined ? 1 : patch.isActive ? 1 : 0,
        id,
      );
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM chatbot_knowledge WHERE id = ?`).run(id);
  }

  /**
   * Imports a whole pasted document as multiple entries.
   *
   * Retrieval works far better on many small entries than one huge blob — the
   * model gets only the relevant section instead of the entire document — so
   * the text is split into sections rather than stored as a single row.
   *
   * Splitting rules, in order of preference:
   *   1. Markdown headings (`# כותרת`) start a new section, heading = title.
   *   2. Otherwise a blank line starts a new section, first line = title.
   */
  bulkImport(category: KnowledgeCategory, text: string): { created: number; titles: string[] } {
    const sections = splitDocument(text || '');
    const created: string[] = [];

    const insert = this.db.prepare(
      `INSERT INTO chatbot_knowledge (id, category, title, content, metadata, is_active)
       VALUES (?, ?, ?, ?, '{}', 1)`,
    );
    const run = this.db.transaction(() => {
      for (const s of sections) {
        insert.run(randomUUID(), category, s.title, s.content);
        created.push(s.title);
      }
    });
    run();

    return { created: created.length, titles: created };
  }

  get(id: string): KnowledgeEntry | null {
    const row = this.db.prepare(`SELECT * FROM chatbot_knowledge WHERE id = ?`).get(id);
    return row ? toEntry(row) : null;
  }

  countByCategory(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT category, COUNT(*) AS n FROM chatbot_knowledge WHERE is_active = 1 GROUP BY category`)
      .all() as Array<{ category: string; n: number }>;
    return Object.fromEntries(rows.map(r => [r.category, r.n]));
  }
}

/**
 * Splits a pasted document into titled sections. Falls back to one section per
 * blank-line-separated block, and finally to the whole text as a single entry,
 * so a paste is never silently dropped.
 */
function splitDocument(text: string): Array<{ title: string; content: string }> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = trimmed.split(/\r?\n/);
  const hasHeadings = lines.some(l => /^\s{0,3}#{1,6}\s+\S/.test(l));

  const sections: Array<{ title: string; content: string[] }> = [];

  if (hasHeadings) {
    let current: { title: string; content: string[] } | null = null;
    for (const line of lines) {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.*\S)\s*$/);
      if (heading) {
        if (current) sections.push(current);
        current = { title: heading[1].trim(), content: [] };
      } else if (current) {
        current.content.push(line);
      } else if (line.trim()) {
        // Text before the first heading becomes its own section.
        current = { title: line.trim().slice(0, 80), content: [] };
      }
    }
    if (current) sections.push(current);
  } else {
    for (const block of trimmed.split(/\n\s*\n/)) {
      const blockLines = block.split(/\r?\n/).filter(l => l.trim());
      if (!blockLines.length) continue;
      sections.push({ title: blockLines[0].trim().slice(0, 80), content: blockLines.slice(1) });
    }
  }

  return sections
    .map(s => ({
      title: s.title,
      // Keep the title in the body too: a section that is only a heading would
      // otherwise import with empty content and match nothing on search.
      content: s.content.join('\n').trim() || s.title,
    }))
    .filter(s => s.title);
}

function toEntry(row: any): KnowledgeEntry {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    metadata,
    updatedAt: row.updated_at ?? '',
  };
}

/**
 * Hebrew-aware tokenizer.
 *
 * Hebrew attaches prefix letters (ו/ה/ב/ל/מ/כ/ש) directly to words, so a user
 * typing "הפקודה" must still match a stored "פקודה". But those same letters
 * legitimately *start* many words — stripping מ from "מסלול" gives "סלול",
 * which matches nothing. So each token yields BOTH forms and scoring takes
 * whichever matches, instead of committing to one guess.
 *
 * Returns one array of alternatives per token.
 */
function tokenize(query: string): string[][] {
  return (query || '')
    .toLowerCase()
    .replace(/["'`״׳,.?!:;()\[\]{}\/\\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => {
      // Prefix forms: "הפקודה" -> also try "פקודה".
      const bases = [w];
      if (/^[והבלמכש]/.test(w) && w.length > 3) bases.push(w.slice(1));

      // Suffix forms: the query word is often LONGER than the stored one
      // ("מסלולי" vs "מסלול"), so substring matching alone finds nothing.
      // Trim common plural/possessive endings as additional candidates.
      const forms = new Set<string>();
      for (const b of bases) {
        forms.add(b);
        const stem = b.replace(/(ים|ות|יות|י|ה)$/, '');
        if (stem.length >= 3 && stem !== b) forms.add(stem);
      }
      return Array.from(forms);
    });
}

function score(entry: KnowledgeEntry, terms: string[][]): number {
  if (terms.length === 0) return 1;
  const title = entry.title.toLowerCase();
  const body = entry.content.toLowerCase();
  const meta = JSON.stringify(entry.metadata).toLowerCase();
  let total = 0;
  for (const forms of terms) {
    // Best single match per token — alternatives must not stack.
    if (forms.some(f => title.includes(f))) total += 3;
    else if (forms.some(f => meta.includes(f))) total += 2;
    else if (forms.some(f => body.includes(f))) total += 1;
  }
  return total;
}

function matchesFilters(entry: KnowledgeEntry, filters: Record<string, string>): boolean {
  return Object.entries(filters).every(([k, v]) => {
    const actual = entry.metadata?.[k];
    return actual === undefined || String(actual).toLowerCase() === String(v).toLowerCase();
  });
}
