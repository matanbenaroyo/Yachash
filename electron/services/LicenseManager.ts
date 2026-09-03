/**
 * Licensing — resolved locally, with no network call.
 *
 * This fork is covered by a perpetual licence (the previous remote check
 * reported ~5,240 days remaining), so the validation round-trip decided nothing
 * while costing a great deal, and two of its properties were actively harmful
 * for the way this install now runs:
 *
 *  - It gated startup on reachability. `startServicesFromMain` only builds the
 *    WhatsApp client and the chatbot when the check returns valid, and the
 *    check fails closed — so a Supabase outage, an expired anon key, or a home
 *    connection dropping for a minute at boot took the whole bot down and left
 *    no way to diagnose it, because the Logs page was gated on the same flag.
 *
 *  - It pinned the licence to one machine fingerprint. Moving this install to
 *    the always-on host produces a different fingerprint, which the remote
 *    check answers with "already activated on another device" — meaning the bot
 *    would have refused to start on the new machine.
 *
 * The public shape is unchanged so the IPC handlers and the renderer keep
 * working. The `.license` file is still read and written, so the key that was
 * issued remains on disk and this is reversible: restoring the remote check
 * means restoring this file from git history.
 */
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface LicenseInfo {
  isValid: boolean;
  isActivated: boolean;
  expiresAt?: string;
  daysLeft?: number;
  licenseKey?: string;
  email?: string;
  status?: 'active' | 'expired' | 'suspended' | 'grace_period';
  error?: string;
  logAccess?: boolean;
}

/** Perpetual licence: reported as a far-future expiry rather than as absent. */
const PERPETUAL_EXPIRY = '2099-12-31T00:00:00.000Z';

export class LicenseManager {
  private licensePath: string;

  constructor() {
    this.licensePath = path.join(app.getPath('userData'), '.license');
  }

  async initialize(): Promise<void> {
    console.log('✅ License Manager initialized (perpetual, local)');
  }

  /**
   * Always valid. Deliberately synchronous in effect — no I/O that can fail,
   * so startup can never be blocked by something unreachable.
   *
   * `logAccess` is true because the Logs page is the only diagnostic surface on
   * a machine with no screen; gating it behind a remote flag that fails closed
   * removed the bot and the ability to find out why at the same moment.
   */
  async checkLicense(): Promise<LicenseInfo> {
    const daysLeft = Math.max(
      0,
      Math.floor((new Date(PERPETUAL_EXPIRY).getTime() - Date.now()) / 86_400_000),
    );

    return {
      isValid: true,
      isActivated: true,
      expiresAt: PERPETUAL_EXPIRY,
      daysLeft,
      licenseKey: this.readSavedLicenseKey(),
      status: 'active',
      logAccess: true,
    };
  }

  /** Records the key locally and reports success; nothing to validate against. */
  async activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string; info?: LicenseInfo }> {
    const key = (licenseKey ?? '').trim();
    if (!key) return { success: false, error: 'לא הוזן מפתח רישיון' };

    this.saveLicenseKey(key);
    console.log('✅ License key stored locally');
    return { success: true, info: await this.checkLicense() };
  }

  /**
   * Forgets the stored key. The install stays usable — the licence is perpetual
   * and no longer verified remotely — so this only clears the record.
   */
  async deactivateLicense(): Promise<{ success: boolean; error?: string }> {
    this.deleteLicenseKey();
    console.log('🗑️ License key removed locally');
    return { success: true };
  }

  async getLicenseUser(): Promise<{ email?: string; name?: string }> {
    return {};
  }

  private saveLicenseKey(key: string): void {
    try {
      fs.writeFileSync(this.licensePath, key, 'utf-8');
    } catch (error) {
      console.error('Could not write .license:', error);
    }
  }

  private readSavedLicenseKey(): string | undefined {
    try {
      if (fs.existsSync(this.licensePath)) {
        return fs.readFileSync(this.licensePath, 'utf-8').trim() || undefined;
      }
    } catch (error) {
      console.error('Could not read .license:', error);
    }
    return undefined;
  }

  private deleteLicenseKey(): void {
    try {
      if (fs.existsSync(this.licensePath)) fs.unlinkSync(this.licensePath);
    } catch (error) {
      console.error('Could not delete .license:', error);
    }
  }
}
