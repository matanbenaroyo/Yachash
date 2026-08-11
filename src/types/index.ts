// Account types
export interface Account {
  id: string;
  phone_number: string;
  name?: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'qr' | 'pairing';
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  proxy_password?: string;
  proxy_type?: 'http' | 'socks5';
  session_path?: string;
  qr_code?: string;
  pairing_code?: string;
  profile_picture_url?: string;
  duoplus_device_id?: string;
  last_seen?: string;
  created_at: string;
}

// DuoPlus cloud-phone integration types
export type DuoPlusTapMode = 'auto' | 'coordinates' | 'enter';

export interface DuoPlusSettings {
  apiKey: string;
  tapMode: DuoPlusTapMode;
  tapX: number | null;
  tapY: number | null;
}

export interface DuoPlusStatusItem {
  id: string;
  name: string;
  status: number;
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  type?: 'http' | 'socks5'; // Only HTTP is supported for authentication
}

// Campaign types
export type CampaignType = 'message' | 'group_adder';

export type CampaignContactResultCode =
  | 'added'
  | 'invite_sent'
  | 'not_admin'
  | 'already_in_group'
  | 'privacy_restricted'
  | 'not_registered'
  | 'recently_left'
  | 'community_restricted'
  | 'group_full'
  | 'account_not_connected'
  | 'group_not_found'
  | 'group_access_denied'
  | 'unknown_error';

export interface WhatsAppGroupSummary {
  id: string;
  name: string;
  participantCount: number;
  description?: string;
  isAdmin: boolean;
}

export interface WhatsAppGroupParticipant {
  id: string;
  phoneNumber: string;
  name?: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface GroupAddParticipantResult {
  success: boolean;
  resultCode: CampaignContactResultCode;
  rawCode?: number | null;
  message: string;
  isInviteV4Sent?: boolean;
  participantId?: string;
}

export interface WhatsAppGroupInviteInfo {
  inviteCode: string;
  groupId?: string | null;
  groupName: string;
  participantCount?: number | null;
  description?: string | null;
}

export type GroupJoinByInviteStatus = 'joined' | 'already_joined' | 'pending_approval' | 'account_restricted' | 'invalid_invite' | 'account_not_connected' | 'failed';

export interface GroupJoinByInviteResult {
  success: boolean;
  status: GroupJoinByInviteStatus;
  message: string;
  groupId?: string | null;
  groupName?: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  message: string;
  campaign_type?: CampaignType;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'stopped';
  min_delay: number;
  max_delay: number;
  max_messages_per_day: number;
  start_hour: number;
  end_hour: number;
  media_path?: string;
  media_type?: 'image' | 'video' | 'document';
  media_caption?: string;
  scheduled_start_datetime?: string;
  messages_before_break?: number; // מספר הודעות לפני הפסקה (אופציונלי)
  break_duration?: number; // משך ההפסקה בדקות (אופציונלי)
  skip_recent_contacts?: boolean; // דלג על אנשי קשר שקיבלו הודעה לאחרונה
  skip_recent_days?: number; // מספר ימים לאחור לבדיקה
  target_group_id?: string;
  target_group_name?: string;
  group_source_account_id?: string;
  source_tag_ids?: string[];
  message_variants?: string[]; // גרסאות נוספות של ההודעה, נבחרת אחת אקראית בכל שליחה
  send_mode?: 'web' | 'cloud_phone'; // 'cloud_phone' = send via DuoPlus cloud phone (text only)
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  phone_number: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  sent_by_account_id?: string;
  sent_at?: string;
  error?: string;
  retry_count?: number;
  result_code?: CampaignContactResultCode;
}

export interface CampaignStats {
  total: number;
  sent: number;
  pending: number;
  failed: number;
}

// Group campaign types (recurring scheduled broadcasts to WhatsApp groups)
export interface GroupCampaignTarget {
  group_id: string;
  group_name: string;
}

export interface GroupCampaign {
  id: string;
  name: string;
  account_id: string;
  message?: string;
  media_path?: string;
  media_type?: 'image' | 'video';
  media_caption?: string;
  days_of_week: number[]; // 0 = Sunday ... 6 = Saturday
  send_hour: number;
  send_minute: number;
  min_delay: number;
  max_delay: number;
  status: 'active' | 'paused' | 'stopped';
  last_run_date?: string;
  created_at: string;
}

export interface GroupCampaignRun {
  id: string;
  campaign_id: string;
  group_id: string;
  group_name: string;
  status: 'sent' | 'failed';
  error?: string;
  run_date: string;
  sent_at: string;
}

// Contact types
export interface Contact {
  id: string;
  phone_number: string;
  name?: string;
  custom_fields?: Record<string, string>; // שדות מותאמים אישית
  created_at: string;
  tags?: Tag[];
}

export interface CustomField {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'url';
  required: boolean;
  order: number;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  is_system?: boolean;
}

// Message types
export interface Message {
  id: string;
  account_id: string;
  chat_id: string;
  software_chat_id?: string;
  from_number: string;
  to_number: string;
  sender_name?: string;
  contact_name?: string;
  contact_number?: string;
  message_text?: string;
  message_type: string;
  media_filename?: string;
  media_mimetype?: string;
  is_from_me: boolean;
  is_handled: boolean;
  is_read: boolean;
  is_warmup?: boolean;
  type?: string;
  timestamp: string;
}

export interface Chat {
  id: string;
  contact_id: string;
  account_id: string;
  phone_number: string;
  status: 'handled' | 'unhandled';
  photo?: string;
  name?: string;
  last_message_at?: string;
  unread_count: number;
  last_message?: Message;
  // Legacy fields for backward compat
  chat_id?: string;
  is_handled?: boolean;
}

// Warm-up types
export interface WarmUpSession {
  id: string;
  status: 'active' | 'stopped';
  min_delay: number;
  max_delay: number;
  started_at: string;
  stopped_at?: string;
  accounts: string[];
  messages_sent_today?: number;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  account_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface FlowNode {
  id: string;
  type: string;
  position: {
    x: number;
    y: number;
  };
  data: any;
  [key: string]: any;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  [key: string]: any;
}

export interface MessageTemplate {
  id: string;
  name: string;
  message: string;
  media_path?: string;
  media_type?: 'image' | 'video' | 'document';
  created_at: string;
  updated_at: string;
}

// Stats types
export interface DashboardStats {
  accounts_connected: number;
  messages_sent_today: number;
  active_campaigns: number;
  pending_messages: number;
}

// Detailed statistics page types
export interface StatsSummary {
  total: number;
  sent: number;
  failed: number;
  successRate: number;
}

export interface StatsDailyPoint {
  date: string;
  sent: number;
  failed: number;
}

export interface StatsResult {
  summary: StatsSummary;
  daily: StatsDailyPoint[];
  rows: any[];
}

export interface StatsListItem {
  id: string;
  name: string;
}

export interface Activity {
  id: string;
  type: 'success' | 'error' | 'pending' | 'message' | 'account' | 'campaign';
  message: string;
  related_id?: string;
  timestamp: string;
}

// License types
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

// IPC Types
// ==================== AI Chatbot (מערך היח״ש) ====================

export interface ChatbotConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  accountIds: string[];
  vehicleEntryStaffPhone: string;
  generalStaffPhone: string;
  openCallStaffPhone: string;
  historyTurns: number;
  greeting: string;
}

export interface ChatbotStatus {
  enabled: boolean;
  hasApiKey: boolean;
  model: string;
  knowledgeCounts: Record<string, number>;
  conversations: number;
  activeConversations: number;
  openEscalations: number;
  requests: number;
}

export interface ChatbotWorkflowInfo {
  id: string;
  intent: string;
  label: string;
  tools: string[];
  requiredFields: Array<{ key: string; label: string }>;
}

export interface ElectronAPI {
  // License operations
  license: {
    check: () => Promise<LicenseInfo>;
    activate: (licenseKey: string) => Promise<{ success: boolean; error?: string; info?: LicenseInfo }>;
    deactivate: () => Promise<{ success: boolean; error?: string }>;
    getUser: () => Promise<{ email?: string; name?: string }>;
  };

  // Account operations
  accounts: {
    getAll: () => Promise<Account[]>;
    getInitStatus: () => Promise<{ total: number; completed: number; failed: number; isComplete: boolean; currentAccount?: string }>;
    getById: (id: string) => Promise<Account | null>;
    create: (data: Partial<Account>) => Promise<Account>;
    update: (id: string, data: Partial<Account>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    connect: (id: string, proxy?: ProxyConfig, pairingMethod?: 'qr' | 'code') => Promise<void>;
    disconnect: (id: string) => Promise<void>;
    getQRCode: (id: string) => Promise<string>;
    updateWhatsAppName: (id: string, name: string) => Promise<void>;
    updateWhatsAppImage: (id: string, imagePath: string) => Promise<void>;
    refreshProfilePicture: (id: string) => Promise<void>;
    setDuoplusDeviceId: (id: string, deviceId: string | null) => Promise<void>;
  };

  // DuoPlus cloud-phone operations
  duoplus: {
    getSettings: () => Promise<DuoPlusSettings>;
    saveSettings: (settings: Partial<DuoPlusSettings>) => Promise<void>;
    testDevice: (deviceId: string) => Promise<DuoPlusStatusItem | null>;
  };

  // Campaign operations
  campaigns: {
    getAll: () => Promise<Campaign[]>;
    getById: (id: string) => Promise<Campaign | null>;
    create: (data: Partial<Campaign>) => Promise<Campaign>;
    update: (id: string, data: Partial<Campaign>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    start: (id: string) => Promise<void>;
    pause: (id: string) => Promise<void>;
    stop: (id: string) => Promise<void>;
    reset: (id: string) => Promise<void>;
    getStats: (id: string) => Promise<CampaignStats>;
    addContacts: (id: string, contacts: { phone_number: string }[]) => Promise<void>;
    setContacts: (id: string, contacts: { phone_number: string }[]) => Promise<void>;
    getContacts: (id: string) => Promise<CampaignContact[]>;
    addAccounts: (campaignId: string, accountIds: string[]) => Promise<void>;
    setAccounts: (campaignId: string, accountIds: string[]) => Promise<void>;
    getAccounts: (campaignId: string) => Promise<string[]>;
    saveMedia: (fileName: string, buffer: Buffer) => Promise<string>;
    exportReport: (id: string) => Promise<string | null>;
  };

  // Contact operations
  contacts: {
    getAll: () => Promise<Contact[]>;
    getPaginated: (options: { 
      page: number; 
      limit: number; 
      searchQuery?: string; 
      tagFilter?: string;
    }) => Promise<{
      contacts: Contact[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>;
    getBlacklistCount: () => Promise<number>;
    isInBlacklist: (phoneNumber: string) => Promise<boolean>;
    findByPhone: (phoneNumber: string) => Promise<Contact | null>;
    getById: (id: string) => Promise<Contact | null>;
    create: (data: Partial<Contact>) => Promise<Contact>;
    update: (id: string, data: Partial<Contact>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    deleteAll: () => Promise<number>;
    selectFile: () => Promise<string | null>;
    checkDuplicates: (filePath: string, country: string) => Promise<{ duplicateCount: number; totalCount: number; duplicates: string[] }>;
    previewFile: (filePath: string, country: string) => Promise<{ preview: any[]; totalCount: number }>;
    importFromFile: (filePath: string, country?: string, duplicateAction?: 'update' | 'skip') => Promise<number>;
    onImportProgress: (callback: (progress: { current: number; total: number; percent: number }) => void) => () => void;
    addTag: (contactId: string, tagId: string) => Promise<void>;
    removeTag: (contactId: string, tagId: string) => Promise<void>;
  };

  // Tag operations
  tags: {
    getAll: () => Promise<Tag[]>;
    create: (data: Partial<Tag>) => Promise<Tag>;
    update: (id: string, data: Partial<Tag>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };

  // Custom Fields operations
  customFields: {
    getAll: () => Promise<CustomField[]>;
    create: (data: Partial<CustomField>) => Promise<CustomField>;
    update: (id: string, data: Partial<CustomField>) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };

  // Group Extractor operations
  extractor: {
    getGroups: (accountId: string) => Promise<WhatsAppGroupSummary[]>;
    getGroupParticipants: (accountId: string, groupId: string) => Promise<WhatsAppGroupParticipant[]>;
  };

  groups: {
    getGroups: (accountId: string) => Promise<WhatsAppGroupSummary[]>;
    getGroupParticipants: (accountId: string, groupId: string) => Promise<WhatsAppGroupParticipant[]>;
    getInviteInfo: (accountId: string, inviteLink: string) => Promise<WhatsAppGroupInviteInfo>;
    joinGroupByInviteLink: (accountId: string, inviteLink: string) => Promise<GroupJoinByInviteResult>;
  };

  // Group campaign operations (recurring scheduled broadcasts to groups)
  groupCampaigns: {
    getAll: () => Promise<GroupCampaign[]>;
    getById: (id: string) => Promise<GroupCampaign | null>;
    getTargets: (id: string) => Promise<GroupCampaignTarget[]>;
    getRuns: (id: string) => Promise<GroupCampaignRun[]>;
    create: (data: Partial<GroupCampaign> & { targets: GroupCampaignTarget[] }) => Promise<GroupCampaign>;
    update: (id: string, data: Partial<GroupCampaign> & { targets?: GroupCampaignTarget[] }) => Promise<GroupCampaign>;
    delete: (id: string) => Promise<void>;
    start: (id: string) => Promise<void>;
    pause: (id: string) => Promise<void>;
    stop: (id: string) => Promise<void>;
  };

  // Message operations
  messages: {
    getByChat: (softwareChatId: string) => Promise<Message[]>;
    getChats: (accountId?: string, searchQuery?: string) => Promise<Chat[]>;
    send: (accountId: string, to: string, message: string) => Promise<void>;
    sendMedia: (accountId: string, to: string, filePath: string, caption?: string) => Promise<void>;
    saveTempFile: (fileName: string, buffer: Buffer) => Promise<string>;
    deleteTempFile: (filePath: string) => Promise<void>;
    markAsRead: (softwareChatId: string) => Promise<void>;
    markAsHandled: (chatId: string, accountId: string) => Promise<void>;
    markChatStatus: (softwareChatId: string, status: string) => Promise<void>;
    markAllChats: (accountId: string | undefined, handled: boolean) => Promise<number>;
    getMediaFile: (messageId: string) => Promise<{ buffer: number[]; fileName: string } | null>;
    getChatPhoto: (photoPath: string) => Promise<{ buffer: number[]; fileName: string } | null>;
  };

  // Warm-up operations
  warmup: {
    start: (accountIds: string[], minDelay: number, maxDelay: number) => Promise<string>;
    stop: (sessionId: string) => Promise<void>;
    getActive: () => Promise<WarmUpSession | null>;
    getStats: () => Promise<any[]>;
    getLogs: (limit?: number) => Promise<any[]>;
    getSessionStats: (sessionId: string) => Promise<any[]>;
    getAllSessions: () => Promise<any[]>;
    getSessionDetails: (sessionId: string) => Promise<any>;
  };

  // Dashboard stats
  stats: {
    getDashboard: () => Promise<DashboardStats>;
    getRecentActivities: (limit?: number) => Promise<Activity[]>;
    getCampaignStats: (startDate: string, endDate: string, accountId?: string, campaignId?: string) => Promise<StatsResult>;
    getGroupAdderStats: (startDate: string, endDate: string, accountId?: string, campaignId?: string) => Promise<StatsResult>;
    getGroupCampaignStats: (startDate: string, endDate: string, accountId?: string, campaignId?: string) => Promise<StatsResult>;
    getWarmupStats: (startDate: string, endDate: string, accountId?: string) => Promise<StatsResult>;
    getCampaignsList: (campaignType: 'message' | 'group_adder') => Promise<StatsListItem[]>;
    getGroupCampaignsList: () => Promise<StatsListItem[]>;
    exportReport: (type: 'campaign' | 'group_campaign' | 'warmup' | 'group_adder', startDate: string, endDate: string, accountId?: string, campaignId?: string) => Promise<string | null>;
  };

  // Auto-updater
  updater: {
    checkForUpdates: () => Promise<any>;
    downloadUpdate: () => Promise<any>;
    installUpdate: () => void;
    getVersion: () => Promise<string>;
  };

  // System Logs
  logs: {
    get: () => Promise<Array<{ timestamp: string; level: 'log' | 'info' | 'warn' | 'error'; message: string }>>;
    clear: () => Promise<void>;
  };

  // Flows
  flows: {
    create: (flowData: Partial<Flow>) => Promise<string>;
    save: (flowId: string, flowData: {
      name: string;
      description?: string;
      account_ids: string[];
      nodes: any[];
      edges: any[];
    }) => Promise<void>;
    getAll: () => Promise<Flow[]>;
    getById: (flowId: string) => Promise<{ flow: Flow; nodes: FlowNode[]; edges: FlowEdge[] }>;
    toggleActive: (flowId: string) => Promise<void>;
    delete: (flowId: string) => Promise<void>;
    selectMedia: () => Promise<string | null>;
  };

  // Message Templates
  templates: {
    create: (data: Partial<MessageTemplate>) => Promise<MessageTemplate>;
    getAll: () => Promise<MessageTemplate[]>;
    getById: (id: string) => Promise<MessageTemplate | null>;
    update: (id: string, data: Partial<MessageTemplate>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    getMediaFile: (mediaPath: string) => Promise<{ buffer: number[]; fileName: string } | null>;
  };

  // AI chatbot (מערך היח״ש) — config, knowledge and conversation inspection.
  // Separate from the campaign surface above; see electron/chatbot/.
  chatbot: {
    getConfig: () => Promise<ChatbotConfig>;
    saveConfig: (patch: Partial<ChatbotConfig>) => Promise<ChatbotConfig>;
    getStatus: () => Promise<ChatbotStatus>;
    getWorkflows: () => Promise<ChatbotWorkflowInfo[]>;
    getConversations: (limit?: number) => Promise<any[]>;
    getMessages: (conversationId: string) => Promise<Array<{ role: string; content: string; createdAt?: string }>>;
    getEscalations: () => Promise<any[]>;
    getRequests: () => Promise<any[]>;
    getErrors: () => Promise<any[]>;
    knowledge: {
      list: (category?: string) => Promise<any[]>;
      create: (entry: { category: string; title: string; content: string; metadata?: Record<string, unknown> }) => Promise<any>;
      update: (id: string, patch: Record<string, unknown>) => Promise<any>;
      delete: (id: string) => Promise<void>;
      bulkImport: (category: string, text: string) => Promise<{ created: number; titles: string[] }>;
      deleteDemo: () => Promise<{ deleted: number }>;
    };
    simulate: (phoneNumber: string, message: string) => Promise<{ handled: boolean; reply?: string; intent?: string; error?: string }>;
    resetConversation: (phoneNumber: string) => Promise<void>;
  };

  // Event listeners
  on: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;
  
  // Shell operations
  shell?: {
    showItemInFolder: (path: string) => void;
    openExternal: (url: string) => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
