import { ipcMain, app, BrowserWindow } from 'electron';
import { getDatabase, withDbRecovery } from './database/index';
import { v4 as uuidv4 } from 'uuid';
import type { Account, Campaign, Contact, Tag, Message } from '../src/types';
import { WhatsAppManager } from './services/WhatsAppManager';
import { CampaignScheduler } from './services/CampaignScheduler';
import { WarmUpService } from './services/WarmUpService';
import { InboxManager } from './services/InboxManager';
import { LicenseManager } from './services/LicenseManager';
import { ScheduledCampaignChecker } from './services/ScheduledCampaignChecker';
import { FlowEngine } from './services/FlowEngine';
import { GroupCampaignScheduler } from './services/GroupCampaignScheduler';
import { DuoPlusManager } from './services/DuoPlusManager';
import { ChatbotService } from './chatbot/ChatbotService';
import { KnowledgeService } from './chatbot/knowledge/KnowledgeService';
import { getChatbotConfig, saveChatbotConfig } from './chatbot/config';
import { WORKFLOWS } from './chatbot/workflows';
import { FyiDigestScheduler } from './chatbot/FyiDigestScheduler';
import { logger } from './logger';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

let whatsappManager: WhatsAppManager;
let campaignScheduler: CampaignScheduler;
let warmUpService: WarmUpService;
let inboxManager: InboxManager;
let licenseManager: LicenseManager;
let scheduledCampaignChecker: ScheduledCampaignChecker;
let flowEngine: FlowEngine;
let groupCampaignScheduler: GroupCampaignScheduler;
let duoplusManager: DuoPlusManager;
let chatbotService: ChatbotService;
let knowledgeService: KnowledgeService;
let fyiDigestScheduler: FyiDigestScheduler;

// Helper function to normalize phone numbers for matching
function normalizePhoneForMatching(phone: string): string[] {
  // Remove all non-digits
  const digitsOnly = phone.replace(/\D/g, '');
  
  const variants: string[] = [
    phone,           // Original
    digitsOnly,      // Digits only
  ];
  
  // If it starts with country code (972, 1, 966, etc.), also add without it
  if (digitsOnly.startsWith('972') && digitsOnly.length >= 12) {
    // Israel: 972501234567 → 0501234567
    variants.push('0' + digitsOnly.slice(3));
  } else if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
    // USA: 15551234567 → 5551234567
    variants.push(digitsOnly.slice(1));
  } else if (digitsOnly.startsWith('966') && digitsOnly.length >= 12) {
    // Saudi: 966501234567 → 0501234567
    variants.push('0' + digitsOnly.slice(3));
  }
  
  // Add last 9-10 digits for fuzzy matching
  if (digitsOnly.length >= 9) {
    variants.push(digitsOnly.slice(-9));
  }
  if (digitsOnly.length >= 10) {
    variants.push(digitsOnly.slice(-10));
  }
  
  return [...new Set(variants)]; // Remove duplicates
}

// Helper function to log activity
function logActivity(db: any, type: string, message: string, relatedId?: string) {
  try {
    const stmt = db.prepare(`
      INSERT INTO activities (id, type, message, related_id, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(uuidv4(), type, message, relatedId || null, new Date().toISOString());
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

function parseSourceTagIds(sourceTagIds: unknown): string[] {
  if (Array.isArray(sourceTagIds)) {
    return sourceTagIds.filter((tagId): tagId is string => typeof tagId === 'string' && tagId.trim().length > 0);
  }

  if (typeof sourceTagIds !== 'string' || !sourceTagIds.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(sourceTagIds);
    return Array.isArray(parsed)
      ? parsed.filter((tagId): tagId is string => typeof tagId === 'string' && tagId.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function serializeSourceTagIds(sourceTagIds: unknown): string | null {
  const normalized = parseSourceTagIds(sourceTagIds);
  return normalized.length > 0 ? JSON.stringify([...new Set(normalized)]) : null;
}

function parseMessageVariants(messageVariants: unknown): string[] {
  if (Array.isArray(messageVariants)) {
    return messageVariants.filter((variant): variant is string => typeof variant === 'string' && variant.trim().length > 0);
  }

  if (typeof messageVariants !== 'string' || !messageVariants.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(messageVariants);
    return Array.isArray(parsed)
      ? parsed.filter((variant): variant is string => typeof variant === 'string' && variant.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function serializeMessageVariants(messageVariants: unknown): string | null {
  const normalized = parseMessageVariants(messageVariants);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function normalizeCampaignRow(campaign: any): Campaign | null {
  if (!campaign) {
    return null;
  }

  return {
    ...campaign,
    campaign_type: campaign.campaign_type || 'message',
    send_mode: campaign.send_mode === 'cloud_phone' ? 'cloud_phone' : 'web',
    skip_recent_contacts: Boolean(campaign.skip_recent_contacts),
    source_tag_ids: parseSourceTagIds(campaign.source_tag_ids),
    message_variants: parseMessageVariants(campaign.message_variants)
  };
}

let servicesInitialized = false;

async function initializeServices() {
  if (servicesInitialized) return;
  
  const db = getDatabase();
  
  console.log('🚀 Initializing WhatsApp and Campaign services...');
  whatsappManager = new WhatsAppManager(db);
  campaignScheduler = new CampaignScheduler(db, whatsappManager, duoplusManager);
  warmUpService = new WarmUpService(db, whatsappManager);
  inboxManager = new InboxManager(db, whatsappManager);
  
  // Initialize Flow Engine
  flowEngine = new FlowEngine(db, whatsappManager);
  whatsappManager.setFlowEngine(flowEngine);
  console.log('🤖 FlowEngine initialized');

  // AI chatbot (מערך היח״ש). Runs after FlowEngine in the incoming-message
  // path, so existing automation flows keep priority. Does nothing unless it
  // is explicitly enabled and an API key is configured.
  chatbotService.setWhatsAppManager(whatsappManager);
  whatsappManager.setChatbotService(chatbotService);
  console.log('🤖 ChatbotService wired', chatbotService.getConfig().enabled ? '(enabled)' : '(disabled)');
  fyiDigestScheduler.start();

  // Wire campaign scheduler so accounts trigger campaign resume on ready
  whatsappManager.setCampaignScheduler(campaignScheduler);
  
  // Initialize and start scheduled campaign checker (runs every hour)
  scheduledCampaignChecker = new ScheduledCampaignChecker(db, campaignScheduler);
  scheduledCampaignChecker.start();

  // Initialize and start the recurring group campaign scheduler (checks every minute)
  groupCampaignScheduler = new GroupCampaignScheduler(db, whatsappManager);
  groupCampaignScheduler.start();

  servicesInitialized = true;
  console.log('✅ All services initialized');
}

export function setupIPCHandlers() {
  const db = getDatabase();

  // DuoPlus manager is lightweight (just reads/writes the `settings` table and
  // calls the DuoPlus REST API) so it doesn't need to wait for license validation.
  duoplusManager = new DuoPlusManager(db);

  // Chatbot config/knowledge are plain DB reads, so the management UI works
  // before any WhatsApp account connects.
  // Pass the getter, not the handle: if a broken connection is reopened, these
  // services must pick up the new one rather than keep using a dead handle.
  chatbotService = new ChatbotService(getDatabase);
  knowledgeService = new KnowledgeService(getDatabase);

  // Daily FYI digest. Resolves the WhatsApp manager and account lazily, because
  // neither exists until a license validates and an account connects.
  fyiDigestScheduler = new FyiDigestScheduler(
    getDatabase,
    () => whatsappManager,
    () => {
      const config = getChatbotConfig(getDatabase());
      if (config.accountIds.length) return config.accountIds[0];
      const row = getDatabase()
        .prepare(`SELECT id FROM accounts WHERE status = 'connected' ORDER BY created_at ASC LIMIT 1`)
        .get() as { id?: string } | undefined;
      return row?.id ?? null;
    },
  );

  // Initialize only license manager (lightweight)
  licenseManager = new LicenseManager();
  licenseManager.initialize().catch(err => {
    console.error('Failed to initialize license manager:', err);
  });
  
  // Services will be initialized only after valid license

  // ==================== LICENSE HANDLERS ====================
  ipcMain.handle('license:check', async () => {
    const licenseInfo = await licenseManager.checkLicense();
    
    // אם הרישיון תקף ו-services עדיין לא אותחלו - אתחל אותם
    if (licenseInfo.isValid && !servicesInitialized) {
      console.log('✅ Valid license detected - initializing services...');
      await initializeServices();
    }
    
    return licenseInfo;
  });

  ipcMain.handle('license:activate', async (_event, licenseKey: string) => {
    const result = await licenseManager.activateLicense(licenseKey);
    
    // אם האקטיבציה הצליחה - אתחל services
    if (result.success && !servicesInitialized) {
      console.log('✅ License activated - initializing services...');
      await initializeServices();
    }
    
    return result;
  });

  ipcMain.handle('license:deactivate', async () => {
    return await licenseManager.deactivateLicense();
  });

  ipcMain.handle('license:getUser', () => {
    return licenseManager.getLicenseUser();
  });

  // ==================== ACCOUNT HANDLERS ====================
  ipcMain.handle('accounts:getAll', async () => {
    const stmt = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC');
    return stmt.all();
  });

  ipcMain.handle('accounts:getInitStatus', async () => {
    // If services not yet initialized, report as "in progress" with unknown total
    if (!whatsappManager) {
      return { total: 0, completed: 0, failed: 0, isComplete: false };
    }
    return whatsappManager.getInitializationProgress();
  });

  ipcMain.handle('accounts:getById', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
    return stmt.get(id);
  });

  ipcMain.handle('accounts:create', async (_event, data: Partial<Account>) => {
    const id = uuidv4();
    
    if (!data.phone_number) {
      throw new Error('Phone number is required');
    }
    
    const stmt = db.prepare(`
      INSERT INTO accounts (id, phone_number, name, proxy_host, proxy_port, proxy_username, proxy_password, proxy_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.phone_number,
      data.name || null,
      data.proxy_host || null,
      data.proxy_port || null,
      data.proxy_username || null,
      data.proxy_password || null,
      'http' // Always HTTP - SOCKS5 not supported
    );

    logActivity(db, 'account', `Account ${data.name || data.phone_number} added`, id);

    const getStmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
    return getStmt.get(id);
  });

  ipcMain.handle('accounts:update', async (_event, id: string, data: Partial<Account>) => {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.proxy_host !== undefined) {
      updates.push('proxy_host = ?');
      values.push(data.proxy_host);
    }
    if (data.proxy_port !== undefined) {
      updates.push('proxy_port = ?');
      values.push(data.proxy_port);
    }
    if (data.proxy_username !== undefined) {
      updates.push('proxy_username = ?');
      values.push(data.proxy_username);
    }
    if (data.proxy_password !== undefined) {
      updates.push('proxy_password = ?');
      values.push(data.proxy_password);
    }

    if (updates.length > 0) {
      values.push(id);
      const stmt = db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...values);
    }
  });

  ipcMain.handle('accounts:delete', async (_event, id: string) => {
    const accountStmt = db.prepare('SELECT name, phone_number FROM accounts WHERE id = ?');
    const account = accountStmt.get(id) as any;
    
    await whatsappManager.disconnectAccount(id);
    const stmt = db.prepare('DELETE FROM accounts WHERE id = ?');
    stmt.run(id);
    
    logActivity(db, 'account', `Account ${account?.name || account?.phone_number || 'Unknown'} deleted`, id);
  });

  ipcMain.handle('accounts:connect', async (_event, id: string, proxy?: any, pairingMethod: 'qr' | 'code' = 'qr') => {
    const accountStmt = db.prepare('SELECT name, phone_number FROM accounts WHERE id = ?');
    const account = accountStmt.get(id) as any;
    
    await whatsappManager.connectAccount(id, proxy, pairingMethod);
    
    logActivity(db, 'account', `Account ${account?.name || account?.phone_number || 'Unknown'} connecting via ${pairingMethod === 'qr' ? 'QR Code' : 'Pairing Code'}`, id);
  });

  ipcMain.handle('accounts:disconnect', async (_event, id: string) => {
    await whatsappManager.disconnectAccount(id);
  });

  ipcMain.handle('accounts:getQRCode', async (_event, id: string) => {
    return await whatsappManager.getQRCode(id);
  });

  ipcMain.handle('accounts:updateWhatsAppName', async (_event, id: string, name: string) => {
    await whatsappManager.updateWhatsAppName(id, name);
  });

  ipcMain.handle('accounts:updateWhatsAppImage', async (_event, id: string, imagePath: string) => {
    await whatsappManager.updateWhatsAppProfilePicture(id, imagePath);
  });

  ipcMain.handle('accounts:refreshProfilePicture', async (_event, id: string) => {
    await whatsappManager.refreshProfilePicture(id);
  });

  ipcMain.handle('accounts:setDuoplusDeviceId', async (_event, id: string, deviceId: string | null) => {
    const stmt = db.prepare('UPDATE accounts SET duoplus_device_id = ? WHERE id = ?');
    stmt.run(deviceId || null, id);
  });

  // ==================== DUOPLUS HANDLERS ====================
  ipcMain.handle('duoplus:getSettings', async () => {
    return duoplusManager.getSettings();
  });

  ipcMain.handle('duoplus:saveSettings', async (_event, settings: any) => {
    duoplusManager.saveSettings(settings);
  });

  ipcMain.handle('duoplus:testDevice', async (_event, deviceId: string) => {
    const [status] = await duoplusManager.getCloudPhoneStatus([deviceId]);
    return status || null;
  });

  // ==================== CAMPAIGN HANDLERS ====================
  ipcMain.handle('campaigns:getAll', async () => {
    const stmt = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC');
    return (stmt.all() as any[]).map(campaign => normalizeCampaignRow(campaign));
  });

  ipcMain.handle('campaigns:getById', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM campaigns WHERE id = ?');
    return normalizeCampaignRow(stmt.get(id));
  });

  ipcMain.handle('campaigns:create', async (_event, data: Partial<Campaign> & { media_path?: string, media_type?: string, media_caption?: string, scheduled_start_datetime?: string, messages_before_break?: number, break_duration?: number, skip_recent_contacts?: boolean, skip_recent_days?: number }) => {
    const id = uuidv4();
    const sendMode = data.send_mode === 'cloud_phone' ? 'cloud_phone' : 'web';
    // Cloud-phone send mode only supports text - never persist media for it
    const mediaPath = sendMode === 'cloud_phone' ? null : (data.media_path || null);
    const mediaType = sendMode === 'cloud_phone' ? null : (data.media_type || null);
    const mediaCaption = sendMode === 'cloud_phone' ? null : (data.media_caption || null);

    const stmt = db.prepare(`
      INSERT INTO campaigns (id, name, message, campaign_type, min_delay, max_delay, max_messages_per_day, start_hour, end_hour, media_path, media_type, media_caption, scheduled_start_datetime, messages_before_break, break_duration, skip_recent_contacts, skip_recent_days, target_group_id, target_group_name, group_source_account_id, source_tag_ids, message_variants, send_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.name,
      data.message ?? '',
      data.campaign_type || 'message',
      data.min_delay || 30,
      data.max_delay || 60,
      data.max_messages_per_day || 100,
      data.start_hour || 9,
      data.end_hour || 18,
      mediaPath,
      mediaType,
      mediaCaption,
      data.scheduled_start_datetime || null,
      data.messages_before_break || null,
      data.break_duration || null,
      data.skip_recent_contacts ? 1 : 0,
      data.skip_recent_days || 7,
      data.target_group_id || null,
      data.target_group_name || null,
      data.group_source_account_id || null,
      serializeSourceTagIds(data.source_tag_ids),
      serializeMessageVariants(data.message_variants),
      sendMode
    );

    const getStmt = db.prepare('SELECT * FROM campaigns WHERE id = ?');
    return normalizeCampaignRow(getStmt.get(id));
  });

  // Save campaign media file
  ipcMain.handle('campaigns:save-media', async (_event, fileName: string, buffer: Uint8Array) => {
    try {
      // Create media directory in userData
      const userDataPath = app.getPath('userData');
      const mediaDir = path.join(userDataPath, 'campaign-media');
      
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }
      
      // Generate unique filename
      const ext = path.extname(fileName);
      const uniqueFileName = `${uuidv4()}${ext}`;
      const filePath = path.join(mediaDir, uniqueFileName);
      
      // Save file
      fs.writeFileSync(filePath, Buffer.from(buffer));
      console.log('✅ Campaign media saved to:', filePath);
      
      return filePath;
    } catch (error) {
      console.error('Failed to save campaign media:', error);
      throw error;
    }
  });

  ipcMain.handle('campaigns:update', async (_event, id: string, data: Partial<Campaign> & { media_path?: string, media_type?: string, media_caption?: string, scheduled_start_datetime?: string, messages_before_break?: number, break_duration?: number, skip_recent_contacts?: boolean, skip_recent_days?: number }) => {
    const updates: string[] = [];
    const values: any[] = [];

    // Basic fields
    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.message !== undefined) {
      updates.push('message = ?');
      values.push(data.message);
    }
    if (data.campaign_type !== undefined) {
      updates.push('campaign_type = ?');
      values.push(data.campaign_type);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.send_mode !== undefined) {
      updates.push('send_mode = ?');
      values.push(data.send_mode === 'cloud_phone' ? 'cloud_phone' : 'web');
    }
    
    // Timing settings
    if (data.min_delay !== undefined) {
      updates.push('min_delay = ?');
      values.push(data.min_delay);
    }
    if (data.max_delay !== undefined) {
      updates.push('max_delay = ?');
      values.push(data.max_delay);
    }
    if (data.max_messages_per_day !== undefined) {
      updates.push('max_messages_per_day = ?');
      values.push(data.max_messages_per_day);
    }
    if (data.start_hour !== undefined) {
      updates.push('start_hour = ?');
      values.push(data.start_hour);
    }
    if (data.end_hour !== undefined) {
      updates.push('end_hour = ?');
      values.push(data.end_hour);
    }
    
    // Media fields - cloud-phone send mode only supports text, so media is never persisted for it
    const isCloudPhoneMode = data.send_mode === 'cloud_phone';
    if (data.media_path !== undefined) {
      updates.push('media_path = ?');
      values.push(isCloudPhoneMode ? null : data.media_path);
    }
    if (data.media_type !== undefined) {
      updates.push('media_type = ?');
      values.push(isCloudPhoneMode ? null : data.media_type);
    }
    if (data.media_caption !== undefined) {
      updates.push('media_caption = ?');
      values.push(isCloudPhoneMode ? null : data.media_caption);
    }
    
    // Break settings
    if (data.messages_before_break !== undefined) {
      updates.push('messages_before_break = ?');
      values.push(data.messages_before_break);
    }
    if (data.break_duration !== undefined) {
      updates.push('break_duration = ?');
      values.push(data.break_duration);
    }
    
    // Recent contacts filter
    if (data.skip_recent_contacts !== undefined) {
      updates.push('skip_recent_contacts = ?');
      values.push(data.skip_recent_contacts ? 1 : 0);
    }
    if (data.skip_recent_days !== undefined) {
      updates.push('skip_recent_days = ?');
      values.push(data.skip_recent_days);
    }

    if (data.target_group_id !== undefined) {
      updates.push('target_group_id = ?');
      values.push(data.target_group_id);
    }

    if (data.target_group_name !== undefined) {
      updates.push('target_group_name = ?');
      values.push(data.target_group_name);
    }

    if (data.group_source_account_id !== undefined) {
      updates.push('group_source_account_id = ?');
      values.push(data.group_source_account_id);
    }

    if (data.source_tag_ids !== undefined) {
      updates.push('source_tag_ids = ?');
      values.push(serializeSourceTagIds(data.source_tag_ids));
    }

    if (data.message_variants !== undefined) {
      updates.push('message_variants = ?');
      values.push(serializeMessageVariants(data.message_variants));
    }
    
    // Scheduling
    if (data.scheduled_start_datetime !== undefined) {
      updates.push('scheduled_start_datetime = ?');
      values.push(data.scheduled_start_datetime);
    }

    if (updates.length > 0) {
      values.push(id);
      const stmt = db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...values);
      
      const campaignStmt = db.prepare('SELECT name FROM campaigns WHERE id = ?');
      const campaign = campaignStmt.get(id) as any;
      logActivity(db, 'campaign', `Campaign "${campaign?.name || 'Unknown'}" updated`, id);
    }
  });

  ipcMain.handle('campaigns:delete', async (_event, id: string) => {
    await campaignScheduler.stopCampaign(id);
    const stmt = db.prepare('DELETE FROM campaigns WHERE id = ?');
    stmt.run(id);
  });

  ipcMain.handle('campaigns:start', async (_event, id: string) => {
    const campaignStmt = db.prepare('SELECT name FROM campaigns WHERE id = ?');
    const campaign = campaignStmt.get(id) as any;
    
    await campaignScheduler.startCampaign(id);
    
    logActivity(db, 'campaign', `Campaign "${campaign?.name || 'Unknown'}" started`, id);
  });

  ipcMain.handle('campaigns:pause', async (_event, id: string) => {
    const campaignStmt = db.prepare('SELECT name FROM campaigns WHERE id = ?');
    const campaign = campaignStmt.get(id) as any;
    
    await campaignScheduler.pauseCampaign(id);
    
    logActivity(db, 'pending', `Campaign "${campaign?.name || 'Unknown'}" paused`, id);
  });

  ipcMain.handle('campaigns:stop', async (_event, id: string) => {
    const campaignStmt = db.prepare('SELECT name FROM campaigns WHERE id = ?');
    const campaign = campaignStmt.get(id) as any;
    
    await campaignScheduler.stopCampaign(id);
    
    logActivity(db, 'error', `Campaign "${campaign?.name || 'Unknown'}" stopped`, id);
  });

  ipcMain.handle('campaigns:reset', async (_event, id: string) => {
    const campaignStmt = db.prepare('SELECT name FROM campaigns WHERE id = ?');
    const campaign = campaignStmt.get(id) as any;
    
    await campaignScheduler.resetCampaign(id);
    
    logActivity(db, 'pending', `Campaign "${campaign?.name || 'Unknown'}" reset`, id);
  });

  ipcMain.handle('campaigns:getStats', async (_event, id: string) => {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM campaign_contacts
      WHERE campaign_id = ?
    `);
    return stmt.get(id);
  });

  ipcMain.handle('campaigns:exportReport', async (_event, campaignId: string) => {
    const db = getDatabase();
    const { dialog } = await import('electron');
    
    // Get campaign info
    const campaign = normalizeCampaignRow(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId));
    if (!campaign) {
      throw new Error('Campaign not found');
    }
    
    // Show save dialog
    const desktopPath = app.getPath('desktop');
    const defaultFileName = `${campaign.name.replace(/[^a-zA-Z0-9א-ת]/g, '_')}_report_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    const result = await dialog.showSaveDialog({
      title: 'Save Campaign Report',
      defaultPath: path.join(desktopPath, defaultFileName),
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] }
      ]
    });
    
    if (result.canceled || !result.filePath) {
      return null;
    }
    
    // Get all contacts with details
    const contacts = db.prepare(`
      SELECT 
        cc.*,
        c.name as contact_name,
        a.name as account_name,
        a.phone_number as account_phone
      FROM campaign_contacts cc
      LEFT JOIN contacts c ON cc.phone_number = c.phone_number
      LEFT JOIN accounts a ON cc.sent_by_account_id = a.id
      WHERE cc.campaign_id = ?
      ORDER BY cc.sent_at DESC
    `).all(campaignId);
    
    // Create Excel workbook
    const workbook = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const excelData = contacts.map((contact: any) => ({
      'Phone Number': contact.phone_number,
      'Contact Name': contact.contact_name || '-',
      'Status': contact.status,
      'Processed By': contact.account_name || contact.account_phone || '-',
      'Processed At': contact.sent_at ? new Date(contact.sent_at).toLocaleString() : '-',
      'Campaign Type': campaign.campaign_type === 'group_adder' ? 'Group Adder' : 'Message',
      'Target Group': campaign.target_group_name || campaign.target_group_id || '-',
      'Action': campaign.campaign_type === 'group_adder' ? `Add to ${campaign.target_group_name || campaign.target_group_id || 'group'}` : campaign.message,
      'Result Code': contact.result_code || '-',
      'Error': contact.error || '-'
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Campaign Report');
    
    // Generate Excel file
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Save to chosen path
    fs.writeFileSync(result.filePath, buffer);
    
    return result.filePath;
  });

  ipcMain.handle('campaigns:addContacts', async (_event, id: string, contacts: { phone_number: string }[]) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO campaign_contacts (id, campaign_id, phone_number, retry_count)
      VALUES (?, ?, ?, 0)
    `);

    const uniqueContacts = Array.from(
      new Set(
        contacts
          .map(contact => contact.phone_number?.trim())
          .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber))
      )
    ).map(phone_number => ({ phone_number }));

    const insertMany = db.transaction((contactList: { phone_number: string }[]) => {
      for (const contact of contactList) {
        stmt.run(uuidv4(), id, contact.phone_number);
      }
    });

    insertMany(uniqueContacts);
  });

  ipcMain.handle('campaigns:getContacts', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM campaign_contacts WHERE campaign_id = ?');
    return stmt.all(id);
  });

  ipcMain.handle('campaigns:addAccounts', async (_event, campaignId: string, accountIds: string[]) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id)
      VALUES (?, ?)
    `);

    const insertMany = db.transaction((ids) => {
      for (const accountId of ids) {
        stmt.run(campaignId, accountId);
      }
    });

    insertMany(accountIds);
  });

  ipcMain.handle('campaigns:setAccounts', async (_event, campaignId: string, accountIds: string[]) => {
    const deleteStmt = db.prepare(`DELETE FROM campaign_accounts WHERE campaign_id = ?`);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id)
      VALUES (?, ?)
    `);

    const replaceAccounts = db.transaction((ids: string[]) => {
      deleteStmt.run(campaignId);
      for (const accountId of [...new Set(ids)]) {
        insertStmt.run(campaignId, accountId);
      }
    });

    replaceAccounts(accountIds);
  });

  ipcMain.handle('campaigns:setContacts', async (_event, campaignId: string, contacts: { phone_number: string }[]) => {
    const deleteStmt = db.prepare(`DELETE FROM campaign_contacts WHERE campaign_id = ?`);
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO campaign_contacts (id, campaign_id, phone_number, retry_count)
      VALUES (?, ?, ?, 0)
    `);

    const uniqueContacts = Array.from(
      new Set(
        contacts
          .map(contact => contact.phone_number?.trim())
          .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber))
      )
    ).map(phone_number => ({ phone_number }));

    const replaceContacts = db.transaction((contactList: { phone_number: string }[]) => {
      deleteStmt.run(campaignId);
      for (const contact of contactList) {
        insertStmt.run(uuidv4(), campaignId, contact.phone_number);
      }
    });

    replaceContacts(uniqueContacts);
  });

  ipcMain.handle('campaigns:getAccounts', async (_event, campaignId: string) => {
    const stmt = db.prepare('SELECT account_id FROM campaign_accounts WHERE campaign_id = ?');
    return stmt.all(campaignId).map((row: any) => row.account_id);
  });

  // ==================== CONTACT HANDLERS ====================
  ipcMain.handle('contacts:getAll', async () => {
    const stmt = db.prepare(`
      SELECT c.*, GROUP_CONCAT(t.id || ':' || t.name || ':' || COALESCE(t.color, '')) as tags_data
      FROM contacts c
      LEFT JOIN contact_tags ct ON c.id = ct.contact_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    
    const contacts = stmt.all() as any[];
    return contacts.map(contact => ({
      ...contact,
      custom_fields: contact.custom_fields ? JSON.parse(contact.custom_fields) : {},
      tags: contact.tags_data ? contact.tags_data.split(',').map((t: string) => {
        const [id, name, color] = t.split(':');
        return { id, name, color: color || undefined };
      }) : []
    }));
  });

  // Paginated contacts with search
  ipcMain.handle('contacts:getPaginated', async (_event, options: { 
    page: number; 
    limit: number; 
    searchQuery?: string; 
    tagFilter?: string;
  }) => {
    const { page = 1, limit = 200, searchQuery = '', tagFilter = 'all' } = options;
    const offset = (page - 1) * limit;
    
    // Build WHERE clause
    let whereClause = '1=1';
    const params: any[] = [];
    
    // Search filter
    if (searchQuery.trim()) {
      whereClause += ' AND (c.phone_number LIKE ? OR c.name LIKE ?)';
      const searchPattern = `%${searchQuery}%`;
      params.push(searchPattern, searchPattern);
    }
    
    // Tag filter
    if (tagFilter !== 'all') {
      whereClause += ` AND EXISTS (
        SELECT 1 FROM contact_tags ct 
        WHERE ct.contact_id = c.id AND ct.tag_id = ?
      )`;
      params.push(tagFilter);
    }
    
    // Get total count
    const countStmt = db.prepare(`
      SELECT COUNT(DISTINCT c.id) as total FROM contacts c
      WHERE ${whereClause}
    `);
    const { total } = countStmt.get(...params) as any;
    
    // Get paginated contacts
    const stmt = db.prepare(`
      SELECT c.*, GROUP_CONCAT(t.id || ':' || t.name || ':' || COALESCE(t.color, '')) as tags_data
      FROM contacts c
      LEFT JOIN contact_tags ct ON c.id = ct.contact_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      WHERE ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `);
    
    const contacts = stmt.all(...params, limit, offset) as any[];
    
    return {
      contacts: contacts.map(contact => ({
        ...contact,
        custom_fields: contact.custom_fields ? JSON.parse(contact.custom_fields) : {},
        tags: contact.tags_data ? contact.tags_data.split(',').map((t: string) => {
          const [id, name, color] = t.split(':');
          return { id, name, color: color || undefined };
        }) : []
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  });

  ipcMain.handle('contacts:getById', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM contacts WHERE id = ?');
    return stmt.get(id);
  });

  ipcMain.handle('contacts:create', async (_event, data: Partial<Contact>) => {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO contacts (id, phone_number, name, custom_fields)
      VALUES (?, ?, ?, ?)
    `);
    
    const customFieldsJson = data.custom_fields ? JSON.stringify(data.custom_fields) : null;
    stmt.run(id, data.phone_number, data.name || null, customFieldsJson);

    const getStmt = db.prepare('SELECT * FROM contacts WHERE id = ?');
    const contact = getStmt.get(id) as any;
    return {
      ...contact,
      custom_fields: contact.custom_fields ? JSON.parse(contact.custom_fields) : {}
    };
  });

  ipcMain.handle('contacts:update', async (_event, id: string, data: Partial<Contact>) => {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.phone_number !== undefined) {
      updates.push('phone_number = ?');
      values.push(data.phone_number);
    }
    if (data.custom_fields !== undefined) {
      updates.push('custom_fields = ?');
      values.push(JSON.stringify(data.custom_fields));
    }

    if (updates.length > 0) {
      values.push(id);
      const stmt = db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...values);
    }
  });

  ipcMain.handle('contacts:delete', async (_event, id: string) => {
    // Delete messages linked to chats of this contact
    db.prepare(`DELETE FROM messages WHERE software_chat_id IN (SELECT id FROM chats WHERE contact_id = ?)`).run(id);
    // Delete chats linked to this contact
    db.prepare('DELETE FROM chats WHERE contact_id = ?').run(id);
    // Delete contact tags
    db.prepare('DELETE FROM contact_tags WHERE contact_id = ?').run(id);
    // Delete the contact
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  });

  // Delete all contacts
  ipcMain.handle('contacts:deleteAll', async () => {
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM contacts');
    const { count } = countStmt.get() as any;
    
    // Delete messages linked to chats
    db.prepare(`DELETE FROM messages WHERE software_chat_id IN (SELECT id FROM chats)`).run();
    // Delete all chats
    db.prepare('DELETE FROM chats').run();
    // Delete all contact tags
    db.prepare('DELETE FROM contact_tags').run();
    // Delete all contacts
    db.prepare('DELETE FROM contacts').run();
    
    console.log(`🗑️ Deleted all ${count} contacts`);
    logActivity(db, 'contacts', `Deleted all ${count} contacts`);
    
    return count;
  });

  // Preview contacts before import
  ipcMain.handle('contacts:previewFile', async (_event, filePath: string, country: string = 'international') => {
    try {
      let data: any[];
      
      if (filePath.toLowerCase().endsWith('.csv')) {
        // For CSV, read as UTF-8 text
        console.log('📄 Reading CSV for preview...');
        let csvContent = fs.readFileSync(filePath, 'utf8');
        
        // Detect encoding issues
        if (csvContent.includes('�') || /[À-ÿ]{3,}/.test(csvContent)) {
          const buffer = fs.readFileSync(filePath);
          const decoder = new TextDecoder('windows-1255');
          csvContent = decoder.decode(buffer);
          console.log('✅ Decoded preview CSV as Windows-1255');
        }
        
        const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line);
        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        
        data = lines.slice(1).map(line => {
          const values: string[] = [];
          let currentValue = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' || char === "'") {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
              currentValue = '';
            } else {
              currentValue += char;
            }
          }
          values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
          
          const row: any = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });
          return row;
        });
      } else {
        // For Excel
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { 
          type: 'buffer',
          codepage: 65001
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false,
          defval: ''
        }) as any[];
      }

      // Phone normalization function (reuse from importFromFile)
      function normalizePhone(phone: string | number, countryCode: string): string {
        let phoneStr = String(phone);
        if (phoneStr.includes('E+') || phoneStr.includes('e+')) {
          const num = Number(phone);
          phoneStr = String(Math.round(num));
        }
        let cleaned = phoneStr.trim().replace(/[^\d+]/g, '').replace(/^\+/, '');
        
        if (countryCode === 'israel') {
          if (cleaned.startsWith('972') && cleaned.length >= 12) return cleaned;
          if (cleaned.startsWith('05') && cleaned.length === 10) return '9725' + cleaned.substring(2);
          if (cleaned.startsWith('5') && cleaned.length === 9) return '972' + cleaned;
          if (cleaned.startsWith('0') && (cleaned.length === 10 || cleaned.length === 9)) return '972' + cleaned.substring(1);
        } else if (countryCode === 'usa') {
          if (cleaned.startsWith('1') && cleaned.length === 11) return cleaned;
          if (cleaned.length === 10) return '1' + cleaned;
        } else if (countryCode === 'saudi') {
          if (cleaned.startsWith('966') && cleaned.length >= 12) return cleaned;
          if (cleaned.startsWith('05') && cleaned.length === 10) return '9665' + cleaned.substring(2);
          if (cleaned.startsWith('5') && cleaned.length === 9) return '966' + cleaned;
          if (cleaned.startsWith('0') && cleaned.length === 10) return '966' + cleaned.substring(1);
        }
        
        return cleaned;
      }

      // Validate phone number AFTER normalization (only check length, prefix already added)
      function validatePhonePreview(normalized: string, countryCode: string): { isValid: boolean; error?: string } {
        if (!normalized || normalized.length === 0) {
          return { isValid: false, error: 'Empty' };
        }

        // Only validate LENGTH - normalization already handled prefix
        switch (countryCode) {
          case 'israel':
            if (normalized.length !== 12) {
              return { isValid: false, error: `${normalized.length} digits (need 12)` };
            }
            break;
          case 'usa':
            if (normalized.length !== 11) {
              return { isValid: false, error: `${normalized.length} digits (need 11)` };
            }
            break;
          case 'saudi':
            if (normalized.length !== 12) {
              return { isValid: false, error: `${normalized.length} digits (need 12)` };
            }
            break;
          case 'international':
            if (normalized.length < 10) {
              return { isValid: false, error: `Too short: ${normalized.length}` };
            }
            if (normalized.length > 15) {
              return { isValid: false, error: `Too long: ${normalized.length}` };
            }
            break;
        }

        return { isValid: true };
      }

      // Create preview with validation for ALL rows (UI slices for display)
      const preview = data.map(row => {
        const rawPhone = row.phone_number || row.phone || row.number || row.Phone || row['Phone Number'];
        const name = row.name || row.Name || null;
        
        if (rawPhone) {
          const original = String(rawPhone);
          const normalized = normalizePhone(rawPhone, country);
          const validation = validatePhonePreview(normalized, country);
          
          return {
            original,
            normalized,
            name,
            changed: original !== normalized,
            isValid: validation.isValid,
            validationError: validation.error
          };
        }
        return null;
      }).filter(Boolean);

      return {
        preview,
        totalCount: data.length
      };
    } catch (error) {
      console.error('Failed to preview file:', error);
      throw error;
    }
  });

  ipcMain.handle('contacts:selectFile', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Get blacklist count
  ipcMain.handle('contacts:getBlacklistCount', async () => {
    const stmt = db.prepare(`
      SELECT COUNT(DISTINCT c.id) as count
      FROM contacts c
      JOIN contact_tags ct ON c.id = ct.contact_id
      JOIN tags t ON ct.tag_id = t.id
      WHERE t.name = 'BlackList'
    `);
    const result = stmt.get() as any;
    return result?.count || 0;
  });

  // Check if phone number is in blacklist (checks all formats)
  ipcMain.handle('contacts:isInBlacklist', async (_event, phoneNumber: string) => {
    const phoneVariants = normalizePhoneForMatching(phoneNumber);
    
    // Build dynamic query with all variants
    const placeholders = phoneVariants.map(() => 
      'REPLACE(REPLACE(REPLACE(c.phone_number, \'-\', \'\'), \' \', \'\'), \'+\', \'\') = ?'
    ).join(' OR ');
    
    const stmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM contacts c
      JOIN contact_tags ct ON c.id = ct.contact_id
      JOIN tags t ON ct.tag_id = t.id
      WHERE t.name = 'BlackList'
        AND (${placeholders})
    `);
    
    const result = stmt.get(...phoneVariants) as any;
    return (result?.count || 0) > 0;
  });

  // Find contact by phone number (checks all formats)
  ipcMain.handle('contacts:findByPhone', async (_event, phoneNumber: string) => {
    const phoneVariants = normalizePhoneForMatching(phoneNumber);
    
    // Build dynamic query with all variants
    const placeholders = phoneVariants.map(() => 
      'REPLACE(REPLACE(REPLACE(phone_number, \'-\', \'\'), \' \', \'\'), \'+\', \'\') = ?'
    ).join(' OR ');
    
    const stmt = db.prepare(`
      SELECT c.*, GROUP_CONCAT(t.id || ':' || t.name || ':' || COALESCE(t.color, '')) as tags_data
      FROM contacts c
      LEFT JOIN contact_tags ct ON c.id = ct.contact_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      WHERE ${placeholders}
      GROUP BY c.id
      LIMIT 1
    `);
    
    const contact = stmt.get(...phoneVariants) as any;
    if (!contact) return null;
    
    return {
      ...contact,
      custom_fields: contact.custom_fields ? JSON.parse(contact.custom_fields) : {},
      tags: contact.tags_data ? contact.tags_data.split(',').map((t: string) => {
        const [id, name, color] = t.split(':');
        return { id, name, color: color || undefined };
      }) : []
    };
  });

  // Select media file (images, videos, documents)
  ipcMain.handle('flows:selectMedia', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'All Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'pdf', 'doc', 'docx'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm'] },
        { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Check for duplicates before import
  ipcMain.handle('contacts:checkDuplicates', async (_event, filePath: string, country: string = 'international') => {
    try {
      let data: any[];
      
      if (filePath.toLowerCase().endsWith('.csv')) {
        let csvContent = fs.readFileSync(filePath, 'utf8');
        
        // Detect encoding issues
        if (csvContent.includes('�') || /[À-ÿ]{3,}/.test(csvContent)) {
          const buffer = fs.readFileSync(filePath);
          const decoder = new TextDecoder('windows-1255');
          csvContent = decoder.decode(buffer);
          console.log('✅ Decoded checkDuplicates CSV as Windows-1255');
        }
        
        const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line);
        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        
        data = lines.slice(1).map(line => {
          const values: string[] = [];
          let currentValue = '';
          let inQuotes = false;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"' || char === "'") {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
              currentValue = '';
            } else {
              currentValue += char;
            }
          }
          values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
          
          const row: any = {};
          headers.forEach((header, idx) => {
            row[header] = values[idx] || '';
          });
          return row;
        });
      } else {
        const fileBuffer = fs.readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', codepage: 65001 });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' }) as any[];
      }

      function normalizePhone(phone: string | number, countryCode: string): string {
        let phoneStr = String(phone);
        if (phoneStr.includes('E+') || phoneStr.includes('e+')) phoneStr = String(Math.round(Number(phone)));
        let cleaned = phoneStr.trim().replace(/[^\d+]/g, '').replace(/^\+/, '');
        
        if (countryCode === 'israel') {
          if (cleaned.startsWith('972') && cleaned.length >= 12) return cleaned;
          if (cleaned.startsWith('05') && cleaned.length === 10) return '9725' + cleaned.substring(2);
          if (cleaned.startsWith('5') && cleaned.length === 9) return '972' + cleaned;
          if (cleaned.startsWith('0') && (cleaned.length === 10 || cleaned.length === 9)) return '972' + cleaned.substring(1);
        } else if (countryCode === 'usa') {
          if (cleaned.startsWith('1') && cleaned.length === 11) return cleaned;
          if (cleaned.length === 10) return '1' + cleaned;
        } else if (countryCode === 'saudi') {
          if (cleaned.startsWith('966') && cleaned.length >= 12) return cleaned;
          if (cleaned.startsWith('05') && cleaned.length === 10) return '9665' + cleaned.substring(2);
          if (cleaned.startsWith('5') && cleaned.length === 9) return '966' + cleaned;
          if (cleaned.startsWith('0') && cleaned.length === 10) return '966' + cleaned.substring(1);
        }
        return cleaned;
      }

      // Get all existing phone numbers from DB
      const existingPhonesStmt = db.prepare('SELECT phone_number FROM contacts');
      const existingPhones = new Set((existingPhonesStmt.all() as any[]).map(row => row.phone_number));

      // Check which phone numbers are duplicates
      const duplicates: string[] = [];
      for (const row of data) {
        const rawPhone = row.phone_number || row.phone || row.number || row.Phone || row['Phone Number'];
        if (rawPhone) {
          const normalized = normalizePhone(rawPhone, country);
          if (existingPhones.has(normalized)) {
            duplicates.push(normalized);
          }
        }
      }

      return {
        duplicateCount: duplicates.length,
        totalCount: data.length,
        duplicates: duplicates
      };
    } catch (error) {
      console.error('Failed to check duplicates:', error);
      throw error;
    }
  });

  ipcMain.handle('contacts:importFromFile', async (_event, filePath: string, country?: string, duplicateAction?: 'update' | 'skip') => {
    // Try to read as UTF-8 text first (for CSV files)
    let data: any[];
    
    if (filePath.toLowerCase().endsWith('.csv')) {
      // For CSV files, try UTF-8 first
      console.log('📄 Reading CSV file...');
      let csvContent = fs.readFileSync(filePath, 'utf8');
      
      // Detect if it's actually Windows-1255 (Hebrew) by checking for mojibake
      if (csvContent.includes('�') || /[À-ÿ]{3,}/.test(csvContent)) {
        console.log('⚠️ Detected encoding issue, trying Windows-1255 (Hebrew)...');
        // Read as binary and decode as Windows-1255
        const buffer = fs.readFileSync(filePath);
        const decoder = new TextDecoder('windows-1255');
        csvContent = decoder.decode(buffer);
        console.log('✅ Decoded as Windows-1255');
      }
      
      // Parse CSV manually to ensure UTF-8
      const lines = csvContent.split('\n').map(line => line.trim()).filter(line => line);
      const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      
      data = lines.slice(1).map(line => {
        // Handle quoted values with commas inside
        const values: string[] = [];
        let currentValue = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
            currentValue = '';
          } else {
            currentValue += char;
          }
        }
        values.push(currentValue.trim().replace(/^["']|["']$/g, ''));
        
        const row: any = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        return row;
      });
      
      console.log(`✅ Parsed ${data.length} rows from CSV (UTF-8)`);
    } else {
      // For Excel files, use XLSX
      console.log('📊 Reading Excel file...');
      const fileBuffer = fs.readFileSync(filePath);
      const workbook = XLSX.read(fileBuffer, { 
        type: 'buffer',
        codepage: 65001, // UTF-8
        cellText: true,
        cellDates: true
      });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet, { 
        raw: false,
        defval: '',
        blankrows: false
      }) as any[];
      
      console.log(`✅ Parsed ${data.length} rows from Excel`);
    }

    // Phone normalization function
    function normalizePhone(phone: string | number, countryCode: string = 'international'): string {
      let phoneStr = String(phone);
      
      // Handle scientific notation
      if (phoneStr.includes('E+') || phoneStr.includes('e+')) {
        const num = Number(phone);
        phoneStr = String(Math.round(num));
      }
      
      // Clean the phone number
      let cleaned = phoneStr.trim().replace(/[^\d+]/g, '');
      cleaned = cleaned.replace(/^\+/, '');
      
      if (countryCode === 'international') return cleaned;
      
      // Israel normalization
      if (countryCode === 'israel') {
        if (cleaned.startsWith('972') && cleaned.length >= 12) return cleaned;
        if (cleaned.startsWith('05') && cleaned.length === 10) return '9725' + cleaned.substring(2);
        if (cleaned.startsWith('5') && cleaned.length === 9) return '972' + cleaned;
        if (cleaned.startsWith('0') && (cleaned.length === 10 || cleaned.length === 9)) return '972' + cleaned.substring(1);
      }
      
      // USA normalization
      if (countryCode === 'usa') {
        if (cleaned.startsWith('1') && cleaned.length === 11) return cleaned;
        if (cleaned.length === 10 && !cleaned.startsWith('1')) return '1' + cleaned;
      }
      
      // Saudi Arabia normalization
      if (countryCode === 'saudi') {
        if (cleaned.startsWith('966') && cleaned.length >= 12) return cleaned;
        if (cleaned.startsWith('05') && cleaned.length === 10) return '9665' + cleaned.substring(2);
        if (cleaned.startsWith('5') && cleaned.length === 9) return '966' + cleaned;
        if (cleaned.startsWith('0') && cleaned.length === 10) return '966' + cleaned.substring(1);
      }
      
      return cleaned;
    }

    // Validate phone number after normalization
    function validatePhone(normalized: string, countryCode: string): boolean {
      if (!normalized || normalized.length === 0) return false;

      switch (countryCode) {
        case 'israel':
          return normalized.startsWith('972') && normalized.length === 12;
        case 'usa':
          return normalized.startsWith('1') && normalized.length === 11;
        case 'saudi':
          return normalized.startsWith('966') && normalized.length === 12;
        case 'international':
          return normalized.length >= 10 && normalized.length <= 15;
        default:
          return normalized.length >= 10;
      }
    }

    let count = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    
    const totalRows = data.length;
    console.log(`📥 Starting import of ${totalRows} contacts...`);
    
    // Get all custom fields
    const customFieldsStmt = db.prepare('SELECT * FROM custom_fields ORDER BY field_order ASC');
    const customFields = customFieldsStmt.all() as any[];
    
    // Pre-cache ALL existing contacts in memory (avoids per-row DB lookups)
    const existingContactsCache = new Map<string, { id: string; name: string; custom_fields: string | null }>();
    const allContacts = db.prepare('SELECT id, phone_number, name, custom_fields FROM contacts').all() as any[];
    for (const c of allContacts) {
      existingContactsCache.set(c.phone_number, { id: c.id, name: c.name, custom_fields: c.custom_fields });
    }
    
    // Pre-cache ALL existing tags in memory
    const tagsCache = new Map<string, string>();
    const allTags = db.prepare('SELECT id, name FROM tags').all() as any[];
    for (const t of allTags) {
      tagsCache.set(t.name, t.id);
    }
    
    const contactStmt = db.prepare(`
      INSERT OR IGNORE INTO contacts (id, phone_number, name, custom_fields)
      VALUES (?, ?, ?, ?)
    `);
    
    const updateContactStmt = db.prepare(`
      UPDATE contacts SET name = ?, custom_fields = ? WHERE phone_number = ?
    `);
    
    const createTagStmt = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)');
    const linkTagStmt = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)');

    // Process in chunks with a single transaction per chunk
    const CHUNK_SIZE = 2000;
    const mainWindow = BrowserWindow.getAllWindows()[0];
    
    for (let chunkStart = 0; chunkStart < totalRows; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRows);
      const chunk = data.slice(chunkStart, chunkEnd);
      
      // Send progress to UI
      if (mainWindow) {
        mainWindow.webContents.send('contacts:importProgress', {
          current: chunkStart,
          total: totalRows,
          percent: Math.round((chunkStart / totalRows) * 100)
        });
      }
      
      // Process chunk in a single transaction
      const processChunk = db.transaction((rows: any[]) => {
        for (const row of rows) {
          const rawPhoneNumber = row.phone_number || row.phone || row.number || row.Phone || row['Phone Number'];
          let name = row.name || row.Name || null;
          const tagsString = row.tags || row.Tags || '';
          
          // Extract custom fields from row
          const customFieldsData: Record<string, string> = {};
          for (const field of customFields) {
            const value = row[field.name] || row[field.label] || '';
            if (value) {
              customFieldsData[field.name] = String(value).trim();
            }
          }
          
          if (!rawPhoneNumber) continue;
          
          // Normalize phone number based on selected country
          const phoneNumber = normalizePhone(rawPhoneNumber, country || 'international');
          
          // Validate phone number
          if (!validatePhone(phoneNumber, country || 'international')) {
            invalidCount++;
            continue;
          }
          
          const customFieldsJson = Object.keys(customFieldsData).length > 0 ? JSON.stringify(customFieldsData) : null;
          
          // Check in-memory cache instead of DB query
          const existingContact = existingContactsCache.get(phoneNumber);
          
          if (existingContact) {
            if (duplicateAction === 'skip') {
              duplicateCount++;
              continue;
            } else if (duplicateAction === 'update') {
              const existingCustomFields = existingContact.custom_fields ? JSON.parse(existingContact.custom_fields) : {};
              const mergedCustomFields = { ...existingCustomFields, ...customFieldsData };
              const mergedJson = Object.keys(mergedCustomFields).length > 0 ? JSON.stringify(mergedCustomFields) : null;
              
              if (name && name.trim()) {
                updateContactStmt.run(name, mergedJson, phoneNumber);
                existingContact.name = name;
              } else {
                updateContactStmt.run(existingContact.name, mergedJson, phoneNumber);
              }
              existingContact.custom_fields = mergedJson;
              duplicateCount++;
            }
          } else {
            // New contact - insert it
            const contactId = uuidv4();
            contactStmt.run(contactId, phoneNumber, name, customFieldsJson);
            // Update cache so subsequent rows in this batch can find it
            existingContactsCache.set(phoneNumber, { id: contactId, name, custom_fields: customFieldsJson });
            count++;
          }
          
          // Handle tags if provided
          if (tagsString && tagsString.trim()) {
            const tagNames = tagsString.split(',').map((t: string) => t.trim()).filter((t: string) => t);
            
            for (const tagName of tagNames) {
              let tagId = tagsCache.get(tagName);
              
              if (!tagId) {
                tagId = uuidv4();
                createTagStmt.run(tagId, tagName);
                tagsCache.set(tagName, tagId);
              }
              
              const contact = existingContactsCache.get(phoneNumber);
              if (contact) {
                linkTagStmt.run(contact.id, tagId);
              }
            }
          }
        }
      });
      
      processChunk(chunk);
      
      // Yield to event loop between chunks so UI doesn't freeze
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    // Send 100% progress
    if (mainWindow) {
      mainWindow.webContents.send('contacts:importProgress', {
        current: totalRows,
        total: totalRows,
        percent: 100
      });
    }
    
    console.log(`✅ Import complete: ${count} new, ${duplicateCount} duplicates, ${invalidCount} invalid (total: ${totalRows})`);
    
    return { 
      imported: count,
      invalid: invalidCount
    };
  });

  ipcMain.handle('contacts:addTag', async (_event, contactId: string, tagId: string) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO contact_tags (contact_id, tag_id)
      VALUES (?, ?)
    `);
    stmt.run(contactId, tagId);
  });

  ipcMain.handle('contacts:removeTag', async (_event, contactId: string, tagId: string) => {
    const stmt = db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?');
    stmt.run(contactId, tagId);
  });

  // ==================== TAG HANDLERS ====================
  ipcMain.handle('tags:getAll', async () => {
    const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
    return stmt.all();
  });

  ipcMain.handle('tags:create', async (_event, data: Partial<Tag>) => {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO tags (id, name, color)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(id, data.name, data.color || null);

    const getStmt = db.prepare('SELECT * FROM tags WHERE id = ?');
    return getStmt.get(id);
  });

  ipcMain.handle('tags:update', async (_event, id: string, data: Partial<Tag>) => {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.color !== undefined) {
      updates.push('color = ?');
      values.push(data.color);
    }

    if (updates.length > 0) {
      values.push(id);
      const stmt = db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...values);
    }
  });

  ipcMain.handle('tags:delete', async (_event, id: string) => {
    // Check if this is a system tag
    const checkStmt = db.prepare('SELECT name, is_system FROM tags WHERE id = ?');
    const tag = checkStmt.get(id) as any;
    
    if (tag && (tag.is_system || tag.name === 'BlackList')) {
      throw new Error('Cannot delete system tag. System tags are protected.');
    }
    
    const stmt = db.prepare('DELETE FROM tags WHERE id = ? AND is_system = 0');
    const result = stmt.run(id);
    
    if (result.changes === 0) {
      throw new Error('Tag not found or is a system tag');
    }
  });

  // ==================== GROUP EXTRACTOR HANDLERS ====================
  ipcMain.handle('extractor:getGroups', async (_event, accountId: string) => {
    return await whatsappManager.getGroups(accountId);
  });

  ipcMain.handle('extractor:getGroupParticipants', async (_event, accountId: string, groupId: string) => {
    return await whatsappManager.getGroupParticipants(accountId, groupId);
  });

  ipcMain.handle('groups:getGroups', async (_event, accountId: string) => {
    return await whatsappManager.getGroups(accountId);
  });

  ipcMain.handle('groups:getGroupParticipants', async (_event, accountId: string, groupId: string) => {
    return await whatsappManager.getGroupParticipants(accountId, groupId);
  });

  ipcMain.handle('groups:getInviteInfo', async (_event, accountId: string, inviteLink: string) => {
    return await whatsappManager.getGroupInviteInfo(accountId, inviteLink);
  });

  ipcMain.handle('groups:joinGroupByInviteLink', async (_event, accountId: string, inviteLink: string) => {
    return await whatsappManager.joinGroupByInviteLink(accountId, inviteLink);
  });

  // ==================== GROUP CAMPAIGNS HANDLERS ====================
  function normalizeGroupCampaignRow(row: any) {
    if (!row) return null;
    let days: number[] = [];
    try {
      days = JSON.parse(row.days_of_week || '[]');
    } catch {
      days = [];
    }
    return {
      ...row,
      days_of_week: days,
      skip_recent_contacts: undefined,
    };
  }

  ipcMain.handle('groupCampaigns:getAll', async () => {
    const stmt = db.prepare('SELECT * FROM group_campaigns ORDER BY created_at DESC');
    return (stmt.all() as any[]).map(normalizeGroupCampaignRow);
  });

  ipcMain.handle('groupCampaigns:getById', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM group_campaigns WHERE id = ?');
    return normalizeGroupCampaignRow(stmt.get(id));
  });

  ipcMain.handle('groupCampaigns:getTargets', async (_event, id: string) => {
    const stmt = db.prepare('SELECT group_id, group_name FROM group_campaign_targets WHERE campaign_id = ?');
    return stmt.all(id);
  });

  ipcMain.handle('groupCampaigns:getRuns', async (_event, id: string) => {
    const stmt = db.prepare('SELECT * FROM group_campaign_runs WHERE campaign_id = ? ORDER BY sent_at DESC LIMIT 200');
    return stmt.all(id);
  });

  ipcMain.handle('groupCampaigns:create', async (_event, data: {
    name: string;
    account_id: string;
    message?: string;
    media_path?: string;
    media_type?: string;
    media_caption?: string;
    days_of_week: number[];
    send_hour: number;
    send_minute: number;
    min_delay?: number;
    max_delay?: number;
    targets: { group_id: string; group_name: string }[];
  }) => {
    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO group_campaigns (id, name, account_id, message, media_path, media_type, media_caption, days_of_week, send_hour, send_minute, min_delay, max_delay, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    stmt.run(
      id,
      data.name,
      data.account_id,
      data.message || null,
      data.media_path || null,
      data.media_type || null,
      data.media_caption || null,
      JSON.stringify(data.days_of_week || []),
      data.send_hour,
      data.send_minute ?? 0,
      data.min_delay ?? 20,
      data.max_delay ?? 60
    );

    const insertTargetStmt = db.prepare(`
      INSERT OR IGNORE INTO group_campaign_targets (campaign_id, group_id, group_name)
      VALUES (?, ?, ?)
    `);
    const insertTargets = db.transaction((targets: { group_id: string; group_name: string }[]) => {
      for (const target of targets) {
        insertTargetStmt.run(id, target.group_id, target.group_name || target.group_id);
      }
    });
    insertTargets(data.targets || []);

    logActivity(db, 'campaign', `Group campaign "${data.name}" created`, id);

    const getStmt = db.prepare('SELECT * FROM group_campaigns WHERE id = ?');
    return normalizeGroupCampaignRow(getStmt.get(id));
  });

  ipcMain.handle('groupCampaigns:update', async (_event, id: string, data: {
    name?: string;
    account_id?: string;
    message?: string;
    media_path?: string;
    media_type?: string;
    media_caption?: string;
    days_of_week?: number[];
    send_hour?: number;
    send_minute?: number;
    min_delay?: number;
    max_delay?: number;
    targets?: { group_id: string; group_name: string }[];
  }) => {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
    if (data.account_id !== undefined) { updates.push('account_id = ?'); values.push(data.account_id); }
    if (data.message !== undefined) { updates.push('message = ?'); values.push(data.message); }
    if (data.media_path !== undefined) { updates.push('media_path = ?'); values.push(data.media_path); }
    if (data.media_type !== undefined) { updates.push('media_type = ?'); values.push(data.media_type); }
    if (data.media_caption !== undefined) { updates.push('media_caption = ?'); values.push(data.media_caption); }
    if (data.days_of_week !== undefined) { updates.push('days_of_week = ?'); values.push(JSON.stringify(data.days_of_week)); }
    if (data.send_hour !== undefined) { updates.push('send_hour = ?'); values.push(data.send_hour); }
    if (data.send_minute !== undefined) { updates.push('send_minute = ?'); values.push(data.send_minute); }
    if (data.min_delay !== undefined) { updates.push('min_delay = ?'); values.push(data.min_delay); }
    if (data.max_delay !== undefined) { updates.push('max_delay = ?'); values.push(data.max_delay); }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE group_campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    if (data.targets) {
      db.prepare('DELETE FROM group_campaign_targets WHERE campaign_id = ?').run(id);
      const insertTargetStmt = db.prepare(`
        INSERT OR IGNORE INTO group_campaign_targets (campaign_id, group_id, group_name)
        VALUES (?, ?, ?)
      `);
      const insertTargets = db.transaction((targets: { group_id: string; group_name: string }[]) => {
        for (const target of targets) {
          insertTargetStmt.run(id, target.group_id, target.group_name || target.group_id);
        }
      });
      insertTargets(data.targets);
    }

    const getStmt = db.prepare('SELECT * FROM group_campaigns WHERE id = ?');
    return normalizeGroupCampaignRow(getStmt.get(id));
  });

  ipcMain.handle('groupCampaigns:delete', async (_event, id: string) => {
    db.prepare('DELETE FROM group_campaigns WHERE id = ?').run(id);
  });

  ipcMain.handle('groupCampaigns:start', async (_event, id: string) => {
    const campaign = db.prepare('SELECT name FROM group_campaigns WHERE id = ?').get(id) as any;
    db.prepare(`UPDATE group_campaigns SET status = 'active' WHERE id = ?`).run(id);
    logActivity(db, 'campaign', `Group campaign "${campaign?.name || 'Unknown'}" started`, id);
  });

  ipcMain.handle('groupCampaigns:pause', async (_event, id: string) => {
    const campaign = db.prepare('SELECT name FROM group_campaigns WHERE id = ?').get(id) as any;
    db.prepare(`UPDATE group_campaigns SET status = 'paused' WHERE id = ?`).run(id);
    logActivity(db, 'pending', `Group campaign "${campaign?.name || 'Unknown'}" paused`, id);
  });

  ipcMain.handle('groupCampaigns:stop', async (_event, id: string) => {
    const campaign = db.prepare('SELECT name FROM group_campaigns WHERE id = ?').get(id) as any;
    db.prepare(`UPDATE group_campaigns SET status = 'stopped' WHERE id = ?`).run(id);
    logActivity(db, 'error', `Group campaign "${campaign?.name || 'Unknown'}" stopped`, id);
  });

  // ==================== CUSTOM FIELDS HANDLERS ====================
  ipcMain.handle('customFields:getAll', async () => {
    const stmt = db.prepare('SELECT * FROM custom_fields ORDER BY field_order ASC');
    return stmt.all();
  });

  ipcMain.handle('customFields:create', async (_event, data: any) => {
    const id = uuidv4();
    
    // Get next order number
    const maxOrderStmt = db.prepare('SELECT MAX(field_order) as max_order FROM custom_fields');
    const result = maxOrderStmt.get() as any;
    const nextOrder = (result?.max_order || 0) + 1;
    
    const stmt = db.prepare(`
      INSERT INTO custom_fields (id, name, label, type, required, field_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id, 
      data.name, 
      data.label, 
      data.type || 'text', 
      data.required ? 1 : 0,
      nextOrder
    );

    const getStmt = db.prepare('SELECT * FROM custom_fields WHERE id = ?');
    return getStmt.get(id);
  });

  ipcMain.handle('customFields:update', async (_event, id: string, data: any) => {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.label !== undefined) {
      updates.push('label = ?');
      values.push(data.label);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      values.push(data.type);
    }
    if (data.required !== undefined) {
      updates.push('required = ?');
      values.push(data.required ? 1 : 0);
    }
    if (data.field_order !== undefined) {
      updates.push('field_order = ?');
      values.push(data.field_order);
    }

    if (updates.length > 0) {
      values.push(id);
      const stmt = db.prepare(`UPDATE custom_fields SET ${updates.join(', ')} WHERE id = ?`);
      stmt.run(...values);
    }
  });

  ipcMain.handle('customFields:delete', async (_event, id: string) => {
    const stmt = db.prepare('DELETE FROM custom_fields WHERE id = ?');
    stmt.run(id);
  });

  // ==================== MESSAGE HANDLERS ====================
  ipcMain.handle('messages:send', async (_event, accountId: string, to: string, message: string) => {
    await whatsappManager.sendMessage(accountId, to, message, false); // Not a warmup message
    
    logActivity(db, 'message', `Message sent to ${to}`, accountId);
  });

  ipcMain.handle('messages:sendMedia', async (_event, accountId: string, to: string, filePath: string, caption?: string) => {
    await whatsappManager.sendMedia(accountId, to, filePath, caption);
  });

  ipcMain.handle('messages:saveTempFile', async (_event, fileName: string, buffer: Buffer) => {
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `whatsapp_${Date.now()}_${fileName}`);
    
    fs.writeFileSync(tempFilePath, buffer);
    
    return tempFilePath;
  });

  ipcMain.handle('messages:deleteTempFile', async (_event, filePath: string) => {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.warn('Failed to delete temp file:', error);
    }
  });

  ipcMain.handle('messages:getByChat', async (_event, softwareChatId: string) => {
    const stmt = db.prepare(`
      SELECT * FROM messages 
      WHERE software_chat_id = ?
        AND (is_warmup = 0 OR is_warmup IS NULL OR is_from_me = 0)
      ORDER BY timestamp ASC
    `);
    const messages = stmt.all(softwareChatId) as any[];
    
    return messages;
  });

  ipcMain.handle('messages:getChats', async (_event, accountId?: string, searchQuery?: string) => {
    // Query chats from the chats table with unread count and last message
    let query = `
      SELECT 
        c.id,
        c.contact_id,
        c.account_id,
        c.phone_number,
        c.status,
        c.photo,
        c.name,
        c.last_message_at,
        (SELECT COUNT(*) FROM messages m WHERE m.software_chat_id = c.id AND m.is_read = 0 AND m.is_from_me = 0) as unread_count
      FROM chats c
      WHERE 1=1
    `;
    
    const params: any[] = [];
    if (accountId) {
      query += ' AND c.account_id = ?';
      params.push(accountId);
    }
    
    query += ' ORDER BY c.last_message_at DESC';
    
    const chatsStmt = db.prepare(query);
    const chats = chatsStmt.all(...params) as any[];
    
    // Get last message for each chat
    const lastMsgStmt = db.prepare(`
      SELECT * FROM messages 
      WHERE software_chat_id = ?
        AND (is_warmup = 0 OR is_warmup IS NULL OR is_from_me = 0)
      ORDER BY timestamp DESC LIMIT 1
    `);
    
    const mappedChats = chats.map((chat) => {
      const lastMessage = lastMsgStmt.get(chat.id) as any;
      
      return {
        id: chat.id,
        contact_id: chat.contact_id,
        account_id: chat.account_id,
        phone_number: chat.phone_number,
        status: chat.status,
        photo: chat.photo,
        name: chat.name,
        last_message_at: chat.last_message_at,
        unread_count: chat.unread_count,
        last_message: lastMessage ? {
          id: lastMessage.id,
          chat_id: lastMessage.chat_id,
          software_chat_id: lastMessage.software_chat_id,
          account_id: lastMessage.account_id,
          message_text: lastMessage.message_text,
          message_type: lastMessage.message_type,
          media_filename: lastMessage.media_filename,
          media_mimetype: lastMessage.media_mimetype,
          from_number: lastMessage.from_number,
          to_number: lastMessage.to_number,
          sender_name: lastMessage.sender_name,
          is_from_me: lastMessage.is_from_me,
          is_handled: lastMessage.is_handled,
          is_read: lastMessage.is_read,
          type: lastMessage.type,
          timestamp: lastMessage.timestamp
        } : null
      };
    });
    
    // Filter out chats with no valid last message
    const validChats = mappedChats.filter(chat => {
      if (!chat.last_message) return false;
      
      const message = chat.last_message;
      const messageText = message.message_text;
      const messageType = message.message_type;
      
      // Allow media messages even without text
      const isMediaMessage = messageType === 'image' || messageType === 'video' || messageType === 'document';
      if (isMediaMessage) return true;
      
      if (!messageText || messageText.trim() === '') return false;
      if (messageText.trim().toLowerCase() === 'cc') return false;
      
      return true;
    });
    
    // Apply search filter
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return validChats.filter(chat => {
        const name = (chat.name || '').toLowerCase();
        const phoneNumber = chat.phone_number || '';
        return name.includes(q) || phoneNumber.includes(q);
      });
    }
    
    return validChats;
  });

  // Mark all incoming messages in a chat as read (when user opens the chat)
  ipcMain.handle('messages:markAsRead', async (_event, softwareChatId: string) => {
    const stmt = db.prepare(`
      UPDATE messages 
      SET is_read = 1 
      WHERE software_chat_id = ? AND is_from_me = 0 AND is_read = 0
    `);
    const result = stmt.run(softwareChatId);
    console.log(`📖 Marked ${result.changes} messages as read in chat:`, softwareChatId);
  });

  // Legacy handler - kept for backward compatibility
  ipcMain.handle('messages:markAsHandled', async (_event, chatId: string, accountId: string) => {
    const stmt = db.prepare(`
      UPDATE messages 
      SET is_handled = 1 
      WHERE chat_id = ? AND account_id = ? AND is_from_me = 0
    `);
    stmt.run(chatId, accountId);
  });

  // Update chat status (handled/unhandled) - this is a manual user action
  ipcMain.handle('messages:markChatStatus', async (_event, softwareChatId: string, status: string) => {
    const stmt = db.prepare(`UPDATE chats SET status = ? WHERE id = ?`);
    stmt.run(status, softwareChatId);
    console.log(`📝 Chat ${softwareChatId} marked as ${status}`);
  });

  // Mark all chats as handled or unhandled
  ipcMain.handle('messages:markAllChats', async (_event, accountId: string | undefined, handled: boolean) => {
    const status = handled ? 'handled' : 'unhandled';
    let query = `UPDATE chats SET status = ? WHERE 1=1`;
    const params: any[] = [status];
    
    if (accountId) {
      query += ' AND account_id = ?';
      params.push(accountId);
    }
    
    const stmt = db.prepare(query);
    const result = stmt.run(...params);
    
    console.log(`📝 Marked ${result.changes} chats as ${status}`);
    return result.changes;
  });

  // Get chat photo file as buffer
  ipcMain.handle('messages:getChatPhoto', async (_event, photoPath: string) => {
    try {
      if (!photoPath || !fs.existsSync(photoPath)) {
        return null;
      }
      const buffer = fs.readFileSync(photoPath);
      return { buffer: Array.from(buffer), fileName: path.basename(photoPath) };
    } catch (error) {
      console.warn('Failed to read chat photo:', error);
      return null;
    }
  });

  // Get media file for a message
  ipcMain.handle('messages:getMediaFile', async (_event, messageId: string) => {
    try {
      const message = db.prepare('SELECT media_filename FROM messages WHERE id = ?').get(messageId) as any;
      
      if (!message || !message.media_filename) {
        return null;
      }
      
      // Media files are stored in user data directory
      const mediaPath = path.join(app.getPath('userData'), 'media', message.media_filename);
      
      if (!fs.existsSync(mediaPath)) {
        console.error('Media file not found:', mediaPath);
        return null;
      }
      
      const buffer = fs.readFileSync(mediaPath);
      return {
        buffer: Array.from(buffer), // Convert to array for IPC transfer
        fileName: message.media_filename
      };
    } catch (error) {
      console.error('Failed to read media file:', error);
      return null;
    }
  });

  // ==================== WARMUP HANDLERS ====================
  ipcMain.handle('warmup:start', async (_event, accountIds: string[], minDelay: number, maxDelay: number) => {
    return await warmUpService.startSession(accountIds, minDelay, maxDelay);
  });

  ipcMain.handle('warmup:stop', async (_event, sessionId: string) => {
    await warmUpService.stopSession(sessionId);
  });

  ipcMain.handle('warmup:getActive', async () => {
    return await warmUpService.getActiveSession();
  });

  ipcMain.handle('warmup:getStats', async () => {
    const db = getDatabase();
    
    // סטטיסטיקות לכל חשבון
    const accountStats = db.prepare(`
      SELECT 
        from_account_id as account_id,
        COUNT(*) as total_sent,
        MAX(sent_at) as last_sent
      FROM warmup_messages
      GROUP BY from_account_id
    `).all();
    
    return accountStats;
  });

  ipcMain.handle('warmup:getLogs', async (_event, limit: number = 50) => {
    const db = getDatabase();
    
    const logs = db.prepare(`
      SELECT 
        wm.*,
        a1.name as from_name,
        a1.phone_number as from_phone,
        a2.name as to_name,
        a2.phone_number as to_phone
      FROM warmup_messages wm
      LEFT JOIN accounts a1 ON wm.from_account_id = a1.id
      LEFT JOIN accounts a2 ON wm.to_account_id = a2.id
      ORDER BY wm.sent_at DESC
      LIMIT ?
    `).all(limit);
    
    return logs;
  });

  ipcMain.handle('warmup:getSessionStats', async (_event, sessionId: string) => {
    const db = getDatabase();
    
    const stats = db.prepare(`
      SELECT 
        from_account_id as account_id,
        COUNT(*) as messages_sent
      FROM warmup_messages
      WHERE session_id = ?
      GROUP BY from_account_id
    `).all(sessionId);
    
    return stats;
  });

  ipcMain.handle('warmup:getAllSessions', async () => {
    const db = getDatabase();
    
    const sessions = db.prepare(`
      SELECT 
        ws.*,
        (SELECT COUNT(*) FROM warmup_messages WHERE session_id = ws.id) as total_messages,
        (SELECT COUNT(DISTINCT from_account_id) FROM warmup_messages WHERE session_id = ws.id) as accounts_count
      FROM warmup_sessions ws
      ORDER BY ws.started_at DESC
      LIMIT 20
    `).all();
    
    return sessions;
  });

  ipcMain.handle('warmup:getSessionDetails', async (_event, sessionId: string) => {
    const db = getDatabase();
    
    // Get session info
    const session = db.prepare('SELECT * FROM warmup_sessions WHERE id = ?').get(sessionId);
    
    // Get accounts that participated
    const accounts = db.prepare(`
      SELECT 
        a.id,
        a.name,
        a.phone_number,
        COUNT(wm.id) as messages_sent
      FROM warmup_accounts wa
      LEFT JOIN accounts a ON wa.account_id = a.id
      LEFT JOIN warmup_messages wm ON wm.from_account_id = a.id AND wm.session_id = ?
      WHERE wa.session_id = ?
      GROUP BY a.id
    `).all(sessionId, sessionId);
    
    // Get message logs for this session
    const logs = db.prepare(`
      SELECT 
        wm.*,
        a1.name as from_name,
        a1.phone_number as from_phone,
        a2.name as to_name,
        a2.phone_number as to_phone
      FROM warmup_messages wm
      LEFT JOIN accounts a1 ON wm.from_account_id = a1.id
      LEFT JOIN accounts a2 ON wm.to_account_id = a2.id
      WHERE wm.session_id = ?
      ORDER BY wm.sent_at DESC
      LIMIT 50
    `).all(sessionId);
    
    return { session, accounts, logs };
  });

  // ==================== STATS HANDLERS ====================
  ipcMain.handle('stats:getDashboard', async () => {
    const accountsStmt = db.prepare("SELECT COUNT(*) as count FROM accounts WHERE status = 'connected'");
    const accountsConnected = (accountsStmt.get() as any).count;

    const today = new Date().toISOString().split('T')[0];
    
    // Count messages from campaigns that were actually sent today
    const campaignMessagesStmt = db.prepare(`
      SELECT COUNT(*) as count FROM campaign_contacts 
      WHERE DATE(sent_at) = ? AND status = 'sent'
    `);
    const messagesSentToday = (campaignMessagesStmt.get(today) as any).count;

    const campaignsStmt = db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 'running'");
    const activeCampaigns = (campaignsStmt.get() as any).count;

    const pendingStmt = db.prepare("SELECT COUNT(*) as count FROM campaign_contacts WHERE status = 'pending'");
    const pendingMessages = (pendingStmt.get() as any).count;

    return {
      accounts_connected: accountsConnected,
      messages_sent_today: messagesSentToday,
      active_campaigns: activeCampaigns,
      pending_messages: pendingMessages
    };
  });

  ipcMain.handle('stats:getRecentActivities', async (_event, limit: number = 10) => {
    const stmt = db.prepare(`
      SELECT * FROM activities 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  });

  // ==================== DETAILED STATISTICS HANDLERS ====================

  function buildDailyRange(startDate: string, endDate: string): string[] {
    const days: string[] = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const cursor = new Date(start);
    while (cursor <= end) {
      days.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function queryCampaignContactStats(
    campaignType: 'message' | 'group_adder',
    startDate: string,
    endDate: string,
    accountId?: string,
    campaignId?: string
  ) {
    const conditions: string[] = [
      "c.campaign_type = ?",
      "cc.sent_at IS NOT NULL",
      "DATE(cc.sent_at) BETWEEN ? AND ?"
    ];
    const params: any[] = [campaignType, startDate, endDate];

    if (accountId) {
      conditions.push('cc.sent_by_account_id = ?');
      params.push(accountId);
    }
    if (campaignId) {
      conditions.push('cc.campaign_id = ?');
      params.push(campaignId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = db.prepare(`
      SELECT 
        cc.*,
        c.name as campaign_name,
        con.name as contact_name,
        a.name as account_name,
        a.phone_number as account_phone
      FROM campaign_contacts cc
      JOIN campaigns c ON cc.campaign_id = c.id
      LEFT JOIN contacts con ON cc.phone_number = con.phone_number
      LEFT JOIN accounts a ON cc.sent_by_account_id = a.id
      WHERE ${whereClause}
      ORDER BY cc.sent_at DESC
    `).all(...params) as any[];

    const dailyMap = new Map<string, { sent: number; failed: number }>();
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const day = String(row.sent_at).split(/[ T]/)[0];
      if (!dailyMap.has(day)) dailyMap.set(day, { sent: 0, failed: 0 });
      const bucket = dailyMap.get(day)!;
      if (row.status === 'sent') {
        bucket.sent++;
        sent++;
      } else if (row.status === 'failed') {
        bucket.failed++;
        failed++;
      }
    }

    const daily = buildDailyRange(startDate, endDate).map(date => ({
      date,
      sent: dailyMap.get(date)?.sent || 0,
      failed: dailyMap.get(date)?.failed || 0
    }));

    const total = rows.length;
    const successRate = total > 0 ? Math.round((sent / total) * 1000) / 10 : 0;

    return {
      summary: { total, sent, failed, successRate },
      daily,
      rows
    };
  }

  ipcMain.handle('stats:getCampaignStats', async (_event, startDate: string, endDate: string, accountId?: string, campaignId?: string) => {
    return queryCampaignContactStats('message', startDate, endDate, accountId, campaignId);
  });

  ipcMain.handle('stats:getGroupAdderStats', async (_event, startDate: string, endDate: string, accountId?: string, campaignId?: string) => {
    return queryCampaignContactStats('group_adder', startDate, endDate, accountId, campaignId);
  });

  ipcMain.handle('stats:getGroupCampaignStats', async (_event, startDate: string, endDate: string, accountId?: string, campaignId?: string) => {
    const conditions: string[] = ["gcr.run_date BETWEEN ? AND ?"];
    const params: any[] = [startDate, endDate];

    if (accountId) {
      conditions.push('gc.account_id = ?');
      params.push(accountId);
    }
    if (campaignId) {
      conditions.push('gcr.campaign_id = ?');
      params.push(campaignId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = db.prepare(`
      SELECT 
        gcr.*,
        gc.name as campaign_name,
        gc.account_id,
        a.name as account_name,
        a.phone_number as account_phone
      FROM group_campaign_runs gcr
      JOIN group_campaigns gc ON gcr.campaign_id = gc.id
      LEFT JOIN accounts a ON gc.account_id = a.id
      WHERE ${whereClause}
      ORDER BY gcr.sent_at DESC
    `).all(...params) as any[];

    const dailyMap = new Map<string, { sent: number; failed: number }>();
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const day = row.run_date;
      if (!dailyMap.has(day)) dailyMap.set(day, { sent: 0, failed: 0 });
      const bucket = dailyMap.get(day)!;
      if (row.status === 'sent') {
        bucket.sent++;
        sent++;
      } else {
        bucket.failed++;
        failed++;
      }
    }

    const daily = buildDailyRange(startDate, endDate).map(date => ({
      date,
      sent: dailyMap.get(date)?.sent || 0,
      failed: dailyMap.get(date)?.failed || 0
    }));

    const total = rows.length;
    const successRate = total > 0 ? Math.round((sent / total) * 1000) / 10 : 0;

    return {
      summary: { total, sent, failed, successRate },
      daily,
      rows
    };
  });

  ipcMain.handle('stats:getWarmupStats', async (_event, startDate: string, endDate: string, accountId?: string) => {
    const conditions: string[] = ["DATE(wm.sent_at) BETWEEN ? AND ?"];
    const params: any[] = [startDate, endDate];

    if (accountId) {
      conditions.push('(wm.from_account_id = ? OR wm.to_account_id = ?)');
      params.push(accountId, accountId);
    }

    const whereClause = conditions.join(' AND ');

    const rows = db.prepare(`
      SELECT 
        wm.*,
        fa.name as from_account_name,
        fa.phone_number as from_account_phone,
        ta.name as to_account_name,
        ta.phone_number as to_account_phone
      FROM warmup_messages wm
      LEFT JOIN accounts fa ON wm.from_account_id = fa.id
      LEFT JOIN accounts ta ON wm.to_account_id = ta.id
      WHERE ${whereClause}
      ORDER BY wm.sent_at DESC
    `).all(...params) as any[];

    const dailyMap = new Map<string, { sent: number; failed: number }>();
    for (const row of rows) {
      const day = String(row.sent_at).split(/[ T]/)[0];
      if (!dailyMap.has(day)) dailyMap.set(day, { sent: 0, failed: 0 });
      dailyMap.get(day)!.sent++;
    }

    const daily = buildDailyRange(startDate, endDate).map(date => ({
      date,
      sent: dailyMap.get(date)?.sent || 0,
      failed: dailyMap.get(date)?.failed || 0
    }));

    const total = rows.length;

    return {
      summary: { total, sent: total, failed: 0, successRate: total > 0 ? 100 : 0 },
      daily,
      rows
    };
  });

  ipcMain.handle('stats:getCampaignsList', async (_event, campaignType: 'message' | 'group_adder') => {
    const rows = db.prepare(`
      SELECT id, name FROM campaigns WHERE campaign_type = ? ORDER BY created_at DESC
    `).all(campaignType);
    return rows;
  });

  ipcMain.handle('stats:getGroupCampaignsList', async () => {
    const rows = db.prepare(`
      SELECT id, name FROM group_campaigns ORDER BY created_at DESC
    `).all();
    return rows;
  });

  ipcMain.handle('stats:exportReport', async (
    _event,
    type: 'campaign' | 'group_campaign' | 'warmup' | 'group_adder',
    startDate: string,
    endDate: string,
    accountId?: string,
    campaignId?: string
  ) => {
    const { dialog } = await import('electron');

    let rows: any[] = [];
    let excelData: any[] = [];
    let sheetName = 'Report';

    if (type === 'campaign' || type === 'group_adder') {
      const result = queryCampaignContactStats(type === 'campaign' ? 'message' : 'group_adder', startDate, endDate, accountId, campaignId);
      rows = result.rows;
      sheetName = type === 'campaign' ? 'Campaign Report' : 'Group Adder Report';
      excelData = rows.map((r: any) => ({
        'Campaign': r.campaign_name || '-',
        'Phone Number': r.phone_number,
        'Contact Name': r.contact_name || '-',
        'Status': r.status,
        'Processed By': r.account_name || r.account_phone || '-',
        'Processed At': r.sent_at ? new Date(r.sent_at).toLocaleString() : '-',
        'Result Code': r.result_code || '-',
        'Error': r.error || '-'
      }));
    } else if (type === 'group_campaign') {
      const conditions: string[] = ["gcr.run_date BETWEEN ? AND ?"];
      const params: any[] = [startDate, endDate];
      if (accountId) {
        conditions.push('gc.account_id = ?');
        params.push(accountId);
      }
      if (campaignId) {
        conditions.push('gcr.campaign_id = ?');
        params.push(campaignId);
      }
      rows = db.prepare(`
        SELECT gcr.*, gc.name as campaign_name, a.name as account_name, a.phone_number as account_phone
        FROM group_campaign_runs gcr
        JOIN group_campaigns gc ON gcr.campaign_id = gc.id
        LEFT JOIN accounts a ON gc.account_id = a.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY gcr.sent_at DESC
      `).all(...params) as any[];
      sheetName = 'Groups Campaign Report';
      excelData = rows.map((r: any) => ({
        'Campaign': r.campaign_name || '-',
        'Group': r.group_name || r.group_id,
        'Account': r.account_name || r.account_phone || '-',
        'Status': r.status,
        'Run Date': r.run_date,
        'Sent At': r.sent_at ? new Date(r.sent_at).toLocaleString() : '-',
        'Error': r.error || '-'
      }));
    } else if (type === 'warmup') {
      const conditions: string[] = ["DATE(wm.sent_at) BETWEEN ? AND ?"];
      const params: any[] = [startDate, endDate];
      if (accountId) {
        conditions.push('(wm.from_account_id = ? OR wm.to_account_id = ?)');
        params.push(accountId, accountId);
      }
      rows = db.prepare(`
        SELECT wm.*, fa.name as from_account_name, fa.phone_number as from_account_phone,
               ta.name as to_account_name, ta.phone_number as to_account_phone
        FROM warmup_messages wm
        LEFT JOIN accounts fa ON wm.from_account_id = fa.id
        LEFT JOIN accounts ta ON wm.to_account_id = ta.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY wm.sent_at DESC
      `).all(...params) as any[];
      sheetName = 'Warm-up Report';
      excelData = rows.map((r: any) => ({
        'From': r.from_account_name || r.from_account_phone || '-',
        'To': r.to_account_name || r.to_account_phone || '-',
        'Message': r.message_text || '-',
        'Sent At': r.sent_at ? new Date(r.sent_at).toLocaleString() : '-'
      }));
    }

    const desktopPath = app.getPath('desktop');
    const defaultFileName = `${sheetName.replace(/[^a-zA-Z0-9א-ת]/g, '_')}_${startDate}_to_${endDate}.xlsx`;

    const result = await dialog.showSaveDialog({
      title: 'Save Statistics Report',
      defaultPath: path.join(desktopPath, defaultFileName),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync(result.filePath, buffer);

    return result.filePath;
  });

  // ==================== MESSAGE TEMPLATES HANDLERS ====================
  ipcMain.handle('templates:create', async (_event, data: any) => {
    const db = getDatabase();
    const id = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO message_templates (id, name, message, media_path, media_type)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, data.name, data.message, data.media_path || null, data.media_type || null);
    
    const getStmt = db.prepare('SELECT * FROM message_templates WHERE id = ?');
    return getStmt.get(id);
  });

  ipcMain.handle('templates:getAll', async () => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM message_templates ORDER BY created_at DESC').all();
  });

  ipcMain.handle('templates:getById', async (_event, id: string) => {
    const db = getDatabase();
    return db.prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  });

  ipcMain.handle('templates:update', async (_event, id: string, data: any) => {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE message_templates 
      SET name = ?, message = ?, media_path = ?, media_type = ?, updated_at = ?
      WHERE id = ?
    `);
    
    stmt.run(
      data.name,
      data.message,
      data.media_path || null,
      data.media_type || null,
      new Date().toISOString(),
      id
    );
  });

  ipcMain.handle('templates:delete', async (_event, id: string) => {
    const db = getDatabase();
    db.prepare('DELETE FROM message_templates WHERE id = ?').run(id);
  });

  ipcMain.handle('templates:getMediaFile', async (_event, mediaPath: string) => {
    try {
      if (!fs.existsSync(mediaPath)) {
        throw new Error('File not found');
      }
      
      const buffer = fs.readFileSync(mediaPath);
      const fileName = path.basename(mediaPath);
      
      return {
        buffer: Array.from(buffer), // Convert to array for IPC transfer
        fileName
      };
    } catch (error) {
      console.error('Failed to read media file:', error);
      return null;
    }
  });

  // ==================== FLOWS HANDLERS ====================
  ipcMain.handle('flows:create', async (_event, flowData: any) => {
    const db = getDatabase();
    const id = uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO flows (id, name, description, account_ids, is_active)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      flowData.name,
      flowData.description || null,
      JSON.stringify(flowData.account_ids || []),
      flowData.is_active !== undefined ? (flowData.is_active ? 1 : 0) : 1
    );
    
    logActivity(db, 'flow', `Flow "${flowData.name}" created`, id);
    return id;
  });

  ipcMain.handle('flows:save', async (_event, flowId: string, flowData: any) => {
    const db = getDatabase();
    const timestamp = new Date().toISOString();
    const nodes = flowData?.nodes || [];
    const edges = flowData?.edges || [];

    db.prepare('UPDATE flows SET name = ?, description = ?, account_ids = ?, updated_at = ? WHERE id = ?').run(
      flowData?.name,
      flowData?.description || null,
      JSON.stringify(flowData?.account_ids || []),
      timestamp,
      flowId
    );
    
    // מחק nodes ו-edges ישנים
    db.prepare('DELETE FROM flow_nodes WHERE flow_id = ?').run(flowId);
    db.prepare('DELETE FROM flow_edges WHERE flow_id = ?').run(flowId);
    
    // הוסף nodes חדשים
    const nodeStmt = db.prepare(`
      INSERT INTO flow_nodes (id, flow_id, type, position_x, position_y, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    for (const node of nodes) {
      nodeStmt.run(
        node.id,
        flowId,
        node.type,
        node.position.x,
        node.position.y,
        JSON.stringify(node.data)
      );
    }
    
    // הוסף edges חדשים
    const edgeStmt = db.prepare(`
      INSERT INTO flow_edges (id, flow_id, source, target, label)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const edge of edges) {
      edgeStmt.run(
        edge.id,
        flowId,
        edge.source,
        edge.target,
        edge.label || null
      );
    }
    
    const flow = db.prepare('SELECT name FROM flows WHERE id = ?').get(flowId) as any;
    logActivity(db, 'flow', `Flow "${flow.name}" updated`, flowId);
  });

  ipcMain.handle('flows:getAll', async () => {
    const db = getDatabase();
    const flows = db.prepare('SELECT * FROM flows ORDER BY created_at DESC').all() as any[];
    
    // Parse account_ids
    return flows.map(flow => ({
      ...flow,
      account_ids: flow.account_ids ? JSON.parse(flow.account_ids) : [],
      is_active: Boolean(flow.is_active)
    }));
  });

  ipcMain.handle('flows:getById', async (_event, flowId: string) => {
    const db = getDatabase();
    
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as any;
    if (!flow) return null;
    
    const nodes = db.prepare('SELECT * FROM flow_nodes WHERE flow_id = ?').all(flowId) as any[];
    const edges = db.prepare('SELECT * FROM flow_edges WHERE flow_id = ?').all(flowId) as any[];
    
    return {
      flow: {
        ...flow,
        account_ids: flow.account_ids ? JSON.parse(flow.account_ids) : [],
        is_active: Boolean(flow.is_active)
      },
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: { x: n.position_x, y: n.position_y },
        data: JSON.parse(n.data || '{}')
      })),
      edges
    };
  });

  ipcMain.handle('flows:toggleActive', async (_event, flowId: string) => {
    const db = getDatabase();
    db.prepare('UPDATE flows SET is_active = NOT is_active, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), flowId);
    
    const flow = db.prepare('SELECT name, is_active FROM flows WHERE id = ?').get(flowId) as any;
    const status = flow.is_active ? 'activated' : 'deactivated';
    logActivity(db, 'flow', `Flow "${flow.name}" ${status}`, flowId);
  });

  ipcMain.handle('flows:delete', async (_event, flowId: string) => {
    const db = getDatabase();
    const flow = db.prepare('SELECT name FROM flows WHERE id = ?').get(flowId) as any;
    
    db.prepare('DELETE FROM flows WHERE id = ?').run(flowId);
    logActivity(db, 'flow', `Flow "${flow.name}" deleted`, flowId);
  });

  // ==================== AUTO-UPDATER HANDLERS ====================
  ipcMain.handle('updater:check-for-updates', async () => {
    const { checkForUpdates } = await import('./updater');
    return checkForUpdates();
  });

  ipcMain.handle('updater:download-update', async () => {
    const { downloadUpdate } = await import('./updater');
    return downloadUpdate();
  });

  ipcMain.handle('updater:install-update', async () => {
    const { quitAndInstall } = await import('./updater');
    quitAndInstall();
  });

  ipcMain.handle('updater:get-version', () => {
    return app.getVersion();
  });

  // ==================== LOGS HANDLERS ====================
  ipcMain.handle('logs:get', async () => {
    return logger.getLogs();
  });

  ipcMain.handle('logs:clear', async () => {
    logger.clearLogs();
  });

  // ==================== AI CHATBOT (מערך היח״ש) ====================
  // Config, knowledge and conversation inspection. Kept separate from the
  // campaign handlers above — nothing here touches bulk sending.

  ipcMain.handle('chatbot:getConfig', () => withDbRecovery(() => getChatbotConfig(getDatabase())));

  ipcMain.handle('chatbot:saveConfig', (_event, patch) => withDbRecovery(() => {
    saveChatbotConfig(getDatabase(), patch ?? {});
    return getChatbotConfig(getDatabase());
  }));

  // Wrapped in withDbRecovery: this is the first thing the chatbot page calls,
  // so a stale connection surfaced here as an unrecoverable page error.
  ipcMain.handle('chatbot:getStatus', () => withDbRecovery(() => {
    const db = getDatabase();
    const config = getChatbotConfig(db);
    const counts = knowledgeService.countByCategory();
    const conv = db.prepare(`SELECT COUNT(*) AS n FROM chatbot_conversations`).get() as { n: number };
    const active = db.prepare(`SELECT COUNT(*) AS n FROM chatbot_conversations WHERE status = 'active'`).get() as { n: number };
    const esc = db.prepare(`SELECT COUNT(*) AS n FROM chatbot_escalations WHERE status != 'handled'`).get() as { n: number };
    const req = db.prepare(`SELECT COUNT(*) AS n FROM chatbot_requests`).get() as { n: number };
    return {
      enabled: config.enabled,
      hasApiKey: Boolean(config.apiKey),
      model: config.model,
      knowledgeCounts: counts,
      conversations: conv?.n ?? 0,
      activeConversations: active?.n ?? 0,
      openEscalations: esc?.n ?? 0,
      requests: req?.n ?? 0,
    };
  }));

  ipcMain.handle('chatbot:getWorkflows', () =>
    WORKFLOWS.map(w => ({
      id: w.id,
      intent: w.intent,
      label: w.label,
      tools: w.tools,
      requiredFields: w.requiredFields ?? [],
    })),
  );

  ipcMain.handle('chatbot:getConversations', (_event, limit?: number) =>
    withDbRecovery(() => chatbotService.getConversationManager().list(limit ?? 100)),
  );

  ipcMain.handle('chatbot:getMessages', (_event, conversationId: string) =>
    chatbotService.getConversationManager().messages(conversationId),
  );

  ipcMain.handle('chatbot:getEscalations', () => withDbRecovery(() =>
    getDatabase().prepare(`SELECT * FROM chatbot_escalations ORDER BY created_at DESC LIMIT 200`).all(),
  ));

  ipcMain.handle('chatbot:getRequests', () => withDbRecovery(() =>
    getDatabase().prepare(`SELECT * FROM chatbot_requests ORDER BY created_at DESC LIMIT 200`).all(),
  ));

  ipcMain.handle('chatbot:getErrors', () => withDbRecovery(() =>
    getDatabase().prepare(`SELECT * FROM chatbot_errors ORDER BY created_at DESC LIMIT 100`).all(),
  ));

  // ---- Knowledge management ----
  ipcMain.handle('chatbot:knowledge:list', (_event, category?: string) =>
    withDbRecovery(() => knowledgeService.list(category as any)),
  );

  ipcMain.handle('chatbot:knowledge:create', (_event, entry) => withDbRecovery(() => knowledgeService.create(entry)));

  ipcMain.handle('chatbot:knowledge:update', (_event, id: string, patch) => {
    knowledgeService.update(id, patch ?? {});
    return knowledgeService.get(id);
  });

  ipcMain.handle('chatbot:knowledge:delete', (_event, id: string) => {
    knowledgeService.delete(id);
  });

  // Paste a whole document; it is split into sections so retrieval returns the
  // relevant part instead of the entire file.
  ipcMain.handle('chatbot:knowledge:bulkImport', (_event, category: string, text: string) =>
    withDbRecovery(() => knowledgeService.bulkImport(category as any, text ?? '')),
  );

  ipcMain.handle('chatbot:knowledge:deleteDemo', () => {
    const info = db.prepare(`DELETE FROM chatbot_knowledge WHERE title LIKE '[דוגמה]%'`).run();
    return { deleted: info.changes };
  });

  /**
   * Test console: runs a full turn (intent → workflow → tools → reply) without
   * sending anything over WhatsApp, so the flow can be exercised safely.
   */
  ipcMain.handle('chatbot:simulate', async (_event, phoneNumber: string, message: string) => {
    if (!chatbotService) return { handled: false, error: 'Chatbot service not initialized' };
    return chatbotService.simulate(phoneNumber || 'test-console', message);
  });

  // ---- FYI broadcasts ----
  ipcMain.handle('chatbot:getFyiMessages', () => withDbRecovery(() =>
    getDatabase().prepare(`SELECT * FROM chatbot_fyi_messages ORDER BY created_at DESC LIMIT 200`).all(),
  ));

  ipcMain.handle('chatbot:sendDigestNow', async () => {
    if (!fyiDigestScheduler) return { ok: false, count: 0, delivered: [], error: 'Scheduler not initialized' };
    return fyiDigestScheduler.sendNow();
  });

  // ---- Contacts who wrote to the bot ----
  ipcMain.handle('chatbot:getKnownContacts', () => withDbRecovery(() =>
    getDatabase()
      .prepare(`SELECT * FROM chatbot_known_contacts ORDER BY updated_at DESC LIMIT 500`)
      .all(),
  ));

  ipcMain.handle('chatbot:resetConversation', (_event, phoneNumber: string) => {
    db.prepare(`UPDATE chatbot_conversations SET status = 'completed' WHERE phone_number = ? AND status = 'active'`)
      .run(phoneNumber);
  });
}

export { whatsappManager, campaignScheduler, warmUpService, inboxManager };
