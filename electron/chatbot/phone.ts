/**
 * Phone number presentation.
 *
 * Numbers are stored and sent in international digits-only form (972529217523)
 * because that is what WhatsApp addresses require. That form is awkward to read
 * and cannot be dialled or copied into a contact, so anything a human reads —
 * an escalation forwarded to a רמ״דית, a digest entry — shows the local form.
 */

/** Digits only; tolerates "+972 52-921-7523" and similar. */
export function digitsOnly(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * Local Israeli form for display: 972529217523 -> 0529217523.
 *
 * Anything that is not recognisably an Israeli number is returned unchanged
 * rather than mangled — a foreign number, a WhatsApp group id or a test
 * identifier should still be readable in a forwarded message.
 */
export function toLocalIsraeliPhone(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  // Group chats and @lid identifiers are not phone numbers at all.
  if (raw.includes('@')) return raw;

  const digits = digitsOnly(raw);
  if (!digits) return raw;

  // 972 + 9 subscriber digits (already without the national trunk 0).
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);

  // 00972 / +972 written with the trunk 0 kept: 9720529217523.
  if (digits.startsWith('972') && digits.length === 13 && digits[3] === '0') return digits.slice(3);
  if (digits.startsWith('00972')) return toLocalIsraeliPhone(digits.slice(2));

  // Already local.
  if (digits.startsWith('0') && digits.length === 10) return digits;

  // Bare subscriber number, e.g. 529217523.
  if (digits.length === 9 && digits.startsWith('5')) return '0' + digits;

  return raw;
}
