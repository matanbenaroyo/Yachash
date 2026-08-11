import { Client, LocalAuth, Events, MessageMedia } from 'whatsapp-web.js';
import { app, BrowserWindow } from 'electron';
import type { Database } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import proxyChain from 'proxy-chain';
import type { CampaignContactResultCode, GroupAddParticipantResult, GroupJoinByInviteResult, ProxyConfig, WhatsAppGroupInviteInfo, WhatsAppGroupParticipant, WhatsAppGroupSummary } from '../../src/types';
import type { FlowEngine } from './FlowEngine';
import { ChatManager } from './ChatManager';

// Find Chrome executable path
function findChromePath(): string | undefined {
  const possiblePaths = [
    // Windows paths
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    // Edge as fallback (Chromium-based)
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const chromePath of possiblePaths) {
    if (chromePath && fs.existsSync(chromePath)) {
      console.log('✅ Found Chrome at:', chromePath);
      return chromePath;
    }
  }
  
  console.warn('⚠️ Chrome not found in standard locations');
  return undefined;
}

// Get bundled Chromium path from puppeteer cache
async function getOrDownloadChromium(): Promise<string> {
  // First try to find installed Chrome/Edge
  const installedChrome = findChromePath();
  if (installedChrome) {
    return installedChrome;
  }

  // Try to use puppeteer's built-in browser
  try {
    const puppeteer = await import('puppeteer');
    const execPath = puppeteer.executablePath();
    if (execPath && fs.existsSync(execPath)) {
      console.log('✅ Using Puppeteer bundled Chromium:', execPath);
      return execPath;
    }
  } catch (e) {
    console.log('Puppeteer bundled browser not available');
  }

  // Download Chromium to app data folder
  const userDataPath = app.getPath('userData');
  const chromiumPath = path.join(userDataPath, 'chromium');
  const chromiumExe = path.join(chromiumPath, 'chrome-win', 'chrome.exe');

  if (fs.existsSync(chromiumExe)) {
    console.log('✅ Using cached Chromium:', chromiumExe);
    return chromiumExe;
  }

  console.log('📥 Downloading Chromium... This may take a few minutes on first run.');
  
  // Use puppeteer's browser fetcher
  try {
    const puppeteer = await import('puppeteer');
    // @ts-ignore - BrowserFetcher exists
    const browserFetcher = (puppeteer as any).createBrowserFetcher({
      path: chromiumPath,
      platform: 'win64'
    });
    
    // Get latest stable revision
    const revisionInfo = await browserFetcher.download('1350406'); // Chrome 131 stable
    console.log('✅ Chromium downloaded to:', revisionInfo.executablePath);
    return revisionInfo.executablePath;
  } catch (downloadError) {
    console.error('Failed to download Chromium:', downloadError);
    throw new Error('Chrome/Edge not found and failed to download Chromium. Please install Google Chrome or Microsoft Edge.');
  }
}

export interface InitializationProgress {
  total: number;
  completed: number;
  failed: number;
  isComplete: boolean;
  currentAccount?: string;
}

interface GroupAccessState {
  chat: any;
  isAdmin: boolean;
  name: string;
}

export class WhatsAppManager {
  private db: Database;
  private clients: Map<string, Client> = new Map();
  private sessionsPaths: Map<string, string> = new Map();
  private readyAccounts: Set<string> = new Set(); // Track which accounts are fully ready
  private connectingAccounts: Set<string> = new Set();
  private anonymizedProxyServers: Map<string, proxyChain.Server> = new Map(); // accountId -> proxy server
  private flowEngine: FlowEngine | null = null;
  /** AI chatbot (מערך היח״ש). Optional — null when the feature is not wired. */
  private chatbotService: any | null = null;
  private campaignScheduler: any | null = null;
  private chatManager: ChatManager;

  // Initialization progress tracking (for startup loader UI)
  private initProgress: InitializationProgress = {
    total: 0,
    completed: 0,
    failed: 0,
    isComplete: true,
  };
  
  // Track recently sent messages to prevent duplicates (race condition fix)
  // Key: "accountId:messageText" -> timestamp
  private recentlySentMessages: Map<string, number> = new Map();

  constructor(db: Database) {
    this.db = db;
    this.chatManager = new ChatManager(db);

    // Synchronously determine initial count so the frontend can query
    // the correct status even before loadExistingSessions starts connecting.
    try {
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM accounts WHERE status IN ('connected', 'connecting', 'qr') OR session_path IS NOT NULL"
      );
      const row = countStmt.get() as any;
      const count = row?.count || 0;
      this.initProgress = {
        total: count,
        completed: 0,
        failed: 0,
        isComplete: count === 0,
      };
    } catch (e) {
      console.error('Failed to count accounts for init progress:', e);
    }

    this.loadExistingSessions();
    
    // Clean up old entries every 2 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this.recentlySentMessages) {
        if (now - timestamp > 120000) { // 2 minutes
          this.recentlySentMessages.delete(key);
        }
      }
    }, 120000);
  }

  setFlowEngine(flowEngine: FlowEngine) {
    this.flowEngine = flowEngine;
  }

  setChatbotService(service: any) {
    this.chatbotService = service;
  }

  setCampaignScheduler(scheduler: any) {
    this.campaignScheduler = scheduler;
  }

  /**
   * Returns current initialization progress (used by the startup loader UI).
   */
  getInitializationProgress(): InitializationProgress {
    return { ...this.initProgress };
  }

  /**
   * Waits until an account is fully ready (ready event fired + WWebJS loaded)
   * or until the timeout expires. Returns true if ready, false otherwise.
   */
  private waitForAccountReady(accountId: string, timeoutMs: number = 120000): Promise<boolean> {
    return new Promise((resolve) => {
      // Fast path: already ready
      if (this.readyAccounts.has(accountId)) {
        resolve(true);
        return;
      }

      const startTime = Date.now();
      const pollInterval = setInterval(() => {
        if (this.readyAccounts.has(accountId)) {
          clearInterval(pollInterval);
          resolve(true);
        } else if (!this.clients.has(accountId)) {
          // Client was removed (disconnected / auth failed)
          clearInterval(pollInterval);
          resolve(false);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(pollInterval);
          resolve(false);
        }
      }, 500);
    });
  }

  /**
   * Broadcast the current initialization progress to the renderer process.
   */
  private emitInitProgress(): void {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('accounts:initProgress', this.initProgress);
    }
  }

  private getSessionPath(accountId: string): string {
    return path.join(app.getPath('userData'), 'sessions', `session-${accountId}`);
  }

  private isTrackedClient(accountId: string, client: Client): boolean {
    return this.clients.get(accountId) === client;
  }

  private isMessageFromMe(message: any): boolean {
    return Boolean(
      message?.fromMe ||
      message?.id?.fromMe ||
      message?._data?.fromMe ||
      message?._data?.id?.fromMe
    );
  }

  private async cleanupProxyServer(accountId: string): Promise<void> {
    const proxyServer = this.anonymizedProxyServers.get(accountId);
    if (!proxyServer) {
      return;
    }

    try {
      await proxyServer.close(true);
      this.anonymizedProxyServers.delete(accountId);
      console.log('🧹 Closed proxy-chain server for account:', accountId);
    } catch (e) {
      console.log('ℹ️ Could not cleanup proxy server:', e);
    }
  }

  private async destroyClientInstance(accountId: string, client: Client): Promise<void> {
    if (this.isTrackedClient(accountId, client)) {
      this.clients.delete(accountId);
    }

    const page = (client as any).pupPage;
    const browser = (client as any).pupBrowser;

    try {
      if (page && typeof page.isClosed === 'function' && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    } catch (error) {
      console.log('ℹ️ Could not close page during cleanup:', error);
    }

    try {
      await client.destroy().catch(() => {});
    } catch (error) {
      console.log('ℹ️ Could not destroy client during cleanup:', error);
    }

    try {
      if (browser && typeof browser.isConnected === 'function' && browser.isConnected()) {
        await browser.close().catch(() => {});
      }
    } catch (error) {
      console.log('ℹ️ Could not close browser during cleanup:', error);
    }

    try {
      const browserProcess = browser?.process?.();
      if (browserProcess && !browserProcess.killed) {
        browserProcess.kill();
      }
    } catch (error) {
      console.log('ℹ️ Could not kill browser process during cleanup:', error);
    }
  }

  private async cleanupAccountResources(accountId: string, client?: Client): Promise<void> {
    const activeClient = client ?? this.clients.get(accountId);

    this.readyAccounts.delete(accountId);
    this.connectingAccounts.delete(accountId);
    this.sessionsPaths.delete(accountId);

    if (!client) {
      this.clients.delete(accountId);
    }

    if (activeClient) {
      await this.destroyClientInstance(accountId, activeClient);
    }

    await this.cleanupProxyServer(accountId);
  }

  /**
   * Picks how many Chromium instances to launch at once based on available RAM/CPU,
   * so a weaker machine doesn't get hit with a simultaneous burst of heavy browser
   * startups when many accounts need to (re)connect at once.
   */
  private getAdaptiveBatchSize(): number {
    const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
    const cpuCount = os.cpus()?.length || 4;

    let batchSize = 5; // default, matches previous hardcoded behavior

    if (totalMemGB < 8) {
      batchSize = 2;
    } else if (totalMemGB < 16) {
      batchSize = 3;
    } else if (totalMemGB >= 32) {
      batchSize = 8;
    }

    // Don't exceed available CPU cores by too much - each Chromium launch is CPU-heavy
    batchSize = Math.min(batchSize, Math.max(2, cpuCount));

    console.log(`🧮 Adaptive batch size: ${batchSize} (RAM: ${totalMemGB.toFixed(1)}GB, CPUs: ${cpuCount})`);
    return batchSize;
  }

  /**
   * Pairing-code debugging aid. whatsapp-web.js's internal pairing-code request (see
   * Client.js's requestPairingCode, called fire-and-forget from inside initialize())
   * runs entirely inside the page context via page.evaluate() - if it throws there, we
   * only ever see a generic "Evaluation failed: ..." with no detail about WHERE inside
   * the page it failed. This forwards the page's own console output and uncaught errors
   * to our logs, and runs a direct diagnostic check for the WAWebAltDeviceLinkingApi
   * module (the exact module requestPairingCode depends on) so we can see immediately
   * whether it's missing/renamed vs. present-but-erroring (e.g. WhatsApp's rate limit).
   */
  private setupPairingDebugLogging(accountId: string, client: Client): void {
    const tag = `[Pairing:${accountId.substring(0, 8)}]`;
    (async () => {
      try {
        let page: any = null;
        for (let attempt = 0; attempt < 100; attempt++) { // wait up to ~10s for the page to exist
          if (!this.isTrackedClient(accountId, client)) return;
          page = (client as any).pupPage;
          if (page) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!page || !this.isTrackedClient(accountId, client)) {
          console.log(`${tag} ⚠️ Page never became available for pairing debug logging`);
          return;
        }

        console.log(`${tag} 📄 Page available, URL: ${page.url()}`);

        page.on('console', (msg: any) => {
          if (!this.isTrackedClient(accountId, client)) return;
          console.log(`${tag} 🖥️ [page console/${msg.type()}] ${msg.text()}`);
        });

        page.on('pageerror', (err: any) => {
          if (!this.isTrackedClient(accountId, client)) return;
          console.error(`${tag} 💥 [page error] ${err?.message || err}`, err?.stack || '');
        });

        // Puppeteer's page.evaluate() error serialization mangles whatever the page
        // throws down to a generic Error with a minified name/message (WA Web is a
        // production/minified bundle) - we saw exactly this: "t: t" with no real
        // detail. Logging every failed HTTP response's exact URL/status lets us see
        // if a specific WhatsApp API call (e.g. the linking endpoint itself) is
        // returning an error status, instead of guessing from a mangled exception.
        page.on('response', (res: any) => {
          if (!this.isTrackedClient(accountId, client)) return;
          const status = res.status();
          if (status >= 400) {
            console.log(`${tag} 🌐 [HTTP ${status}] ${res.url()}`);
          }
        });

        // Give the page a moment to finish its own bootstrap before probing it,
        // otherwise window.require itself may not exist yet.
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!this.isTrackedClient(accountId, client)) return;

        try {
          const diagnostic = await page.evaluate(() => {
            const hasRequire = typeof (window as any).require === 'function';
            let hasAltLinkingModule = false;
            let moduleError: string | null = null;
            if (hasRequire) {
              try {
                hasAltLinkingModule = !!(window as any).require('WAWebAltDeviceLinkingApi');
              } catch (e: any) {
                moduleError = e?.message || String(e);
              }
            }
            return {
              hasRequire,
              hasAltLinkingModule,
              moduleError,
              wwebVersion: (window as any).Debug?.VERSION || null,
              url: window.location.href
            };
          });
          console.log(`${tag} 🔬 Diagnostic (~3s after page load):`, JSON.stringify(diagnostic));
        } catch (diagError: any) {
          console.log(`${tag} ⚠️ Diagnostic evaluate itself failed:`, diagError?.message || diagError);
        }
      } catch (error) {
        console.log(`${tag} ⚠️ Could not set up pairing debug logging:`, error);
      }
    })();
  }

  private requestPairingCodeAfterInitialize(accountId: string, client: Client, phoneNumber: string, intervalMs: number = 180000): void {
    const pairingTag = `[Pairing:${accountId.substring(0, 8)}]`;
    (async () => {
      try {
        let page: any = null;
        for (let attempt = 0; attempt < 150; attempt++) {
          if (!this.isTrackedClient(accountId, client)) {
            return;
          }
          page = (client as any).pupPage;
          if (page) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!page || !this.isTrackedClient(accountId, client)) {
          console.log(`${pairingTag} ⚠️ Cannot request pairing code manually because the page is unavailable`);
          return;
        }

        await page.waitForFunction(() => {
          const state = (window as any).require?.('WAWebSocketModel')?.Socket?.state;
          return Boolean(
            typeof (window as any).Debug?.VERSION !== 'undefined' &&
            typeof (window as any).require === 'function' &&
            state &&
            state !== 'OPENING' &&
            state !== 'UNLAUNCHED' &&
            state !== 'PAIRING'
          );
        }, { timeout: 30000 });

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        const socketState = await page.evaluate(() => (window as any).require?.('WAWebSocketModel')?.Socket?.state || null);
        console.log(`${pairingTag} 🔢 Requesting pairing code manually after initialize(). Socket state: ${socketState}`);

        const code = await client.requestPairingCode(phoneNumber, true, intervalMs);
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        console.log(`${pairingTag} ✅ Manual requestPairingCode() resolved with code:`, code);
      } catch (error: any) {
        console.error(`${pairingTag} ❌ Manual requestPairingCode() failed:`, error?.message || error);
        if (error?.stack) {
          console.error(`${pairingTag} ❌ Manual requestPairingCode() stack:`, error.stack);
        }
      }
    })();
  }

  /**
   * Headless Chrome auto-denies the Persistent Storage permission (no UI to show a prompt
   * for it), unlike a real user-facing Chrome. We saw this surface as WA Web's own console
   * logging "storage bucket persistence denied (aquire-persistent-storage-denied)" right at
   * startup - and, in the same test run, the pairing-code device-linking "Hello" handshake
   * failed server-side with CompanionHelloError/IQErrorBadRequest (400 bad-request). That
   * handshake needs to generate/persist E2E crypto material for the new linked device, so a
   * denied persistent-storage permission is a plausible cause of a malformed Hello payload.
   * Granting it explicitly via CDP (browser.defaultBrowserContext().overridePermissions)
   * removes this as a variable regardless.
   */
  private grantWebPermissions(accountId: string, client: Client): void {
    (async () => {
      try {
        let browser: any = null;
        for (let attempt = 0; attempt < 100; attempt++) { // wait up to ~10s for the browser to exist
          if (!this.isTrackedClient(accountId, client)) return;
          browser = (client as any).pupBrowser;
          if (browser) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!browser || !this.isTrackedClient(accountId, client)) {
          return;
        }

        await browser.defaultBrowserContext().overridePermissions('https://web.whatsapp.com', ['persistent-storage', 'notifications']);
        console.log(`✅ Granted persistent-storage permission for account ${accountId.substring(0, 8)}...`);
      } catch (error) {
        console.log(`ℹ️ Could not grant web permissions for account ${accountId.substring(0, 8)}...:`, error);
      }
    })();
  }

  private async loadExistingSessions() {
    const stmt = this.db.prepare("SELECT * FROM accounts WHERE status IN ('connected', 'connecting', 'qr') OR session_path IS NOT NULL");
    const accounts = stmt.all() as any[];

    // Sync progress state with actual fetched accounts
    this.initProgress = {
      total: accounts.length,
      completed: 0,
      failed: 0,
      isComplete: accounts.length === 0,
    };
    this.emitInitProgress();

    if (accounts.length === 0) {
      console.log('ℹ️ No existing sessions to restore');
      return;
    }

    console.log(`🔄 Restoring ${accounts.length} account session(s) in parallel batches...`);

    // Mark all accounts as 'connecting' before starting reconnection
    // This prevents the UI from showing 'connected' while clients are still initializing
    for (const account of accounts) {
      this.updateAccountStatus(account.id, 'connecting');
    }

    // Connect accounts in parallel batches to dramatically reduce startup time
    // while not overwhelming the system with too many Chrome instances launching at once.
    // Batch size adapts to available RAM/CPU so weaker machines don't get hit with a
    // simultaneous burst of Chromium launches (each one is fairly heavy to start up).
    const BATCH_SIZE = this.getAdaptiveBatchSize();
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      console.log(`🚀 Connecting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(accounts.length / BATCH_SIZE)} (${batch.length} accounts)`);

      await Promise.all(batch.map(async (account) => {
        try {
          const proxy = account.proxy_host ? {
            host: account.proxy_host,
            port: account.proxy_port,
            username: account.proxy_username,
            password: account.proxy_password,
            type: 'http' as 'http' | 'socks5' // Always HTTP
          } : undefined;

          await this.connectAccount(account.id, proxy);

          // connectAccount() resolves when client.initialize() returns, but the
          // 'ready' event (and full WhatsApp Web readiness) fires asynchronously
          // AFTER that. Wait for the account to become truly ready before
          // counting it as completed so the startup loader reflects real state.
          //
          // This timeout needs to be generous: at startup, several heavy
          // Chromium/WhatsApp-Web instances are loading concurrently (see
          // getAdaptiveBatchSize), and later batches start under even more
          // system load than the manual "Reconnect" flow (which has no
          // timeout at all and just waits). A too-short timeout here causes
          // us to destroy a client - and its still-valid WhatsApp session -
          // simply because it needed a bit longer to finish loading under
          // contention, even though the account is still linked on WhatsApp's
          // side. A genuinely broken session (auth failure/logged out) still
          // fails fast regardless of this value, since waitForAccountReady
          // resolves as soon as the client is removed from this.clients.
          const STARTUP_READY_TIMEOUT_MS = 180000; // 3 minutes
          const ready = await this.waitForAccountReady(account.id, STARTUP_READY_TIMEOUT_MS);
          if (ready) {
            this.initProgress.completed++;
          } else {
            console.warn(`⚠️ Account ${account.id.substring(0, 8)} did not become ready within ${STARTUP_READY_TIMEOUT_MS / 1000}s - marking as disconnected`);
            // Explicitly mark as disconnected so the UI reflects the real state
            this.updateAccountStatus(account.id, 'disconnected');
            // Tear down the stuck client to free resources
            try {
              await this.cleanupAccountResources(account.id, this.clients.get(account.id));
            } catch (cleanupError) {
              console.error(`Cleanup error for account ${account.id}:`, cleanupError);
            }
            this.initProgress.failed++;
          }
        } catch (error) {
          console.error(`Failed to reconnect account ${account.id}:`, error);
          this.updateAccountStatus(account.id, 'disconnected');
          this.initProgress.failed++;
        }
        this.emitInitProgress();
      }));
    }

    this.initProgress.isComplete = true;
    this.emitInitProgress();
    console.log(`✅ Initialization complete: ${this.initProgress.completed} connected, ${this.initProgress.failed} failed`);
  }

  async connectAccount(accountId: string, proxy?: ProxyConfig, pairingMethod: 'qr' | 'code' = 'qr'): Promise<void> {
    console.log('🔵 connectAccount called for:', accountId, 'method:', pairingMethod);

    if (this.connectingAccounts.has(accountId)) {
      throw new Error('Account connection is already in progress');
    }

    this.connectingAccounts.add(accountId);

    try {
      const hadExistingResources = this.clients.has(accountId) || this.readyAccounts.has(accountId) || this.anonymizedProxyServers.has(accountId);
      if (hadExistingResources) {
        await this.cleanupAccountResources(accountId, this.clients.get(accountId));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      this.updateAccountStatus(accountId, 'connecting');

      const userDataPath = app.getPath('userData');
      const sessionPath = this.getSessionPath(accountId);
      console.log('📁 Session path:', sessionPath);

      this.sessionsPaths.set(accountId, sessionPath);

      let phoneNumber: string | undefined;
      let pairingCodeReceived = false;
      let lastPairingCode: string | null = null;
      if (pairingMethod === 'code') {
        const stmt = this.db.prepare('SELECT phone_number FROM accounts WHERE id = ?');
        const account = stmt.get(accountId) as any;
        phoneNumber = account?.phone_number?.replace(/\D/g, '');
        console.log('📞 Phone number for pairing:', phoneNumber);
      }

      console.log('🔍 Looking for Chrome/Chromium...');
      const chromePath = await getOrDownloadChromium();
      console.log('✅ Using browser:', chromePath);

      const clientOptions: any = {
        authStrategy: new LocalAuth({
          clientId: accountId,
          dataPath: path.join(userDataPath, 'sessions')
        }),
        // Tried 'none' (always live) -> broke pairing code for every account.
        // Tried pinning to specific HTML snapshots via the wa-version archive
        // (both whatsapp-web.js's own bundled-default version and the
        // previously-used 2.2412.54 pin) -> both snapshots have since been
        // pruned from that archive (404), so pinning to an exact file isn't
        // viable right now. Deliberately NOT overriding webVersionCache here
        // at all - this lets whatsapp-web.js use its own untouched default
        // (type: 'local', see node_modules/whatsapp-web.js/src/util/Constants.js).
        // If pairing code still fails with zero customization on our end, that
        // confirms it's not something any client-side config can fix (points
        // to the WhatsApp-side IQErrorRateOverlimit block, see whatsapp-web.js
        // issue #3763) rather than a setting we're getting wrong.
        //
        // takeoverOnConflict previously forced this client to kick out any other
        // active session for the same account after 60s. That's aggressive "double
        // activity" behavior WhatsApp's abuse detection watches for. Disabling it
        // means a genuine conflict just disconnects gracefully (see 'disconnected'
        // handler) instead of fighting for the session.
        restartOnAuthFail: true,
        takeoverOnConflict: false,
        // userAgent: false disables whatsapp-web.js's own default UA override
        // (util/Constants.js ships a hardcoded, years-old Chrome/Mac string). Without
        // this, every account's page would claim to be that stale UA while actually
        // running whatever real Chrome/Chromium version is installed - a mismatch
        // that's a classic automation fingerprint. false lets the real browser's own
        // accurate UA pass through untouched.
        userAgent: false,
        puppeteer: {
          headless: true,
          executablePath: chromePath,
          // Realistic desktop viewport - puppeteer's 800x600 default is a common
          // automation fingerprint that doesn't match real desktop usage.
          defaultViewport: { width: 1366, height: 768 },
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            // Resource-saving flags: disable Chrome background services/telemetry
            // that are irrelevant to headless WhatsApp Web automation, to reduce
            // per-account CPU/RAM/network overhead when many accounts are connected.
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-client-side-phishing-detection',
            '--disable-domain-reliability',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-sync',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-notifications',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--no-pings',
            '--password-store=basic',
            '--mute-audio',
            '--disk-cache-size=0',
            '--memory-pressure-off',
            '--disable-features=Translate,TranslateUI'
          ]
        }
      };

      if (pairingMethod === 'code' && phoneNumber) {
        console.log('📞 Pairing code mode enabled for:', phoneNumber);
      }

      if (proxy) {
        const proxyHost = proxy.host.replace(/^https?:\/\//i, '').replace(/\/$/, '');
        console.log('🌐 Setting up HTTP proxy...');

        if (proxy.username && proxy.password) {
          console.log('🔐 Setting up authenticated HTTP proxy via proxy-chain...');

          try {
            const upstreamProxyUrl = `http://${proxy.username}:${proxy.password}@${proxyHost}:${proxy.port}`;
            console.log(`📡 Upstream proxy: http://${proxy.username}@${proxyHost}:${proxy.port}`);

            const anonymizedProxyUrl = await proxyChain.anonymizeProxy(upstreamProxyUrl);
            console.log(`✅ Anonymous local proxy created: ${anonymizedProxyUrl}`);

            const match = anonymizedProxyUrl.match(/:(\d+)$/);
            if (match) {
              const localPort = parseInt(match[1]);
              const server = (proxyChain as any).servers?.get(localPort);
              if (server) {
                this.anonymizedProxyServers.set(accountId, server);
              }
            }

            clientOptions.puppeteer.args.push(`--proxy-server=${anonymizedProxyUrl}`);
            console.log(`✅ Proxy configured with authentication support`);
          } catch (proxyError) {
            console.error('❌ Failed to set up proxy-chain:', proxyError);
            throw new Error('Failed to configure proxy. Please check your proxy credentials.');
          }
        } else {
          clientOptions.puppeteer.args.push(`--proxy-server=http://${proxyHost}:${proxy.port}`);
          console.log(`✅ HTTP Proxy configured (no auth): http://${proxyHost}:${proxy.port}`);
        }
      }

      console.log('🔌 Creating WhatsApp client...');
      const client = new Client(clientOptions);

      this.clients.set(accountId, client);

      this.grantWebPermissions(accountId, client);

      const pairingTag = `[Pairing:${accountId.substring(0, 8)}]`;
      const publishPairingCode = (code: string) => {
        if (!this.isTrackedClient(accountId, client) || !code || code === lastPairingCode) {
          return;
        }

        lastPairingCode = code;
        pairingCodeReceived = true;
        console.log(`${pairingTag} 🔢 Pairing code received from WhatsApp:`, code);

        const stmt = this.db.prepare('UPDATE accounts SET pairing_code = ?, status = ? WHERE id = ?');
        stmt.run(code, 'pairing', accountId);

        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          console.log('📤 Sending pairing code to renderer:', code);
          mainWindow.webContents.send('account:pairing', accountId, code);
          console.log('✅ Pairing code sent to renderer');
        }
      };

      if (pairingMethod === 'code' && phoneNumber) {
        this.setupPairingDebugLogging(accountId, client);
      }

      client.on('qr', async (qr) => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        if (pairingMethod === 'code') {
          console.log(`${pairingTag} ℹ️ QR event fired while waiting for pairing code - ignoring QR because this account was started in pairing-code mode`);
          return;
        }

        console.log('📱 QR code received, generating data URL...');
        const qrDataURL = await QRCode.toDataURL(qr);
        console.log('✅ QR code generated');

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        this.updateAccountStatus(accountId, 'qr', qrDataURL);

        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          console.log('📤 Sending QR to renderer...');
          mainWindow.webContents.send('account:qr', accountId, qrDataURL);
          console.log('✅ QR sent to renderer');
        }
      });

      client.on('code', (code: string) => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        console.log(`${pairingTag} 🔢 'code' event fired`);
        publishPairingCode(code);
      });

      // whatsapp-web.js's internal pairing-code request (fired from inside
      // client.initialize(), see requestPairingCode) is a fire-and-forget
      // page.evaluate() call, so a failure there never surfaces to the UI -
      // the user is just left staring at a spinner forever. We do ONE retry
      // to cover the rare "page context not ready yet" race.
      //
      // IMPORTANT: if this keeps failing on every attempt (including the
      // retry) it is almost certainly NOT a timing race - WhatsApp's servers
      // return an internal IQErrorRateOverlimit (429 rate-overlimit) for a
      // phone number/device once too many pairing-code requests were made,
      // and this block is reportedly persistent (see whatsapp-web.js issue
      // #3763). Retrying repeatedly in that case only sends more requests
      // against an already-limited number and cannot help - so we deliberately
      // do NOT loop here. If it fails, surface it and let the user fall back
      // to QR code (a separate, unaffected code path) or try again later.
      if (pairingMethod === 'code' && phoneNumber) {
        console.log(`${pairingTag} ⏳ Watchdog armed - will check for pairing code again in 15s if none received`);
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 15000));

          if (pairingCodeReceived) {
            console.log(`${pairingTag} ✅ Watchdog check: code already received, no retry needed`);
            return;
          }
          if (!this.isTrackedClient(accountId, client)) {
            console.log(`${pairingTag} ℹ️ Watchdog check: client no longer tracked (disconnected/replaced), skipping retry`);
            return;
          }

          const page = (client as any).pupPage;
          if (!page) {
            console.log(`${pairingTag} ⚠️ Watchdog check: no pupPage available at all, cannot retry`);
            return;
          }

          let pageUrl = 'unknown';
          let pageClosed = 'unknown';
          try { pageUrl = page.url(); } catch { /* ignore */ }
          try { pageClosed = String(page.isClosed?.()); } catch { /* ignore */ }
          console.log(`${pairingTag} ⚠️ Pairing code not received after 15s. Page URL: ${pageUrl}, closed: ${pageClosed}. Re-running module diagnostic before retry...`);

          try {
            const diagnostic = await page.evaluate(() => {
              const hasRequire = typeof (window as any).require === 'function';
              let hasAltLinkingModule = false;
              let moduleError: string | null = null;
              if (hasRequire) {
                try {
                  hasAltLinkingModule = !!(window as any).require('WAWebAltDeviceLinkingApi');
                } catch (e: any) {
                  moduleError = e?.message || String(e);
                }
              }
              return { hasRequire, hasAltLinkingModule, moduleError };
            });
            console.log(`${pairingTag} 🔬 Pre-retry diagnostic:`, JSON.stringify(diagnostic));
          } catch (diagError: any) {
            console.log(`${pairingTag} ⚠️ Pre-retry diagnostic evaluate failed:`, diagError?.message || diagError);
          }

          // Calling client.requestPairingCode() here (like the first attempt) crosses
          // the CDP boundary as a thrown exception, and WA Web is a minified production
          // bundle - whatever custom error class/object it throws gets serialized down
          // to a generic Error with mangled name/message ("t: t", no real detail, as
          // seen in testing). Instead, we call the SAME underlying WAWebAltDeviceLinkingApi
          // functions ourselves directly inside the page with our own try/catch, so the
          // real thrown value's full shape (e.g. WhatsApp's CompanionHelloError/
          // IQErrorRateOverlimit structure from whatsapp-web.js issue #3763) survives
          // JSON serialization back to Node instead of being lost.
          console.log(`${pairingTag} 🔬 Directly invoking WAWebAltDeviceLinkingApi ourselves to capture the real error...`);
          try {
            const directResult: any = await page.evaluate(async (phoneNum: string, showNotif: boolean) => {
              try {
                const api = (window as any).require('WAWebAltDeviceLinkingApi');
                api.setPairingType('ALT_DEVICE_LINKING');
                await api.initializeAltDeviceLinking();
                const code = await api.startAltLinkingFlow(phoneNum, showNotif);
                return { success: true, code };
              } catch (e: any) {
                const ownProps: any = {};
                try {
                  for (const key of Object.getOwnPropertyNames(e)) {
                    try { ownProps[key] = e[key]; } catch { /* skip unserializable prop */ }
                  }
                } catch { /* ignore */ }
                let serialized = '';
                try { serialized = JSON.stringify(ownProps); } catch { serialized = '(not JSON-serializable)'; }
                return {
                  success: false,
                  name: e?.name,
                  message: e?.message,
                  ownProps: serialized,
                  stringified: String(e)
                };
              }
            }, phoneNumber, true);

            if (directResult.success) {
              console.log(`${pairingTag} ✅ Direct invocation succeeded, code:`, directResult.code);
              publishPairingCode(directResult.code);
            } else {
              console.error(`${pairingTag} ❌ Direct invocation failed - real error detail:`);
              console.error(`${pairingTag}    name: ${directResult.name}`);
              console.error(`${pairingTag}    message: ${directResult.message}`);
              console.error(`${pairingTag}    own properties: ${directResult.ownProps}`);
              console.error(`${pairingTag}    toString(): ${directResult.stringified}`);
            }
          } catch (evalError: any) {
            console.error(`${pairingTag} ❌ Direct invocation's own evaluate() call threw (unexpected):`, evalError?.message || evalError);
          }
        })();
      }

      client.on('ready', async () => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        // whatsapp-web.js's 'ready' event can fire more than once per client (e.g. the
        // page-side 'onAppStateHasSyncedEvent' resync it's tied to can re-fire after a
        // network blip) - see Client.js's onAppStateHasSyncedEvent handler. Without this
        // guard, the whole ready sequence below (including campaignScheduler.onAccountReady,
        // which can schedule/send a message) would re-run every time, risking duplicate
        // sends for the same account in quick succession - exactly the kind of "double
        // activity" pattern that can trigger WhatsApp to log the account out.
        if (this.readyAccounts.has(accountId)) {
          console.log('ℹ️ Ready event fired again for an already-ready account - ignoring duplicate');
          return;
        }

        console.log('🟢 WhatsApp client is ready!');

        (client as any).sendSeen = async () => {};

        const page = (client as any).pupPage;
        if (page) {
          await page.evaluate(() => {
            (window as any).WWebJS.sendSeen = async () => {};
          });
          console.log('✅ sendSeen disabled at page level');
        }

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        this.updateAccountStatus(accountId, 'connected');

        if (this.campaignScheduler) {
          void this.campaignScheduler.onAccountReady(accountId);
        }

        const info = (client as any).info;
        if (info?.wid?._serialized) {
          const resolvedPhoneNumber = info.wid._serialized.split('@')[0];
          console.log('📞 Phone number:', resolvedPhoneNumber);
          const stmt = this.db.prepare('UPDATE accounts SET phone_number = ? WHERE id = ?');
          stmt.run(resolvedPhoneNumber, accountId);
        }

        try {
          await new Promise(resolve => setTimeout(resolve, 3000));

          if (!this.isTrackedClient(accountId, client)) {
            return;
          }

          const currentInfo = (client as any).info;
          const myWid = currentInfo?.wid?._serialized;

          if (myWid) {
            try {
              console.log('📷 Getting profile picture for WID:', myWid);
              const contact = await client.getContactById(myWid);
              const profilePicUrl = await contact.getProfilePicUrl();

              if (!this.isTrackedClient(accountId, client)) {
                return;
              }

              if (profilePicUrl && typeof profilePicUrl === 'string') {
                console.log('✅ Profile picture URL:', profilePicUrl.substring(0, 50) + '...');
                const picStmt = this.db.prepare('UPDATE accounts SET profile_picture_url = ? WHERE id = ?');
                picStmt.run(profilePicUrl, accountId);
              } else {
                console.log('📷 No profile picture set for this account');
              }
            } catch (contactError) {
              console.log('📷 Could not get profile picture via contact method');
            }
          }
        } catch (picError) {
          console.log('📷 Profile picture fetch failed (this is normal if no picture is set)');
        }

        console.log('⏳ Waiting for WhatsApp Web to fully initialize...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        this.readyAccounts.add(accountId);
        console.log('✅ WhatsApp Web fully ready for messaging');
      });

      client.on('authenticated', async () => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        console.log('✅ Authenticated');

        (client as any).sendSeen = async () => {};
        console.log('✅ sendSeen disabled on client');

        setTimeout(async () => {
          if (!this.isTrackedClient(accountId, client)) {
            return;
          }

          try {
            const page = (client as any).pupPage;
            if (page) {
              await page.evaluate(() => {
                if ((window as any).WWebJS) {
                  (window as any).WWebJS.sendSeen = async () => {};
                }
              });
              console.log('✅ sendSeen disabled at page level');
            }
          } catch (e) {
            console.log('⚠️ Could not disable sendSeen at page level (yet)');
          }
        }, 5000);

        setTimeout(async () => {
          if (!this.isTrackedClient(accountId, client) || this.readyAccounts.has(accountId)) {
            return;
          }

          console.log('⚠️ Ready event not fired after 30s, attempting manual verification...');
          try {
            const state = await client.getState();
            if (state === 'CONNECTED') {
              (client as any).sendSeen = async () => {};
              console.log('✅ sendSeen disabled (fallback)');

              const page = (client as any).pupPage;
              if (page) {
                try {
                  await page.evaluate(() => {
                    (window as any).WWebJS.sendSeen = async () => {};
                  });
                  console.log('✅ sendSeen disabled at page level (fallback)');
                } catch (e) {
                  console.log('⚠️ Could not disable sendSeen at page level');
                }
              }

              if (!this.isTrackedClient(accountId, client)) {
                return;
              }

              const chats = await client.getChats();
              if (chats && chats.length >= 0) {
                console.log(`✅ Manual verification passed for ${accountId} (${chats.length} chats)`);
                this.updateAccountStatus(accountId, 'connected');
                this.readyAccounts.add(accountId);
                console.log('✅ Account marked as ready (fallback)');
              }
            }
          } catch (error: any) {
            console.log(`⚠️ Manual verification failed for ${accountId}: ${error.message}`);
          }
        }, 30000);
      });

      client.on('auth_failure', async (msg) => {
        console.error(`${pairingTag} ❌ Authentication failure:`, msg);

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        await this.cleanupAccountResources(accountId, client);
        this.updateAccountStatus(accountId, 'disconnected');
      });

      client.on('disconnected', async (reason) => {
        console.log(`${pairingTag} 🔴 Disconnected:`, reason, `(pairing code received before disconnect: ${pairingCodeReceived})`);

        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        await this.cleanupAccountResources(accountId, client);
        this.updateAccountStatus(accountId, 'disconnected');
      });

      client.on('message_create', async (message) => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        const isFromMe = this.isMessageFromMe(message);

        console.log('\n📨 ==================== NEW MESSAGE ====================');
        console.log('Message from:', message.from);
        console.log('Is from me:', isFromMe);
        console.log('Message body:', message.body?.substring(0, 50));
        console.log('======================================================\n');

        if (!isFromMe) {
          return;
        }

        await this.handleIncomingMessage(accountId, message);
      });

      client.on('message', async (message) => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        console.log('📩 message event fired:', message.from);
        await this.handleIncomingMessage(accountId, message);
      });

      client.on('loading_screen', (percent) => {
        if (!this.isTrackedClient(accountId, client)) {
          return;
        }

        console.log('⏳ Loading:', percent + '%');
      });

      console.log('✅ Event listeners registered');
      if (pairingMethod === 'code' && phoneNumber) {
        console.log(`${pairingTag} ⏳ Calling client.initialize() for manual pairing-code flow with phone number: ${phoneNumber}`);
      } else {
        console.log('⏳ Initializing client...');
      }

      try {
        await client.initialize();
        console.log('✅ Client initialized (this only reflects the outer initialize() call resolving - see the [Pairing:...] logs above for the actual pairing-code request outcome, since that runs fire-and-forget inside initialize() and does not reject it on failure)');
        if (pairingMethod === 'code' && phoneNumber) {
          this.requestPairingCodeAfterInitialize(accountId, client, phoneNumber, 180000);
        }
      } catch (error: any) {
        console.error(`${pairingTag} ❌ Error initializing client:`, error?.message || error);
        if (error?.stack) console.error(`${pairingTag} ❌ Stack:`, error.stack);
        await this.cleanupAccountResources(accountId, client);
        throw error;
      }
    } finally {
      this.connectingAccounts.delete(accountId);
    }
  }

  async disconnectAccount(accountId: string): Promise<void> {
    await this.cleanupAccountResources(accountId, this.clients.get(accountId));
    this.updateAccountStatus(accountId, 'disconnected');
  }

  async sendMessage(accountId: string, to: string, message: string, isWarmup: boolean = false): Promise<void> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    // Check if client is truly ready
    const state = await client.getState();
    if (state !== 'CONNECTED') {
      throw new Error(`Account not ready. Current state: ${state}`);
    }

    console.log('📤 Sending message to:', to);
    console.log('📤 Message text:', message ? `"${message.substring(0, 100)}"` : 'EMPTY');
    console.log('📤 Message length:', message?.length || 0);
    console.log('📤 Is warmup:', isWarmup);
    
    const normalizedTarget = await this.normalizeSendTarget(accountId, to);
    let chatIdToSend = normalizedTarget.chatIdToSend;
    let originalChatId = normalizedTarget.originalChatId;

    if (!to.includes('@')) {
      console.log('📤 Formatted to @c.us:', chatIdToSend);
    } else if (to.includes('@lid')) {
      console.log('✅ Converted @lid to @c.us:', chatIdToSend);
    } else {
      console.log('✅ Using chat ID as-is:', chatIdToSend);
    }

    // Mark message as "being sent" BEFORE sending to prevent race condition duplicates
    const sentKey = `${accountId}:${message}`;
    this.recentlySentMessages.set(sentKey, Date.now());
    
    // Simulate typing for all text messages (2-5 seconds random delay)
    try {
      const typingSeconds = Math.floor(Math.random() * (5 - 2 + 1)) + 2; // Random between 2-5
      console.log(`⌨️ Simulating typing for ${typingSeconds} seconds...`);
      
      const chat = await client.getChatById(chatIdToSend);
      await chat.sendStateTyping();
      
      // Wait for random typing duration
      await new Promise(resolve => setTimeout(resolve, typingSeconds * 1000));
      
      // Clear typing state
      await chat.clearState();
      console.log('✅ Typing simulation completed');
    } catch (typingError) {
      // Don't fail if typing simulation fails - just continue
      console.log('⚠️ Typing simulation failed, continuing anyway:', typingError);
    }
    
    // Send message directly with error handling and retry logic
    const maxRetries = 5;
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📨 Sending to: ${chatIdToSend} (attempt ${attempt}/${maxRetries})`);
        // Send directly without getChatById - works for both new and existing contacts
        await client.sendMessage(chatIdToSend, message);
        console.log('✅ Message sent successfully');
        lastError = null;
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.message?.toLowerCase() || '';
        console.log(`❌ Send attempt ${attempt} failed: ${error.message}`);
        
        // Check if account is banned or restricted - don't retry
        if (errorMsg.includes('banned') || errorMsg.includes('restricted') || errorMsg.includes('blocked')) {
          console.error('❌ Account appears to be banned/restricted');
          this.updateAccountStatus(accountId, 'disconnected');
          throw new Error('Account has been banned or restricted by WhatsApp');
        }
        
        // Check if number doesn't exist on WhatsApp - don't retry
        if (errorMsg.includes('no lid for user') || 
            errorMsg.includes('phone number not registered') ||
            errorMsg.includes('number is not on whatsapp')) {
          console.error('❌ Phone number not registered on WhatsApp - skipping');
          throw new Error('Phone number not registered on WhatsApp');
        }
        
        // Retry on any error (WhatsApp Web might not be fully loaded)
        if (attempt < maxRetries) {
          const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s
          console.log(`⚠️ Retrying in ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        console.error('⚠️ Failed after all retries');
        throw new Error('WhatsApp Web is not ready. Please wait a moment and try again.');
      }
    }
    
    if (lastError) {
      throw lastError;
    }

    // Save message to database using @c.us format (to group with incoming messages)
    const messageId = uuidv4();
    
    const myNumber = (client as any).info?.wid?._serialized?.split('@')[0] || '';
    const myName = (client as any).info?.pushname || null;
    
    // Use chatIdToSend (@c.us) for DB to match incoming message format
    const toNumber = normalizedTarget.resolvedPhone || chatIdToSend.split('@')[0];
    const timestamp = new Date().toISOString();
    
    // Find or create software chat
    const softwareChatId = await this.chatManager.findOrCreateChat(toNumber, accountId, client, null);
    this.chatManager.updateLastMessageAt(softwareChatId, timestamp);
    
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, account_id, chat_id, from_number, to_number, sender_name, message_text, is_from_me, is_warmup, is_read, software_chat_id, type, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, 'text', ?)
    `);
    
    console.log('💾 Saving with chat_id:', chatIdToSend, 'to number:', toNumber, isWarmup ? '(WarmUp)' : '');
    stmt.run(messageId, accountId, chatIdToSend, myNumber, toNumber, myName, message, isWarmup ? 1 : 0, softwareChatId, timestamp);
    
    // Mark all previous incoming messages in this chat as handled (we replied = read)
    const markHandledStmt = this.db.prepare(`
      UPDATE messages SET is_handled = 1
      WHERE chat_id = ? AND account_id = ? AND is_from_me = 0 AND is_handled = 0
    `);
    markHandledStmt.run(chatIdToSend, accountId);
    
    console.log('✅ Message saved to database');
  }

  async sendMedia(accountId: string, to: string, filePath: string, caption?: string): Promise<void> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    // Check if client is truly ready
    const state = await client.getState();
    if (state !== 'CONNECTED') {
      throw new Error(`Account not ready. Current state: ${state}`);
    }

    console.log('📤 Sending media to:', to);
    
    const normalizedTarget = await this.normalizeSendTarget(accountId, to);
    let chatIdToSend = normalizedTarget.chatIdToSend;
    let originalChatId = normalizedTarget.originalChatId;

    if (!to.includes('@')) {
      console.log('📤 Formatted to @c.us:', chatIdToSend);
    } else if (to.includes('@lid')) {
      console.log('✅ Converted @lid to @c.us:', chatIdToSend);
    } else {
      console.log('✅ Using chat ID as-is:', chatIdToSend);
    }

    // Mark message as "being sent" BEFORE sending to prevent race condition duplicates
    const sentKey = `${accountId}:${caption || ''}`;
    this.recentlySentMessages.set(sentKey, Date.now());
    
    // Send media directly with error handling and retry logic
    const maxRetries = 5;
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📨 Sending media to: ${chatIdToSend} (attempt ${attempt}/${maxRetries})`);
        
        const media = MessageMedia.fromFilePath(filePath);
        // Send directly without getChatById - works for both new and existing contacts
        await client.sendMessage(chatIdToSend, media, { caption: caption || '' });
        console.log('✅ Media sent successfully');
        lastError = null;
        break; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.message?.toLowerCase() || '';
        console.log(`❌ Send media attempt ${attempt} failed: ${error.message}`);
        
        // Check if account is banned or restricted - don't retry
        if (errorMsg.includes('banned') || errorMsg.includes('restricted') || errorMsg.includes('blocked')) {
          console.error('❌ Account appears to be banned/restricted');
          this.updateAccountStatus(accountId, 'disconnected');
          throw new Error('Account has been banned or restricted by WhatsApp');
        }
        
        // Check if number doesn't exist on WhatsApp - don't retry
        if (errorMsg.includes('no lid for user') || 
            errorMsg.includes('phone number not registered') ||
            errorMsg.includes('number is not on whatsapp')) {
          console.error('❌ Phone number not registered on WhatsApp - skipping');
          throw new Error('Phone number not registered on WhatsApp');
        }
        
        // Retry on any error
        if (attempt < maxRetries) {
          const waitTime = attempt * 5000; // 5s, 10s, 15s, 20s
          console.log(`⚠️ Retrying in ${waitTime/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        console.error('⚠️ Failed after all retries');
        throw new Error('WhatsApp Web is not ready. Please wait a moment and try again.');
      }
    }
    
    if (lastError) {
      throw lastError;
    }

    // Extract file information and copy to media directory
    const pathModule = await import('path');
    const fsModule = await import('fs');
    const { app } = await import('electron');
    
    const mediaInfo = MessageMedia.fromFilePath(filePath);
    const mimetype = mediaInfo.mimetype || 'application/octet-stream';
    const messageType = mimetype.startsWith('image/') ? 'image' 
                      : mimetype.startsWith('video/') ? 'video'
                      : 'document';
    
    // Generate unique filename and copy file to media directory
    const messageId = uuidv4();
    const extension = pathModule.extname(filePath);
    const mediaFilename = `${messageId}_${Date.now()}${extension}`;
    
    const mediaDir = pathModule.join(app.getPath('userData'), 'media');
    
    // Ensure media directory exists
    if (!fsModule.existsSync(mediaDir)) {
      fsModule.mkdirSync(mediaDir, { recursive: true });
    }
    
    // Copy file to media directory
    const destPath = pathModule.join(mediaDir, mediaFilename);
    fsModule.copyFileSync(filePath, destPath);
    console.log('📁 Copied media file to:', destPath);
    
    // Save message to database
    const myNumber = (client as any).info?.wid?._serialized?.split('@')[0] || '';
    const myName = (client as any).info?.pushname || null;
    
    // Use chatIdToSend (@c.us) for DB to match incoming message format
    const toNumber = normalizedTarget.resolvedPhone || chatIdToSend.split('@')[0];
    const timestamp = new Date().toISOString();
    
    // Find or create software chat
    const softwareChatId = await this.chatManager.findOrCreateChat(toNumber, accountId, client, null);
    this.chatManager.updateLastMessageAt(softwareChatId, timestamp);
    
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, account_id, chat_id, from_number, to_number, sender_name, message_text, message_type, media_filename, media_mimetype, is_from_me, is_read, software_chat_id, type, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
    `);
    
    console.log('💾 Saving media with chat_id:', chatIdToSend, 'to number:', toNumber);
    stmt.run(messageId, accountId, chatIdToSend, myNumber, toNumber, myName, caption || null, messageType, mediaFilename, mimetype, softwareChatId, messageType, timestamp);
    console.log('✅ Media saved to database');
  }

  async getQRCode(accountId: string): Promise<string> {
    const stmt = this.db.prepare('SELECT qr_code FROM accounts WHERE id = ?');
    const result = stmt.get(accountId) as any;
    return result?.qr_code || '';
  }

  async updateWhatsAppName(accountId: string, name: string): Promise<void> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    console.log('📝 Updating WhatsApp name to:', name);
    await client.setDisplayName(name);
    console.log('✅ Name updated successfully');
  }

  async sendMediaFromPath(accountId: string, to: string, filePath: string, caption?: string, isWarmup: boolean = false): Promise<void> {
    // Simply call sendMedia - it already handles everything we need
    await this.sendMedia(accountId, to, filePath, caption);
    // Note: sendMedia doesn't save to DB, which is fine for campaigns
    // The campaign scheduler tracks sends in campaign_contacts table instead
  }

  async refreshProfilePicture(accountId: string): Promise<void> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    try {
      console.log('🔄 Refreshing profile picture for account:', accountId);
      
      // Method 1: Try getting own profile picture through contact
      try {
        const info = (client as any).info;
        const myWid = info?.wid?._serialized;
        
        if (myWid) {
          console.log('📞 Getting profile picture for WID:', myWid);
          
          // Get contact object
          const contact = await client.getContactById(myWid);
          const profilePicUrl = await contact.getProfilePicUrl();
          
          if (profilePicUrl && typeof profilePicUrl === 'string') {
            const stmt = this.db.prepare('UPDATE accounts SET profile_picture_url = ? WHERE id = ?');
            stmt.run(profilePicUrl, accountId);
            console.log('✅ Profile picture refreshed:', profilePicUrl.substring(0, 60) + '...');
            return;
          }
        }
      } catch (methodError) {
        console.log('⚠️ Method 1 failed, trying Method 2...', methodError.message);
      }
      
      // Method 2: Try direct client method
      const myWid = (client as any).info?.wid?._serialized;
      const profilePicUrl = myWid ? await client.getProfilePicUrl(myWid) : null;
      
      if (profilePicUrl && typeof profilePicUrl === 'string') {
        const stmt = this.db.prepare('UPDATE accounts SET profile_picture_url = ? WHERE id = ?');
        stmt.run(profilePicUrl, accountId);
        console.log('✅ Profile picture refreshed (Method 2)');
      } else {
        console.log('📷 No profile picture available');
        const stmt = this.db.prepare('UPDATE accounts SET profile_picture_url = NULL WHERE id = ?');
        stmt.run(accountId);
      }
      
    } catch (error: any) {
      console.log('📷 No profile picture for this account:', error.message);
      
      // נקה מה-DB
      const stmt = this.db.prepare('UPDATE accounts SET profile_picture_url = NULL WHERE id = ?');
      stmt.run(accountId);
    }
  }

  async updateWhatsAppProfilePicture(accountId: string, imagePath: string): Promise<void> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    console.log('📷 Updating WhatsApp profile picture:', imagePath);
    const media = MessageMedia.fromFilePath(imagePath);
    await client.setProfilePicture(media);
    console.log('✅ Profile picture updated successfully');
    
    // Get the new profile picture URL and save to database
    try {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for WhatsApp to update
      const myWid = (client as any).info?.wid?._serialized;
      const profilePicUrl = myWid ? await client.getProfilePicUrl(myWid) : null;
      
      if (profilePicUrl && typeof profilePicUrl === 'string') {
        const stmt = this.db.prepare('UPDATE accounts SET profile_picture_url = ? WHERE id = ?');
        stmt.run(profilePicUrl, accountId);
        console.log('✅ New profile picture URL saved to database');
      }
    } catch (error) {
      console.log('📷 Could not get updated profile picture URL (might not be set)');
    }
  }

  getConnection(accountId: string): Client | undefined {
    return this.clients.get(accountId);
  }

  private extractDigits(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const normalizedValue = value.includes('@') ? value.split('@')[0] : value;
    return normalizedValue.replace(/\D/g, '');
  }

  private getDirectPhoneFallback(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return '';
    }

    if (normalizedValue.endsWith('@lid') || normalizedValue.endsWith('@g.us') || normalizedValue.endsWith('@broadcast') || normalizedValue.endsWith('@newsletter')) {
      return '';
    }

    if (normalizedValue.endsWith('@c.us')) {
      return this.extractDigits(normalizedValue);
    }

    if (!normalizedValue.includes('@')) {
      return this.extractDigits(normalizedValue);
    }

    return '';
  }

  private async resolvePhoneFromHistory(accountId: string, chatId: string): Promise<string> {
    const client = this.clients.get(accountId);
    const myNumber = this.extractDigits((client as any)?.info?.wid?._serialized || '');

    try {
      const rows = this.db.prepare(`
        SELECT from_number, to_number, is_from_me
        FROM messages
        WHERE account_id = ? AND chat_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      `).all(accountId, chatId) as any[];

      for (const row of rows) {
        const candidate = row?.is_from_me ? row?.to_number : row?.from_number;
        const digits = this.extractDigits(candidate || '');

        if (digits && digits !== myNumber) {
          return digits;
        }
      }
    } catch (error) {
      console.log('⚠️ Could not resolve phone from message history:', error);
    }

    return '';
  }

  async resolvePhoneNumber(accountId: string, identifier: string, message?: any): Promise<string> {
    const client = this.clients.get(accountId);
    const candidates = new Set<string>();

    if (identifier) {
      candidates.add(identifier);
    }
    if (message?.from && !message?.fromMe) {
      candidates.add(message.from);
    }
    if (message?.author) {
      candidates.add(message.author);
    }
    if (message?.fromMe && message?.to) {
      candidates.add(message.to);
    }

    for (const candidate of candidates) {
      const directPhone = this.getDirectPhoneFallback(candidate);
      if (directPhone) {
        return directPhone;
      }

      if (!candidate.includes('@') || candidate.endsWith('@g.us') || candidate.endsWith('@broadcast') || candidate.endsWith('@newsletter')) {
        continue;
      }

      if (client && typeof (client as any).getContactLidAndPhone === 'function') {
        try {
          const result = await (client as any).getContactLidAndPhone([candidate]);
          const resolvedPhone = Array.isArray(result) ? result[0]?.pn : result?.pn;
          const digits = this.extractDigits(resolvedPhone || '');

          if (digits) {
            return digits;
          }
        } catch (error) {
          console.log('⚠️ Could not resolve LID to phone:', error);
        }
      }

      const phoneFromHistory = await this.resolvePhoneFromHistory(accountId, candidate);
      if (phoneFromHistory) {
        return phoneFromHistory;
      }
    }

    if (message && typeof message.getContact === 'function') {
      try {
        const contact = await message.getContact();
        const contactId = contact?.id?._serialized;

        if (contactId && contactId !== identifier) {
          const resolvedPhone = await this.resolvePhoneNumber(accountId, contactId);
          if (resolvedPhone) {
            return resolvedPhone;
          }
        }
      } catch (error) {
        console.log('⚠️ Could not resolve phone via contact:', error);
      }
    }

    return this.getDirectPhoneFallback(identifier);
  }

  async resolveContactData(accountId: string, identifier: string, message?: any): Promise<{ phone: string; name: string | null }> {
    let resolvedName = message?._data?.notifyName || message?._data?.pushname || null;

    if (message && typeof message.getContact === 'function') {
      try {
        const contact = await message.getContact();
        if (!resolvedName && (contact?.pushname || contact?.name)) {
          resolvedName = contact.pushname || contact.name || null;
        }
      } catch (error) {
        console.log('⚠️ Could not load contact data:', error);
      }
    }

    const phone = await this.resolvePhoneNumber(accountId, identifier, message);

    if (phone) {
      try {
        const suffix = phone.slice(-9);
        const dbContact = this.db.prepare('SELECT name FROM contacts WHERE phone_number = ? OR phone_number LIKE ?').get(phone, `%${suffix}`) as any;
        if (dbContact?.name) {
          resolvedName = dbContact.name;
        }
      } catch (error) {
        console.log('⚠️ Could not load contact name from database:', error);
      }
    }

    return { phone, name: resolvedName };
  }

  private async normalizeSendTarget(accountId: string, to: string): Promise<{ chatIdToSend: string; originalChatId: string; resolvedPhone: string }> {
    if (!to.includes('@')) {
      const cleanNumber = to.replace(/\D/g, '');

      if (!cleanNumber.startsWith('972') && !cleanNumber.startsWith('1') && !cleanNumber.startsWith('44')) {
        throw new Error('Phone number must include country code (e.g., 972501234567)');
      }

      const client = this.clients.get(accountId);
      if (!client) {
        throw new Error('Account not connected');
      }

      try {
        const numberId = await client.getNumberId(cleanNumber);
        const serializedNumberId = typeof numberId === 'string'
          ? numberId
          : numberId?._serialized;

        if (!serializedNumberId) {
          throw new Error('Phone number not registered on WhatsApp');
        }

        const resolvedPhone = cleanNumber;
        const chatIdToSend = serializedNumberId.endsWith('@lid')
          ? `${cleanNumber}@c.us`
          : serializedNumberId;

        if (serializedNumberId.endsWith('@lid')) {
          console.log(`ℹ️ Number ${cleanNumber} resolved to LID (${serializedNumberId}) - sending via ${chatIdToSend} instead`);
        }

        return {
          chatIdToSend,
          originalChatId: to,
          resolvedPhone,
        };
      } catch (error: any) {
        const message = error?.message || '';
        if (message.toLowerCase().includes('not registered')) {
          throw error;
        }

        console.log('⚠️ getNumberId failed, falling back to direct @c.us formatting:', error);
        return {
          chatIdToSend: `${cleanNumber}@c.us`,
          originalChatId: to,
          resolvedPhone: cleanNumber,
        };
      }
    }

    if (to.includes('@lid')) {
      const resolvedPhone = await this.resolvePhoneNumber(accountId, to);

      if (!resolvedPhone) {
        throw new Error('Could not resolve phone number for this WhatsApp chat');
      }

      return {
        chatIdToSend: `${resolvedPhone}@c.us`,
        originalChatId: to,
        resolvedPhone,
      };
    }

    return {
      chatIdToSend: to,
      originalChatId: to,
      resolvedPhone: this.getDirectPhoneFallback(to),
    };
  }

  isConnected(accountId: string): boolean {
    const client = this.clients.get(accountId);
    const hasClient = client && (client as any).pupPage != null;
    const isFullyReady = this.readyAccounts.has(accountId);
    return hasClient && isFullyReady;
  }

  /**
   * Polls the local `messages` table (populated by this account's WhatsApp Web session, kept
   * connected only as a linked-device observer here, never to send) for a new outgoing message
   * to `phoneNumber` timestamped at or after `afterTimestampMs`. Used to confirm that a message
   * sent through another device (e.g. a DuoPlus cloud phone) actually went through, rather than
   * just assuming success because the send command executed without error.
   *
   * Querying the DB (instead of calling `client.getChatById`) is important: WhatsApp Web can
   * index a contact's chat under a `@lid` id instead of `@c.us`, and the `message_create`
   * handler in this file already resolves that correctly via `resolvePhoneNumber` before saving
   * `to_number` to the DB - so the DB is a more reliable source of truth than guessing a chat id.
   */
  async waitForOutgoingMessage(
    accountId: string,
    phoneNumber: string,
    afterTimestampMs: number,
    timeoutMs: number = 25000,
    pollIntervalMs: number = 2000
  ): Promise<boolean> {
    const cleanNumber = this.extractDigits(phoneNumber);
    const afterIso = new Date(afterTimestampMs).toISOString();
    const deadline = Date.now() + timeoutMs;

    const stmt = this.db.prepare(`
      SELECT 1 FROM messages
      WHERE account_id = ? AND is_from_me = 1 AND to_number = ? AND timestamp >= ?
      LIMIT 1
    `);

    while (Date.now() < deadline) {
      const row = stmt.get(accountId, cleanNumber, afterIso);
      if (row) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return false;
  }

  private mapAddParticipantResultCode(rawCode: number | null | undefined, isInviteV4Sent: boolean): CampaignContactResultCode {
    if (rawCode === 200) {
      return 'added';
    }

    if (rawCode === 403) {
      return isInviteV4Sent ? 'invite_sent' : 'privacy_restricted';
    }

    if (rawCode === 404) {
      return 'not_registered';
    }

    if (rawCode === 408) {
      return 'recently_left';
    }

    if (rawCode === 409) {
      return 'already_in_group';
    }

    if (rawCode === 417) {
      return 'community_restricted';
    }

    if (rawCode === 419) {
      return 'group_full';
    }

    return 'unknown_error';
  }

  private async getGroupAccessState(accountId: string, groupId: string): Promise<GroupAccessState> {
    const client = this.clients.get(accountId);

    if (!client || !this.isConnected(accountId)) {
      throw new Error('Account not connected');
    }

    const page = (client as any).pupPage;
    if (!page) {
      throw new Error('WhatsApp page is not available');
    }

    const accessState = await page.evaluate(async (targetGroupId: string) => {
      const chatCollection = (window as any).require('WAWebCollections').Chat;
      const groupMetadataCollection =
        (window as any).require('WAWebCollections').GroupMetadata ||
        (window as any).require('WAWebCollections').WAWebGroupMetadataCollection;
      const widFactory = (window as any).require('WAWebWidFactory');
      const { toPn } = (window as any).require('WAWebLidMigrationUtils');
      const meUser =
        (window as any).require('WAWebUserPrefsMeUser').getMaybeMePnUser?.() ||
        (window as any).require('WAWebUserPrefsMeUser').getMaybeMeLidUser?.();
      const meSerialized = meUser?._serialized || meUser?.toString?.() || null;

      const chat = chatCollection.get(targetGroupId);
      if (!chat) {
        throw new Error('Chat not found');
      }

      if (!chat.groupMetadata) {
        throw new Error('Chat is not a group');
      }

      const chatWid = widFactory.createWid(targetGroupId);
      await groupMetadataCollection.update(chatWid);

      const metadata = chat.groupMetadata?.serialize?.() || {};
      const participants = Array.isArray(metadata.participants)
        ? metadata.participants.map((participant: any) => {
            const normalizedId = toPn(participant.id) ?? participant.id;
            const serializedId = normalizedId?._serialized || normalizedId?.toString?.() || '';
            return {
              id: serializedId,
              isAdmin: Boolean(participant.isAdmin)
            };
          })
        : [];

      return {
        name: chat.formattedTitle || chat.name || metadata.subject || 'Unknown Group',
        isAdmin: participants.some((participant: any) => participant.id === meSerialized && participant.isAdmin)
      };
    }, groupId);

    return {
      chat: null,
      isAdmin: Boolean(accessState?.isAdmin),
      name: accessState?.name || 'Unknown Group'
    };
  }

  async canAddParticipantsToGroup(accountId: string, groupId: string): Promise<{ ok: boolean; reason?: CampaignContactResultCode; message?: string; groupName?: string }> {
    try {
      const accessState = await this.getGroupAccessState(accountId, groupId);

      return {
        ok: true,
        groupName: accessState.name
      };
    } catch (error) {
      const message = (error as Error).message || 'Failed to access group';
      const loweredMessage = message.toLowerCase();

      if (loweredMessage.includes('not connected')) {
        return {
          ok: false,
          reason: 'account_not_connected',
          message
        };
      }

      if (loweredMessage.includes('not a group') || loweredMessage.includes('chat not found')) {
        return {
          ok: false,
          reason: 'group_not_found',
          message
        };
      }

      return {
        ok: false,
        reason: 'group_access_denied',
        message
      };
    }
  }

  async getGroups(accountId: string): Promise<WhatsAppGroupSummary[]> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    console.log('📋 Getting groups for account:', accountId);
    try {
      const page = (client as any).pupPage;
      if (!page) {
        throw new Error('WhatsApp page is not available');
      }

      const groups: WhatsAppGroupSummary[] = await page.evaluate(async () => {
        const chats = (window as any).require('WAWebCollections').Chat.getModelsArray();
        const groupMetadataCollection =
          (window as any).require('WAWebCollections').GroupMetadata ||
          (window as any).require('WAWebCollections').WAWebGroupMetadataCollection;
        const widFactory = (window as any).require('WAWebWidFactory');
        const { toPn } = (window as any).require('WAWebLidMigrationUtils');
        const meUser =
          (window as any).require('WAWebUserPrefsMeUser').getMaybeMePnUser?.() ||
          (window as any).require('WAWebUserPrefsMeUser').getMaybeMeLidUser?.();
        const meSerialized = meUser?._serialized || meUser?.toString?.() || null;

        const groupsOnly = chats.filter((chat: any) => Boolean(chat?.groupMetadata));

        return await Promise.all(
          groupsOnly.map(async (chat: any) => {
            try {
              const chatId = chat.id?._serialized;
              if (!chatId) {
                return null;
              }

              const chatWid = widFactory.createWid(chatId);
              await groupMetadataCollection.update(chatWid);

              const metadata = chat.groupMetadata?.serialize?.() || {};
              const participants = Array.isArray(metadata.participants)
                ? metadata.participants.map((participant: any) => {
                    const normalizedId = toPn(participant.id) ?? participant.id;
                    const serializedId = normalizedId?._serialized || normalizedId?.toString?.() || '';
                    return {
                      id: serializedId,
                      isAdmin: Boolean(participant.isAdmin)
                    };
                  })
                : [];

              return {
                id: chatId,
                name: chat.formattedTitle || chat.name || metadata.subject || 'WhatsApp Group',
                participantCount: participants.length,
                description: metadata.desc || '',
                isAdmin: participants.some((participant: any) => participant.id === meSerialized && participant.isAdmin)
              };
            } catch (e: any) {
              const errorDetails: any = {};
              try {
                for (const key of Object.getOwnPropertyNames(e || {})) {
                  try { errorDetails[key] = e[key]; } catch { }
                }
              } catch { }
              console.log('[LeadSender:getGroups] Skipping broken group model:', chat?.id?._serialized, String(e), JSON.stringify(errorDetails));
              return null;
            }
          })
        ).then((results: any[]) => results.filter(Boolean));
      });

      console.log(`✅ Found ${groups.length} groups`);
      return groups;
    } catch (error) {
      console.error('Failed to get groups:', error);
      throw error;
    }
  }

  private extractInviteCode(inviteLink: string): string {
    const trimmedInvite = inviteLink.trim();

    if (!trimmedInvite) {
      throw new Error('Invite link is required');
    }

    const urlMatch = trimmedInvite.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
    if (urlMatch?.[1]) {
      return urlMatch[1];
    }

    const codeMatch = trimmedInvite.match(/^([A-Za-z0-9_-]{10,})$/);
    if (codeMatch?.[1]) {
      return codeMatch[1];
    }

    throw new Error('Invalid WhatsApp invite link');
  }

  private normalizeGroupInviteInfo(rawInfo: any, inviteCode: string): WhatsAppGroupInviteInfo {
    const rawGroupId = rawInfo?.id?._serialized || rawInfo?.id || rawInfo?.groupId || rawInfo?.gid?._serialized || rawInfo?.gid || null;
    const rawGroupName = rawInfo?.name || rawInfo?.subject || rawInfo?.groupName || rawInfo?.formattedTitle || rawInfo?.title;
    const participantCount = typeof rawInfo?.size === 'number'
      ? rawInfo.size
      : typeof rawInfo?.participantsCount === 'number'
      ? rawInfo.participantsCount
      : typeof rawInfo?.memberCount === 'number'
      ? rawInfo.memberCount
      : Array.isArray(rawInfo?.participants)
      ? rawInfo.participants.length
      : null;
    const description = rawInfo?.description || rawInfo?.desc || rawInfo?.groupDesc || null;

    return {
      inviteCode,
      groupId: typeof rawGroupId === 'string' ? rawGroupId : null,
      groupName: typeof rawGroupName === 'string' && rawGroupName.trim().length > 0 ? rawGroupName : 'WhatsApp Group',
      participantCount,
      description: typeof description === 'string' && description.trim().length > 0 ? description : null
    };
  }

  async getGroupInviteInfo(accountId: string, inviteLink: string): Promise<WhatsAppGroupInviteInfo> {
    const client = this.clients.get(accountId);

    if (!client) {
      throw new Error('Account not connected');
    }

    const inviteCode = this.extractInviteCode(inviteLink);

    try {
      const rawInfo = await client.getInviteInfo(inviteCode);
      return this.normalizeGroupInviteInfo(rawInfo, inviteCode);
    } catch (error) {
      const message = (error as Error).message || 'Failed to get invite info';
      const loweredMessage = message.toLowerCase();

      if (loweredMessage.includes('not connected')) {
        throw new Error('Account not connected');
      }

      if (loweredMessage.includes('invalid') || loweredMessage.includes('expired') || loweredMessage.includes('invite') || loweredMessage.includes('not found')) {
        throw new Error('Invalid or expired invite link');
      }

      throw error;
    }
  }

  async getGroupParticipants(accountId: string, groupId: string): Promise<WhatsAppGroupParticipant[]> {
    const client = this.clients.get(accountId);
    
    if (!client) {
      throw new Error('Account not connected');
    }

    console.log('👥 Getting participants for group:', groupId);
    
    try {
      const page = (client as any).pupPage;
      if (!page) {
        throw new Error('WhatsApp page is not available');
      }

      const participants: Array<{ id: string; isAdmin: boolean; isSuperAdmin: boolean }> = await page.evaluate(async (targetGroupId: string) => {
        const chatCollection = (window as any).require('WAWebCollections').Chat;
        const groupMetadataCollection =
          (window as any).require('WAWebCollections').GroupMetadata ||
          (window as any).require('WAWebCollections').WAWebGroupMetadataCollection;
        const widFactory = (window as any).require('WAWebWidFactory');
        const { toPn } = (window as any).require('WAWebLidMigrationUtils');

        const chat = chatCollection.get(targetGroupId);
        if (!chat) {
          throw new Error('Group chat not found in WhatsApp Web model store');
        }

        if (!chat.groupMetadata) {
          throw new Error('Chat is not a group');
        }

        const chatWid = widFactory.createWid(targetGroupId);
        await groupMetadataCollection.update(chatWid);

        const metadata = chat.groupMetadata?.serialize?.() || {};
        const rawParticipants = Array.isArray(metadata.participants) ? metadata.participants : [];

        return rawParticipants.map((participant: any) => {
          const normalizedId = toPn(participant.id) ?? participant.id;
          const serializedId = normalizedId?._serialized || normalizedId?.toString?.() || '';
          return {
            id: serializedId,
            isAdmin: Boolean(participant.isAdmin),
            isSuperAdmin: Boolean(participant.isSuperAdmin)
          };
        }).filter((participant: any) => Boolean(participant.id));
      }, groupId);

      console.log(`✅ Found ${participants.length} participants`);

      const participantDetails = await Promise.all(
        participants.map(async (participant) => {
          try {
            const resolved = await this.resolveContactData(accountId, participant.id);
            return {
              id: participant.id,
              phoneNumber: resolved.phone || this.extractDigits(participant.id),
              name: resolved.name,
              isAdmin: participant.isAdmin,
              isSuperAdmin: participant.isSuperAdmin
            };
          } catch (error) {
            console.log('⚠️ Could not get details for participant:', participant.id);
            return {
              id: participant.id,
              phoneNumber: this.extractDigits(participant.id),
              name: null,
              isAdmin: participant.isAdmin,
              isSuperAdmin: participant.isSuperAdmin
            };
          }
        })
      );

      return participantDetails;
    } catch (error) {
      console.error('Failed to get group participants:', error);
      throw error;
    }
  }

  /**
   * Joins a group via invite code, returning a normalized raw response
   * instead of relying on whatsapp-web.js's `acceptInvite`, which blindly
   * assumes `res.gid._serialized` exists.
   *
   * Per WhatsApp Web's internal `WAWebGroupInviteJob.joinGroupViaInvite`
   * (confirmed via whatsapp-web.js issue #2570 and wa-js's documented
   * `membershipApprovalMode` behavior), when the target group requires
   * admin approval the call does NOT resolve with a usable group id -
   * it *rejects* with an error object shaped like:
   *   { name: 'UnexpectedJoinGroupViaInviteResponse', gid: '<id>@g.us', membershipApprovalMode: true }
   * even though the join request was actually submitted successfully.
   *
   * Puppeteer's `page.evaluate` normally loses custom properties on thrown
   * values when crossing the browser/Node boundary (only `message`/`stack`
   * survive), so we catch the rejection INSIDE the page context and return
   * it as a plain, fully-serializable object instead of letting it throw.
   */
  private async acceptInviteRaw(client: any, inviteCode: string): Promise<{
    ok: boolean;
    gid: string | null;
    membershipApprovalMode: boolean;
    name?: string;
    message?: string;
  }> {
    return client.pupPage.evaluate(async (code: string) => {
      try {
        const result = await (window as any)
          .require('WAWebGroupInviteJob')
          .joinGroupViaInvite(code);
        const gid = result?.gid?._serialized || result?.gid || null;
        return { ok: true, gid, membershipApprovalMode: false };
      } catch (err: any) {
        return {
          ok: false,
          gid: err?.gid?._serialized || err?.gid || null,
          membershipApprovalMode: Boolean(err?.membershipApprovalMode),
          name: err?.name,
          message: err?.message || String(err)
        };
      }
    }, inviteCode);
  }

  async joinGroupByInviteLink(accountId: string, inviteLink: string): Promise<GroupJoinByInviteResult> {
    const client = this.clients.get(accountId);

    if (!client) {
      return {
        success: false,
        status: 'account_not_connected',
        message: 'Account not connected'
      };
    }

    let inviteInfo: WhatsAppGroupInviteInfo | null = null;

    try {
      inviteInfo = await this.getGroupInviteInfo(accountId, inviteLink);

      const inviteCode = this.extractInviteCode(inviteLink);
      const rawResult = await this.acceptInviteRaw(client, inviteCode);

      // Confirmed via whatsapp-web.js issue #2570: when the group requires
      // admin approval, joinGroupViaInvite rejects with
      // `membershipApprovalMode: true` even though the join request WAS
      // submitted successfully - this is not a real failure.
      if (rawResult.membershipApprovalMode) {
        return {
          success: false,
          status: 'pending_approval',
          message: 'Join request sent, waiting for group admin approval',
          groupId: rawResult.gid || inviteInfo.groupId || null,
          groupName: inviteInfo.groupName || null
        };
      }

      if (!rawResult.ok || !rawResult.gid) {
        throw new Error(rawResult.message || rawResult.name || 'Failed to join group');
      }

      const rawGroupId = rawResult.gid;
      let groupName = inviteInfo.groupName;

      try {
        const joinedChat = await client.getChatById(rawGroupId);
        if (joinedChat?.isGroup && joinedChat.name) {
          groupName = joinedChat.name;
        }
      } catch {
      }

      return {
        success: true,
        status: 'joined',
        message: 'Joined group successfully',
        groupId: rawGroupId || inviteInfo.groupId || null,
        groupName
      };
    } catch (error) {
      const message = (error as Error).message || 'Failed to join group';
      const loweredMessage = message.toLowerCase();

      if (loweredMessage.includes('approval') || loweredMessage.includes('pending') || loweredMessage.includes('requested')) {
        return {
          success: false,
          status: 'pending_approval',
          message,
          groupId: inviteInfo?.groupId || null,
          groupName: inviteInfo?.groupName || null
        };
      }

      // WhatsApp server-side restriction (not something we can fix in code).
      // Confirmed via WhiskeySockets/Baileys issue #2638: `account_reachout_restricted`
      // is enforced by WhatsApp's servers regardless of client, usually for accounts
      // that are new/recently switched devices, joined too many groups in a short
      // window, or were flagged by anti-spam detection. It normally lifts on its own
      // within 24-72 hours; there is no client-side workaround.
      if (loweredMessage.includes('reachout_restricted') || loweredMessage.includes('account_restricted') || loweredMessage.includes('is restricted')) {
        return {
          success: false,
          status: 'account_restricted',
          message: 'WhatsApp has temporarily restricted this account from joining groups. This is enforced server-side and usually lifts within 24-72 hours.',
          groupId: inviteInfo?.groupId || null,
          groupName: inviteInfo?.groupName || null
        };
      }

      if (loweredMessage.includes('already') || loweredMessage.includes('member') || loweredMessage.includes('participant')) {
        return {
          success: true,
          status: 'already_joined',
          message,
          groupId: inviteInfo?.groupId || null,
          groupName: inviteInfo?.groupName || null
        };
      }

      if (loweredMessage.includes('not connected')) {
        return {
          success: false,
          status: 'account_not_connected',
          message,
          groupId: inviteInfo?.groupId || null,
          groupName: inviteInfo?.groupName || null
        };
      }

      if (loweredMessage.includes('invalid') || loweredMessage.includes('expired') || loweredMessage.includes('invite') || loweredMessage.includes('not found')) {
        return {
          success: false,
          status: 'invalid_invite',
          message,
          groupId: inviteInfo?.groupId || null,
          groupName: inviteInfo?.groupName || null
        };
      }

      return {
        success: false,
        status: 'failed',
        message,
        groupId: inviteInfo?.groupId || null,
        groupName: inviteInfo?.groupName || null
      };
    }
  }

  /**
   * Re-implementation of whatsapp-web.js's `GroupChat.addParticipants` that
   * skips its hardcoded `if (!group.iAmAdmin()) return errorCodes.iAmNotAdmin`
   * client-side gate.
   *
   * Confirmed via whatsapp-web.js issue #3355: the library blocks ANY
   * non-admin from adding participants even when the group's "who can add
   * members" setting is "All participants" (`memberAddMode: all_member_add`),
   * which is a real WhatsApp feature that doesn't require admin rights. The
   * actual permission check happens server-side via
   * `WWebJS.getAddParticipantsRpcResult`, so we call that directly and let
   * WhatsApp itself decide (returning codes 200/403/404/408/409/417/419)
   * instead of failing early on a client-side assumption.
   */
  private async addParticipantRaw(
    client: any,
    groupId: string,
    participantId: string,
    options: { autoSendInviteV4?: boolean; comment?: string } = {}
  ): Promise<{ code: number | null; message: string; isInviteV4Sent: boolean }> {
    return client.pupPage.evaluate(
      async (gId: string, pId: string, opts: { autoSendInviteV4?: boolean; comment?: string }) => {
        const { autoSendInviteV4 = false, comment = '' } = opts;

        const errorCodes: Record<string, string> = {
          default: 'An unknown error occurred while adding a participant',
          isGroupEmpty: "AddParticipantsError: The participant can't be added to an empty group",
          200: 'The participant was added successfully',
          403: 'The participant can be added by sending private invitation only',
          404: 'The phone number is not registered on WhatsApp',
          408: 'You cannot add this participant because they recently left the group',
          409: 'The participant is already a group member',
          417: "The participant can't be added to the community. You can invite them privately to join this group through its invite link",
          419: "The participant can't be added because the group is full"
        };

        const groupWid = (window as any).require('WAWebWidFactory').createWid(gId);
        const group =
          (window as any).require('WAWebCollections').Chat.get(groupWid) ||
          (await (window as any).require('WAWebCollections').Chat.find(groupWid));

        await (window as any)
          .require('WAWebGroupQueryJob')
          .queryAndUpdateGroupMetadataById({ id: gId });

        const groupParticipants = group.groupMetadata?.participants.serialize();

        if (!groupParticipants) {
          return { code: null, message: errorCodes.isGroupEmpty, isInviteV4Sent: false };
        }

        let pWid = (window as any).require('WAWebWidFactory').createWid(pId);

        if (groupParticipants.some((p: any) => p._serialized === pWid._serialized)) {
          return { code: 409, message: errorCodes[409], isInviteV4Sent: false };
        }

        const existsResult = await (window as any)
          .require('WAWebQueryExistsJob')
          .queryWidExists(pWid);

        if (!existsResult?.wid) {
          return { code: 404, message: errorCodes[404], isInviteV4Sent: false };
        }

        pWid =
          pWid.server === 'lid'
            ? (window as any).require('WAWebApiContact').getPhoneNumber(pWid)
            : pWid;

        const rpcResult = await (window as any).WWebJS.getAddParticipantsRpcResult(groupWid, pWid);
        const code = rpcResult.code;
        let isInviteV4Sent = false;

        if (autoSendInviteV4 && code === 403) {
          (window as any).require('WAWebCollections').Contact.gadd(pWid, { silent: true });

          if (rpcResult.name === 'ParticipantRequestCodeCanBeSent') {
            const userChat =
              (window as any).require('WAWebCollections').Chat.get(pWid) ||
              (await (window as any).require('WAWebCollections').Chat.find(pWid));

            if (userChat) {
              const groupName = group.formattedTitle || group.name;
              const res = await (window as any)
                .require('WAWebChatSendMessages')
                .sendGroupInviteMessage(
                  userChat,
                  group.id._serialized,
                  groupName,
                  rpcResult.inviteV4Code,
                  rpcResult.inviteV4CodeExp,
                  comment,
                  await (window as any).WWebJS.getProfilePicThumbToBase64(groupWid)
                );
              isInviteV4Sent = res.messageSendResult === 'OK';
            }
          }
        }

        return { code, message: errorCodes[code] || errorCodes.default, isInviteV4Sent };
      },
      groupId,
      participantId,
      options
    );
  }

  async addParticipantToGroup(accountId: string, groupId: string, phoneNumber: string): Promise<GroupAddParticipantResult> {
    try {
      const access = await this.canAddParticipantsToGroup(accountId, groupId);

      if (!access.ok) {
        return {
          success: false,
          resultCode: access.reason || 'group_access_denied',
          rawCode: null,
          message: access.message || 'Cannot access target group'
        };
      }

      const normalizedPhone = phoneNumber.replace(/\D/g, '');

      if (!normalizedPhone) {
        return {
          success: false,
          resultCode: 'unknown_error',
          rawCode: null,
          message: 'Invalid phone number'
        };
      }

      const client = this.clients.get(accountId);

      if (!client) {
        return {
          success: false,
          resultCode: 'account_not_connected',
          rawCode: null,
          message: 'Account not connected'
        };
      }

      const participantId = `${normalizedPhone}@c.us`;
      // NOTE: autoSendInviteV4 must stay false. When it's true and WhatsApp responds
      // with 403 (privacy-restricted), whatsapp-web.js tries to resolve/open a chat
      // with the target to auto-send a private invite. On current WhatsApp Web builds
      // that internal lookup crashes with "this.findImpl is not a function" (see
      // https://github.com/pedroslopez/whatsapp-web.js/issues/2386 and #201789), which
      // aborted the whole add attempt instead of just reporting the contact as
      // privacy-restricted. Disabling auto-invite avoids that crash entirely.
      const rawParticipantResult = await this.addParticipantRaw(client, groupId, participantId, {
        autoSendInviteV4: false,
        comment: ''
      });

      const rawCode = rawParticipantResult.code;
      const isInviteV4Sent = Boolean(rawParticipantResult.isInviteV4Sent);
      const resultCode = this.mapAddParticipantResultCode(rawCode, isInviteV4Sent);
      const success = resultCode === 'added' || resultCode === 'invite_sent';

      return {
        success,
        resultCode,
        rawCode,
        message: rawParticipantResult.message || 'Unknown add participant result',
        isInviteV4Sent,
        participantId
      };
    } catch (error) {
      const message = (error as Error).message || 'Failed to add participant to group';
      const loweredMessage = message.toLowerCase();

      let resultCode: CampaignContactResultCode = 'unknown_error';

      if (loweredMessage.includes('not connected')) {
        resultCode = 'account_not_connected';
      } else if (loweredMessage.includes('not a group') || loweredMessage.includes('chat not found')) {
        resultCode = 'group_not_found';
      } else if (loweredMessage.includes('admin')) {
        resultCode = 'not_admin';
      } else if (loweredMessage.includes('findimpl')) {
        // Defensive fallback for the known whatsapp-web.js invite-v4 crash
        // (https://github.com/pedroslopez/whatsapp-web.js/issues/2386). This should no
        // longer trigger now that autoSendInviteV4 is disabled, but if it ever does,
        // treat it as a privacy restriction instead of an opaque unknown error so the
        // campaign doesn't repeatedly retry a contact that can't be auto-added anyway.
        resultCode = 'privacy_restricted';
      }

      return {
        success: false,
        resultCode,
        rawCode: null,
        message
      };
    }
  }

  private updateAccountStatus(accountId: string, status: string, qrCode?: string) {
    const updates = ['status = ?', 'last_seen = ?'];
    const values = [status, new Date().toISOString()];

    if (qrCode !== undefined) {
      updates.push('qr_code = ?');
      values.push(qrCode);
    }

    values.push(accountId);
    const stmt = this.db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    // Notify renderer
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('account:status', accountId, status);
    }
  }

  private async handleIncomingMessage(accountId: string, msg: any) {
    try {
      // Skip group messages entirely - only process private chats
      const msgChatId = msg.from || msg.to || '';
      if (msgChatId.endsWith('@g.us')) {
        return;
      }

      console.log('💾 Processing message for database...');

      const messageId = msg.id.id || uuidv4();
      const isFromMe = this.isMessageFromMe(msg);
      const myNumber = (this.clients.get(accountId) as any)?.info?.wid?._serialized?.split('@')[0] || '';
      
      // Check if message already exists in DB (to avoid duplicates from messages we sent via the app)
      const checkStmt = this.db.prepare('SELECT id FROM messages WHERE id = ?');
      const existing = checkStmt.get(messageId);
      if (existing) {
        console.log('📋 Message already in database, skipping:', messageId);
        return;
      }
      
      // For outgoing messages - check if we recently sent this via the app
      if (isFromMe) {
        const messageText = msg.body || '';
        
        // Skip outgoing media messages - sendMedia already saves them to DB
        // The message_create event for outgoing media often has garbage body like 'CC'
        if (msg.hasMedia) {
          console.log(`📋 Outgoing media message detected via message_create - skipping (already saved by sendMedia)`);
          return;
        }
        
        // Skip known WWebJS artifacts (e.g. 'CC' body from media caption events)
        const trimmedText = messageText.trim().toLowerCase();
        if (trimmedText === 'cc') {
          console.log(`📋 Skipping WWebJS artifact message with body 'CC'`);
          return;
        }
        
        // Check in-memory cache FIRST (prevents race condition - faster than DB)
        const sentKey = `${accountId}:${messageText}`;
        const sentTimestamp = this.recentlySentMessages.get(sentKey);
        
        if (sentTimestamp && (Date.now() - sentTimestamp) < 120000) { // 2 minutes window
          console.log(`📋 Outgoing message found in memory cache, skipping duplicate`);
          return;
        }
        
        // Also check DB as fallback
        const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
        const recentCheck = this.db.prepare(`
          SELECT id FROM messages 
          WHERE account_id = ? 
          AND message_text = ? 
          AND is_from_me = 1
          AND timestamp >= ?
          LIMIT 1
        `);
        const recentDuplicate = recentCheck.get(accountId, messageText, sixtySecondsAgo);
        
        if (recentDuplicate) {
          console.log(`📋 Outgoing message found in DB, skipping duplicate`);
          return;
        }
      }
      
      // Handle outgoing vs incoming messages differently
      let chatId: string;
      let fromNumber: string;
      let toNumber: string;
      let senderName: string | null;
      
      if (isFromMe) {
        // Outgoing message (sent from this account)
        console.log('📤 Processing outgoing message (sent from phone/web)');
        chatId = msg.to; // For outgoing, chat is with the recipient
        fromNumber = myNumber;
        const resolvedToNumber = await this.resolvePhoneNumber(accountId, msg.to, msg);
        toNumber = resolvedToNumber || this.extractDigits(msg.to);
        senderName = (this.clients.get(accountId) as any)?.info?.pushname || null;

        if (resolvedToNumber) {
          console.log('✅ Got recipient phone number:', toNumber);
        } else {
          console.log('⚠️ Could not resolve recipient phone number, using message data');
        }
      } else {
        // Incoming message
        console.log('📥 Processing incoming message');
        chatId = msg.from; // For incoming, chat is with the sender
        const resolvedContact = await this.resolveContactData(accountId, msg.from, msg);
        fromNumber = resolvedContact.phone || this.extractDigits(msg.from);
        toNumber = myNumber;

        senderName = resolvedContact.name;
        console.log('✅ Sender name from notifyName:', senderName);

        if (resolvedContact.phone) {
          console.log('✅ Got real phone number from contact:', fromNumber);
        } else {
          console.log('⚠️ Could not get contact details, using message data');
        }
      }
      
      // Check if message has media
      let messageType = 'text';
      let mediaFilename: string | null = null;
      let mediaMimetype: string | null = null;
      
      if (msg.hasMedia) {
        console.log('📎 Message has media');
        try {
          const media = await msg.downloadMedia();
          if (media) {
            mediaMimetype = media.mimetype;
            messageType = media.mimetype.startsWith('image/') ? 'image' 
                        : media.mimetype.startsWith('video/') ? 'video'
                        : media.mimetype.startsWith('audio/') ? 'audio'
                        : media.mimetype.startsWith('voice/') ? 'voice'
                        : 'document';
            
            // Generate unique filename
            const extension = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
            mediaFilename = `${messageId}_${Date.now()}.${extension}`;
            
            // Save media to file
            const { app } = await import('electron');
            const pathModule = await import('path');
            const fsModule = await import('fs');
            
            const mediaDir = pathModule.join(app.getPath('userData'), 'media');
            
            // Ensure media directory exists
            if (!fsModule.existsSync(mediaDir)) {
              fsModule.mkdirSync(mediaDir, { recursive: true });
            }
            
            const mediaPath = pathModule.join(mediaDir, mediaFilename);
            const buffer = Buffer.from(media.data, 'base64');
            fsModule.writeFileSync(mediaPath, buffer);
            
            console.log('✅ Media downloaded and saved:', messageType, mediaFilename);
          }
        } catch (e) {
          console.log('⚠️ Could not download media:', e);
        }
      }
      
      const timestamp = new Date(msg.timestamp * 1000).toISOString();
      const isFromMeValue = isFromMe ? 1 : 0;
      const isRead = isFromMe ? 1 : 0; // Outgoing = read, incoming = unread
      
      // Find or create software chat
      const otherNumber = isFromMe ? toNumber : fromNumber;
      const client = this.clients.get(accountId);
      const softwareChatId = await this.chatManager.findOrCreateChat(
        otherNumber, 
        accountId, 
        client, 
        isFromMe ? null : senderName
      );
      this.chatManager.updateLastMessageAt(softwareChatId, timestamp);
      
      console.log('Database values:');
      console.log('  - messageId:', messageId);
      console.log('  - accountId:', accountId);
      console.log('  - chatId:', chatId);
      console.log('  - fromNumber:', fromNumber);
      console.log('  - toNumber:', toNumber);
      console.log('  - senderName:', senderName);
      console.log('  - message_text:', msg.body || null);
      console.log('  - messageType:', messageType);
      console.log('  - is_from_me:', isFromMeValue);
      console.log('  - softwareChatId:', softwareChatId);
      
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO messages (id, account_id, chat_id, from_number, to_number, sender_name, message_text, message_type, media_filename, media_mimetype, is_from_me, is_read, software_chat_id, type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        messageId,
        accountId,
        chatId,
        fromNumber,
        toNumber,
        senderName,
        msg.body || null,
        messageType,
        mediaFilename,
        mediaMimetype,
        isFromMeValue,
        isRead,
        softwareChatId,
        messageType,
        timestamp
      );

      console.log('✅ Message saved to database successfully');

      // Check if Flow should handle this message (only for incoming)
      if (!isFromMe && this.flowEngine) {
        console.log('🤖 Checking for active flows...');
        const flowExecuted = await this.flowEngine.checkAndExecuteFlow(accountId, chatId, msg, softwareChatId);
        
        if (flowExecuted) {
          console.log('✅ Flow executed - marking message as handled');
          this.db.prepare('UPDATE messages SET is_handled = 1, is_read = 1 WHERE id = ?').run(messageId);
          return;
        }
      }

      // AI chatbot (מערך היח״ש). Runs only for incoming messages that no
      // automation flow claimed, and only when explicitly enabled for this
      // account. A chatbot failure must never break message persistence or the
      // inbox, so it is fully contained here.
      if (!isFromMe && this.chatbotService) {
        try {
          if (this.chatbotService.isEnabledFor(accountId)) {
            // fromNumber is already resolved above (handles the @lid vs @c.us case).
            const senderNumber = fromNumber;
            console.log('🤖 Chatbot handling message from', senderNumber);
            const result = await this.chatbotService.handleIncomingMessage(
              accountId,
              senderNumber,
              msg.body || '',
            );
            if (result?.handled) {
              this.db.prepare('UPDATE messages SET is_handled = 1, is_read = 1 WHERE id = ?').run(messageId);
              return;
            }
            if (result?.error) console.error('🤖 Chatbot did not handle message:', result.error);
          }
        } catch (chatbotError) {
          console.error('🤖 Chatbot error (message still saved):', chatbotError);
        }
      }

      // Notify renderer of new message (both incoming and outgoing)
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        console.log('📤 Sending message to renderer...');
        mainWindow.webContents.send('message:new', {
          id: messageId,
          account_id: accountId,
          chat_id: chatId,
          software_chat_id: softwareChatId,
          from_number: fromNumber,
          to_number: toNumber,
          message_text: msg.body,
          is_from_me: isFromMeValue,
          is_read: isRead,
          type: messageType,
          timestamp: timestamp
        });
        console.log('✅ Message sent to renderer');
      }
    } catch (error) {
      console.error('❌ Error handling incoming message:', error);
    }
  }
}
