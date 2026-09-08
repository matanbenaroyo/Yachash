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

/**
 * International form for SENDING: 0505556699 -> 972505556699.
 *
 * The inverse of the display helper above. WhatsAppManager.normalizeSendTarget
 * rejects anything without a country code, so a number typed the way an
 * Israeli actually writes it has to be converted before it can be used as a
 * destination.
 *
 * Returns null when the input is not a number this can convert with
 * confidence. That matters more than convenience here: the value is used as a
 * message destination, and guessing wrong means sending someone else's message
 * to a stranger. An unrecognised format should stop the send, not approximate.
 */
export function toWhatsAppNumber(input: unknown): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // Group ids are already addressable as-is.
  if (raw.endsWith('@g.us')) return raw;

  const digits = digitsOnly(raw);
  if (!digits) return null;

  // 00972... / 972...
  const withoutIdd = digits.startsWith('00') ? digits.slice(2) : digits;

  // Already international: 972 + 9 subscriber digits.
  if (withoutIdd.startsWith('972')) {
    const rest = withoutIdd.slice(3).replace(/^0/, ''); // tolerate 9720xx
    return rest.length === 9 ? '972' + rest : null;
  }

  // Local trunk form: 0 + 9 digits, e.g. 0505556699.
  if (withoutIdd.length === 10 && withoutIdd.startsWith('0')) {
    return '972' + withoutIdd.slice(1);
  }

  // Bare subscriber number: 505556699.
  if (withoutIdd.length === 9 && withoutIdd.startsWith('5')) {
    return '972' + withoutIdd;
  }

  // A non-Israeli number that already carries some country code is passed
  // through; WhatsApp itself will reject it if it is not real.
  if (withoutIdd.length >= 11 && withoutIdd.length <= 15) return withoutIdd;

  return null;
}
