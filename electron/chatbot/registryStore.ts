/**
 * Database operations for the bot's contact registry.
 *
 * Separate from the IPC layer so the rules that protect existing data can be
 * tested against a real database, rather than trusted: this is where an import
 * could quietly erase what the bot already collected, or an edit could fold one
 * person's record into someone else's.
 */
import { validateManualContact, type RegistryContact } from './contacts';
import { toLocalIsraeliPhone, toWhatsAppNumber } from './phone';

export type SaveResult = { ok: true; contact: RegistryContact } | { ok: false; errors: string[] };

/**
 * Adds one person, or edits one when `originalPhone` is given.
 *
 * The phone number is the key, so correcting it is a rename — and a rename onto
 * a number that already belongs to someone must be refused, not merged, or two
 * people's details collapse into one record.
 *
 * An edit writes every field exactly as the form has it. Clearing a field in
 * the dialog is a decision; that is deliberately unlike import.
 */
export function saveRegistryContact(db: any, input: any, originalPhone?: string): SaveResult {
  const { contact, errors } = validateManualContact(input ?? {});
  if (!contact) return { ok: false, errors };

  const original = originalPhone ? toWhatsAppNumber(originalPhone) ?? originalPhone : null;

  if (original) {
    const exists = db.prepare('SELECT 1 FROM chatbot_known_contacts WHERE phone_number = ?').get(original);
    if (!exists) return { ok: false, errors: ['איש הקשר לא נמצא — ייתכן שנמחק בינתיים'] };
  }

  if (!original || original !== contact.phone_number) {
    const clash = db
      .prepare('SELECT full_name FROM chatbot_known_contacts WHERE phone_number = ?')
      .get(contact.phone_number) as any;
    if (clash) {
      return {
        ok: false,
        errors: [`המספר ${toLocalIsraeliPhone(contact.phone_number)} כבר שייך ל${clash.full_name ? clash.full_name : 'איש קשר אחר'}`],
      };
    }
  }

  const write = db.transaction(() => {
    if (original) {
      db.prepare(
        `UPDATE chatbot_known_contacts
         SET phone_number = ?, full_name = ?, personal_number = ?, rank = ?, birthday = ?, updated_at = CURRENT_TIMESTAMP
         WHERE phone_number = ?`,
      ).run(contact.phone_number, contact.full_name, contact.personal_number, contact.rank, contact.birthday, original);
    } else {
      db.prepare(
        `INSERT INTO chatbot_known_contacts (phone_number, full_name, personal_number, rank, birthday)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(contact.phone_number, contact.full_name, contact.personal_number, contact.rank, contact.birthday);
    }
  });
  write();

  return { ok: true, contact };
}

/**
 * Imports many people at once.
 *
 * Existing people are updated, never duplicated, and only with fields the row
 * actually carries. A spreadsheet of names and phone numbers must not wipe the
 * ranks, personal numbers and birthdays already on file — an empty cell means
 * "not in this file", not "delete this".
 */
export function importRegistryContacts(db: any, contacts: any[]): { added: number; updated: number; skipped: number } {
  const list = Array.isArray(contacts) ? contacts : [];
  const valid = list
    .map(c => validateManualContact(c).contact)
    .filter((c): c is RegistryContact => Boolean(c));

  const exists = db.prepare('SELECT 1 FROM chatbot_known_contacts WHERE phone_number = ?');
  const upsert = db.prepare(
    `INSERT INTO chatbot_known_contacts (phone_number, full_name, personal_number, rank, birthday)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phone_number) DO UPDATE SET
       full_name       = COALESCE(excluded.full_name, chatbot_known_contacts.full_name),
       personal_number = COALESCE(excluded.personal_number, chatbot_known_contacts.personal_number),
       rank            = COALESCE(excluded.rank, chatbot_known_contacts.rank),
       birthday        = COALESCE(excluded.birthday, chatbot_known_contacts.birthday),
       updated_at      = CURRENT_TIMESTAMP`,
  );

  let added = 0;
  let updated = 0;
  // Collapse duplicates within one import so the same person is not counted —
  // or written — twice.
  const seen = new Set<string>();
  const run = db.transaction(() => {
    for (const c of valid) {
      if (seen.has(c.phone_number)) continue;
      seen.add(c.phone_number);
      if (exists.get(c.phone_number)) updated++;
      else added++;
      upsert.run(c.phone_number, c.full_name, c.personal_number, c.rank, c.birthday);
    }
  });
  run();

  return { added, updated, skipped: list.length - added - updated };
}

export function deleteRegistryContact(db: any, phone: string): { deleted: boolean; name: string | null } {
  const row = db.prepare('SELECT full_name FROM chatbot_known_contacts WHERE phone_number = ?').get(phone) as any;
  if (!row) return { deleted: false, name: null };
  db.prepare('DELETE FROM chatbot_known_contacts WHERE phone_number = ?').run(phone);
  return { deleted: true, name: row.full_name ?? null };
}
