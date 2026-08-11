import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../src/types';

console.log('🚀 Preload script is executing!');
console.log('contextBridge available:', typeof contextBridge);
console.log('ipcRenderer available:', typeof ipcRenderer);

// Increase max listeners to prevent warnings (multiple pages can listen to same events)
ipcRenderer.setMaxListeners(50);

const electronAPI: ElectronAPI = {
  license: {
    check: () => ipcRenderer.invoke('license:check'),
    activate: (licenseKey) => ipcRenderer.invoke('license:activate', licenseKey),
    deactivate: () => ipcRenderer.invoke('license:deactivate'),
    getUser: () => ipcRenderer.invoke('license:getUser'),
  },

  accounts: {
    getAll: () => ipcRenderer.invoke('accounts:getAll'),
    getInitStatus: () => ipcRenderer.invoke('accounts:getInitStatus'),
    getById: (id) => ipcRenderer.invoke('accounts:getById', id),
    create: (data) => ipcRenderer.invoke('accounts:create', data),
    update: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
    delete: (id) => ipcRenderer.invoke('accounts:delete', id),
    connect: (id, proxy, pairingMethod) => ipcRenderer.invoke('accounts:connect', id, proxy, pairingMethod),
    disconnect: (id) => ipcRenderer.invoke('accounts:disconnect', id),
    getQRCode: (id) => ipcRenderer.invoke('accounts:getQRCode', id),
    updateWhatsAppName: (id, name) => ipcRenderer.invoke('accounts:updateWhatsAppName', id, name),
    updateWhatsAppImage: (id, imagePath) => ipcRenderer.invoke('accounts:updateWhatsAppImage', id, imagePath),
    refreshProfilePicture: (id) => ipcRenderer.invoke('accounts:refreshProfilePicture', id),
    setDuoplusDeviceId: (id, deviceId) => ipcRenderer.invoke('accounts:setDuoplusDeviceId', id, deviceId),
  },

  duoplus: {
    getSettings: () => ipcRenderer.invoke('duoplus:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('duoplus:saveSettings', settings),
    testDevice: (deviceId) => ipcRenderer.invoke('duoplus:testDevice', deviceId),
  },

  campaigns: {
    getAll: () => ipcRenderer.invoke('campaigns:getAll'),
    getById: (id) => ipcRenderer.invoke('campaigns:getById', id),
    create: (data) => ipcRenderer.invoke('campaigns:create', data),
    update: (id, data) => ipcRenderer.invoke('campaigns:update', id, data),
    delete: (id) => ipcRenderer.invoke('campaigns:delete', id),
    start: (id) => ipcRenderer.invoke('campaigns:start', id),
    pause: (id) => ipcRenderer.invoke('campaigns:pause', id),
    stop: (id) => ipcRenderer.invoke('campaigns:stop', id),
    reset: (id) => ipcRenderer.invoke('campaigns:reset', id),
    getStats: (id) => ipcRenderer.invoke('campaigns:getStats', id),
    addContacts: (id, contacts) => ipcRenderer.invoke('campaigns:addContacts', id, contacts),
    setContacts: (id, contacts) => ipcRenderer.invoke('campaigns:setContacts', id, contacts),
    getContacts: (id) => ipcRenderer.invoke('campaigns:getContacts', id),
    addAccounts: (campaignId, accountIds) => ipcRenderer.invoke('campaigns:addAccounts', campaignId, accountIds),
    setAccounts: (campaignId, accountIds) => ipcRenderer.invoke('campaigns:setAccounts', campaignId, accountIds),
    getAccounts: (campaignId) => ipcRenderer.invoke('campaigns:getAccounts', campaignId),
    saveMedia: (fileName, buffer) => ipcRenderer.invoke('campaigns:save-media', fileName, buffer),
    exportReport: (id) => ipcRenderer.invoke('campaigns:exportReport', id),
  },

  contacts: {
    getAll: () => ipcRenderer.invoke('contacts:getAll'),
    getPaginated: (options) => ipcRenderer.invoke('contacts:getPaginated', options),
    getBlacklistCount: () => ipcRenderer.invoke('contacts:getBlacklistCount'),
    isInBlacklist: (phoneNumber) => ipcRenderer.invoke('contacts:isInBlacklist', phoneNumber),
    findByPhone: (phoneNumber) => ipcRenderer.invoke('contacts:findByPhone', phoneNumber),
    getById: (id) => ipcRenderer.invoke('contacts:getById', id),
    create: (data) => ipcRenderer.invoke('contacts:create', data),
    update: (id, data) => ipcRenderer.invoke('contacts:update', id, data),
    delete: (id) => ipcRenderer.invoke('contacts:delete', id),
    deleteAll: () => ipcRenderer.invoke('contacts:deleteAll'),
    selectFile: () => ipcRenderer.invoke('contacts:selectFile'),
    checkDuplicates: (filePath, country) => ipcRenderer.invoke('contacts:checkDuplicates', filePath, country),
    previewFile: (filePath, country) => ipcRenderer.invoke('contacts:previewFile', filePath, country),
    importFromFile: (filePath, country?, duplicateAction?) => ipcRenderer.invoke('contacts:importFromFile', filePath, country, duplicateAction),
    onImportProgress: (callback: (progress: { current: number; total: number; percent: number }) => void) => {
      const handler = (_event: any, progress: any) => callback(progress);
      ipcRenderer.on('contacts:importProgress', handler);
      return () => ipcRenderer.removeListener('contacts:importProgress', handler);
    },
    addTag: (contactId, tagId) => ipcRenderer.invoke('contacts:addTag', contactId, tagId),
    removeTag: (contactId, tagId) => ipcRenderer.invoke('contacts:removeTag', contactId, tagId),
  },

  tags: {
    getAll: () => ipcRenderer.invoke('tags:getAll'),
    create: (data) => ipcRenderer.invoke('tags:create', data),
    update: (id, data) => ipcRenderer.invoke('tags:update', id, data),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
  },

  customFields: {
    getAll: () => ipcRenderer.invoke('customFields:getAll'),
    create: (data) => ipcRenderer.invoke('customFields:create', data),
    update: (id, data) => ipcRenderer.invoke('customFields:update', id, data),
    delete: (id) => ipcRenderer.invoke('customFields:delete', id),
  },

  extractor: {
    getGroups: (accountId) => ipcRenderer.invoke('extractor:getGroups', accountId),
    getGroupParticipants: (accountId, groupId) => ipcRenderer.invoke('extractor:getGroupParticipants', accountId, groupId),
  },

  groups: {
    getGroups: (accountId) => ipcRenderer.invoke('groups:getGroups', accountId),
    getGroupParticipants: (accountId, groupId) => ipcRenderer.invoke('groups:getGroupParticipants', accountId, groupId),
    getInviteInfo: (accountId, inviteLink) => ipcRenderer.invoke('groups:getInviteInfo', accountId, inviteLink),
    joinGroupByInviteLink: (accountId, inviteLink) => ipcRenderer.invoke('groups:joinGroupByInviteLink', accountId, inviteLink),
  },

  groupCampaigns: {
    getAll: () => ipcRenderer.invoke('groupCampaigns:getAll'),
    getById: (id) => ipcRenderer.invoke('groupCampaigns:getById', id),
    getTargets: (id) => ipcRenderer.invoke('groupCampaigns:getTargets', id),
    getRuns: (id) => ipcRenderer.invoke('groupCampaigns:getRuns', id),
    create: (data) => ipcRenderer.invoke('groupCampaigns:create', data),
    update: (id, data) => ipcRenderer.invoke('groupCampaigns:update', id, data),
    delete: (id) => ipcRenderer.invoke('groupCampaigns:delete', id),
    start: (id) => ipcRenderer.invoke('groupCampaigns:start', id),
    pause: (id) => ipcRenderer.invoke('groupCampaigns:pause', id),
    stop: (id) => ipcRenderer.invoke('groupCampaigns:stop', id),
  },

  messages: {
    getByChat: (softwareChatId) => ipcRenderer.invoke('messages:getByChat', softwareChatId),
    getChats: (accountId, searchQuery?) => ipcRenderer.invoke('messages:getChats', accountId, searchQuery),
    send: (accountId, to, message) => ipcRenderer.invoke('messages:send', accountId, to, message),
    sendMedia: (accountId, to, filePath, caption) => ipcRenderer.invoke('messages:sendMedia', accountId, to, filePath, caption),
    saveTempFile: (fileName, buffer) => ipcRenderer.invoke('messages:saveTempFile', fileName, buffer),
    deleteTempFile: (filePath) => ipcRenderer.invoke('messages:deleteTempFile', filePath),
    markAsRead: (softwareChatId) => ipcRenderer.invoke('messages:markAsRead', softwareChatId),
    markAsHandled: (chatId, accountId) => ipcRenderer.invoke('messages:markAsHandled', chatId, accountId),
    markChatStatus: (softwareChatId, status) => ipcRenderer.invoke('messages:markChatStatus', softwareChatId, status),
    markAllChats: (accountId, handled) => ipcRenderer.invoke('messages:markAllChats', accountId, handled),
    getMediaFile: (messageId) => ipcRenderer.invoke('messages:getMediaFile', messageId),
    getChatPhoto: (photoPath) => ipcRenderer.invoke('messages:getChatPhoto', photoPath),
  },

  warmup: {
    start: (accountIds, minDelay, maxDelay) => ipcRenderer.invoke('warmup:start', accountIds, minDelay, maxDelay),
    stop: (sessionId) => ipcRenderer.invoke('warmup:stop', sessionId),
    getActive: () => ipcRenderer.invoke('warmup:getActive'),
    getStats: () => ipcRenderer.invoke('warmup:getStats'),
    getLogs: (limit) => ipcRenderer.invoke('warmup:getLogs', limit),
    getSessionStats: (sessionId) => ipcRenderer.invoke('warmup:getSessionStats', sessionId),
    getAllSessions: () => ipcRenderer.invoke('warmup:getAllSessions'),
    getSessionDetails: (sessionId) => ipcRenderer.invoke('warmup:getSessionDetails', sessionId),
  },

  flows: {
    create: (flowData) => ipcRenderer.invoke('flows:create', flowData),
    save: (flowId, flowData) => ipcRenderer.invoke('flows:save', flowId, flowData),
    getAll: () => ipcRenderer.invoke('flows:getAll'),
    getById: (flowId) => ipcRenderer.invoke('flows:getById', flowId),
    toggleActive: (flowId) => ipcRenderer.invoke('flows:toggleActive', flowId),
    delete: (flowId) => ipcRenderer.invoke('flows:delete', flowId),
    selectMedia: () => ipcRenderer.invoke('flows:selectMedia'),
  },

  templates: {
    create: (data) => ipcRenderer.invoke('templates:create', data),
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    getById: (id) => ipcRenderer.invoke('templates:getById', id),
    update: (id, data) => ipcRenderer.invoke('templates:update', id, data),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    getMediaFile: (mediaPath) => ipcRenderer.invoke('templates:getMediaFile', mediaPath),
  },

  stats: {
    getDashboard: () => ipcRenderer.invoke('stats:getDashboard'),
    getRecentActivities: (limit) => ipcRenderer.invoke('stats:getRecentActivities', limit),
    getCampaignStats: (startDate, endDate, accountId, campaignId) => ipcRenderer.invoke('stats:getCampaignStats', startDate, endDate, accountId, campaignId),
    getGroupAdderStats: (startDate, endDate, accountId, campaignId) => ipcRenderer.invoke('stats:getGroupAdderStats', startDate, endDate, accountId, campaignId),
    getGroupCampaignStats: (startDate, endDate, accountId, campaignId) => ipcRenderer.invoke('stats:getGroupCampaignStats', startDate, endDate, accountId, campaignId),
    getWarmupStats: (startDate, endDate, accountId) => ipcRenderer.invoke('stats:getWarmupStats', startDate, endDate, accountId),
    getCampaignsList: (campaignType) => ipcRenderer.invoke('stats:getCampaignsList', campaignType),
    getGroupCampaignsList: () => ipcRenderer.invoke('stats:getGroupCampaignsList'),
    exportReport: (type, startDate, endDate, accountId, campaignId) => ipcRenderer.invoke('stats:exportReport', type, startDate, endDate, accountId, campaignId),
  },

  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download-update'),
    installUpdate: () => ipcRenderer.invoke('updater:install-update'),
    getVersion: () => ipcRenderer.invoke('updater:get-version'),
  },

  chatbot: {
    getConfig: () => ipcRenderer.invoke('chatbot:getConfig'),
    saveConfig: (patch) => ipcRenderer.invoke('chatbot:saveConfig', patch),
    getStatus: () => ipcRenderer.invoke('chatbot:getStatus'),
    getWorkflows: () => ipcRenderer.invoke('chatbot:getWorkflows'),
    getConversations: (limit) => ipcRenderer.invoke('chatbot:getConversations', limit),
    getMessages: (conversationId) => ipcRenderer.invoke('chatbot:getMessages', conversationId),
    getEscalations: () => ipcRenderer.invoke('chatbot:getEscalations'),
    getRequests: () => ipcRenderer.invoke('chatbot:getRequests'),
    getErrors: () => ipcRenderer.invoke('chatbot:getErrors'),
    knowledge: {
      list: (category) => ipcRenderer.invoke('chatbot:knowledge:list', category),
      create: (entry) => ipcRenderer.invoke('chatbot:knowledge:create', entry),
      update: (id, patch) => ipcRenderer.invoke('chatbot:knowledge:update', id, patch),
      delete: (id) => ipcRenderer.invoke('chatbot:knowledge:delete', id),
    },
    simulate: (phoneNumber, message) => ipcRenderer.invoke('chatbot:simulate', phoneNumber, message),
    resetConversation: (phoneNumber) => ipcRenderer.invoke('chatbot:resetConversation', phoneNumber),
  },

  logs: {
    get: () => ipcRenderer.invoke('logs:get'),
    clear: () => ipcRenderer.invoke('logs:clear'),
  },

  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
  
  shell: {
    showItemInFolder: (path: string) => {
      const { shell } = require('electron');
      shell.showItemInFolder(path);
    },
    openExternal: (url: string) => {
      const { shell } = require('electron');
      shell.openExternal(url);
    }
  }
};

console.log('About to expose API to main world...');

try {
  contextBridge.exposeInMainWorld('electron', electronAPI);
  console.log('✅ Electron API exposed successfully via contextBridge');
} catch (error) {
  console.error('❌ Failed to expose Electron API:', error);
  // Fallback: expose directly (less secure but works)
  (window as any).electron = electronAPI;
  console.log('⚠️ Exposed via window as fallback');
}
