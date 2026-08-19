import { useEffect, useState } from 'react';
import { Plus, Users, ShieldCheck, Edit, Image, CheckSquare, Square, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import AccountCard from '@/components/accounts/AccountCard';
import AddAccountDialog from '@/components/accounts/AddAccountDialog';
import QRCodeDisplay from '@/components/accounts/QRCodeDisplay';
import { api, onAccountStatusChange, onQRCode, onPairingCode } from '@/lib/api';
import type { Account } from '@/types';

export default function Accounts() {
  const { t, language } = useLanguage();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);
  const [bulkUpdateName, setBulkUpdateName] = useState('');
  const [bulkUpdateImages, setBulkUpdateImages] = useState<File[]>([]);
  const [refreshingPictures, setRefreshingPictures] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    accountId: string | null;
  }>({ open: false, accountId: null });
  const [refreshDialog, setRefreshDialog] = useState(false);
  
  // Reconnection state
  const [showReconnectDialog, setShowReconnectDialog] = useState(false);
  const [reconnectAccountId, setReconnectAccountId] = useState('');
  const [reconnectQrCode, setReconnectQrCode] = useState('');
  const [reconnectPairingCode, setReconnectPairingCode] = useState('');
  const [reconnectMethod, setReconnectMethod] = useState<'qr' | 'code'>('qr');

  useEffect(() => {
    loadAccounts();

    // Listen for account status changes
    const cleanupStatus = onAccountStatusChange((accountId, status) => {
      setAccounts(prev => prev.map(acc => 
        acc.id === accountId ? { ...acc, status: status as any } : acc
      ));
      
      // Auto-close reconnect dialog when connected
      if (accountId === reconnectAccountId && status === 'connected') {
        setShowReconnectDialog(false);
        setReconnectAccountId('');
        setReconnectQrCode('');
        setReconnectPairingCode('');
        toast.success(language === 'he' ? 'החשבון חובר בהצלחה!' : 'Account connected successfully!');
      }
    });

    // Listen for QR codes
    const cleanupQR = onQRCode((accountId, qr) => {
      if (accountId === reconnectAccountId) {
        setReconnectQrCode(qr);
      }
    });

    // Listen for pairing codes
    const cleanupPairing = onPairingCode((accountId, code) => {
      if (accountId === reconnectAccountId) {
        setReconnectPairingCode(code);
      }
    });

    return () => {
      cleanupStatus();
      cleanupQR();
      cleanupPairing();
    };
  }, [reconnectAccountId, language]);

  const loadAccounts = async () => {
    try {
      const data = await api.accounts.getAll();
      setAccounts(data);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (accountId: string) => {
    setDeleteDialog({ open: true, accountId });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.accountId) return;

    const accountIdToDelete = deleteDialog.accountId;

    try {
      await api.accounts.delete(accountIdToDelete);
      setAccounts(prev => prev.filter(acc => acc.id !== accountIdToDelete));
      toast.success(t('toast.accountDeleted'));
    } catch (error) {
      console.error('Failed to delete account:', error);
      toast.error(t('accounts.failedToDelete'));
    } finally {
      // Ensure dialog state is cleared
      setDeleteDialog({ open: false, accountId: null });
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      await api.accounts.disconnect(accountId);
      toast.success('Account disconnected');
    } catch (error) {
      console.error('Failed to disconnect account:', error);
      toast.error('Failed to disconnect account');
    }
  };

  /**
   * Rebuilds the connection without touching the saved login.
   *
   * Unlike handleReconnect this does NOT refuse to run while the account reads
   * as 'connecting' — a wedged attempt is stuck in exactly that state, and
   * refusing there is what left it unrecoverable from the UI.
   */
  const handleRefreshConnection = async (accountId: string) => {
    try {
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, status: 'connecting' } : a));
      toast.success(language === 'he' ? 'מרענן את החיבור...' : 'Refreshing connection...');
      await api.accounts.reconnect(accountId);
      await loadAccounts();
    } catch (error) {
      console.error('Failed to refresh connection:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to refresh connection');
      await loadAccounts();
    }
  };

  /** Forgets the saved login; the account must be paired again by scanning. */
  const handleResetSession = async (accountId: string) => {
    const confirmed = window.confirm(
      language === 'he'
        ? 'פעולה זו תמחק את החיבור השמור ותדרוש סריקת QR מחדש מהטלפון. להמשיך?'
        : 'This deletes the saved login and requires scanning a new QR from the phone. Continue?'
    );
    if (!confirmed) return;

    try {
      setReconnectAccountId(accountId);
      setReconnectMethod('qr');
      setReconnectQrCode('');
      setReconnectPairingCode('');
      setShowReconnectDialog(true);
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, status: 'connecting' } : a));

      await api.accounts.resetSession(accountId);
      toast.success(language === 'he' ? 'הסשן אופס - סרוק את ה-QR' : 'Session reset - scan the QR');
    } catch (error) {
      console.error('Failed to reset session:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to reset session');
      setShowReconnectDialog(false);
      await loadAccounts();
    }
  };

  const handleReconnect = async (accountId: string, method: 'qr' | 'code') => {
    const targetAccount = accounts.find(account => account.id === accountId);

    if (targetAccount?.status === 'connecting') {
      toast.error(language === 'he' ? 'החשבון כבר בתהליך חיבור' : 'Account connection is already in progress');
      return;
    }

    try {
      setReconnectAccountId(accountId);
      setReconnectMethod(method);
      setReconnectQrCode('');
      setReconnectPairingCode('');
      setShowReconnectDialog(true);
      setAccounts(prev => prev.map(account =>
        account.id === accountId ? { ...account, status: 'connecting' } : account
      ));
      
      await api.accounts.connect(accountId, undefined, method);
      toast.success(
        language === 'he' 
          ? `מתחבר מחדש עם ${method === 'qr' ? 'QR Code' : 'Pairing Code'}...`
          : `Reconnecting with ${method === 'qr' ? 'QR Code' : 'Pairing Code'}...`
      );
    } catch (error) {
      console.error('Failed to reconnect account:', error);
      setAccounts(prev => prev.map(account =>
        account.id === accountId && targetAccount ? { ...account, status: targetAccount.status } : account
      ));
      toast.error(error instanceof Error ? error.message : 'Failed to reconnect account');
      setShowReconnectDialog(false);
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedAccountIds(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedAccountIds.size === accounts.length) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(new Set(accounts.map(a => a.id)));
    }
  };

  const toggleAccountSelection = (accountId: string, selected: boolean) => {
    const newSet = new Set(selectedAccountIds);
    if (selected) {
      newSet.add(accountId);
    } else {
      newSet.delete(accountId);
    }
    setSelectedAccountIds(newSet);
  };

  const handleBulkUpdate = async () => {
    if (selectedAccountIds.size === 0) {
      toast.warning(t('accounts.selectAtLeastOne'));
      return;
    }

    setShowBulkUpdateDialog(true);
  };

  const executeBulkUpdate = async () => {
    if (!bulkUpdateName && bulkUpdateImages.length === 0) {
      toast.warning(t('accounts.enterNameOrImage'));
      return;
    }

    const selectedIds = Array.from(selectedAccountIds);
    let succeeded = 0;
    const failedAccounts: { id: string; error: string }[] = [];

    // Pre-save all image temp files once (reused/randomly picked for all accounts)
    const tempFilePaths: string[] = [];
    if (bulkUpdateImages.length > 0) {
      try {
        for (const image of bulkUpdateImages) {
          const arrayBuffer = await image.arrayBuffer();
          const buffer = new Uint8Array(arrayBuffer);
          const tempFilePath = await api.messages.saveTempFile(image.name, buffer as any);
          tempFilePaths.push(tempFilePath);
        }
      } catch (error: any) {
        console.error('Failed to save temp image(s):', error);
        toast.error('Failed to prepare image(s)');
        // Clean up any temp files that were already saved before the failure
        await Promise.all(tempFilePaths.map(p => api.messages.deleteTempFile(p).catch(() => {})));
        return;
      }
    }

    // Update accounts in parallel batches - failures on one don't stop others
    // Concurrency of 5 to balance speed vs not overloading WhatsApp Web instances
    const CONCURRENCY = 5;
    for (let i = 0; i < selectedIds.length; i += CONCURRENCY) {
      const batch = selectedIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (accountId) => {
        try {
          if (bulkUpdateName.trim()) {
            await api.accounts.updateWhatsAppName(accountId, bulkUpdateName.trim());
          }

          if (tempFilePaths.length > 0) {
            // Pick a random image from the uploaded set for this account
            const randomPath = tempFilePaths[Math.floor(Math.random() * tempFilePaths.length)];
            await api.accounts.updateWhatsAppImage(accountId, randomPath);
          }

          succeeded++;
        } catch (error: any) {
          console.error(`Failed to update account ${accountId}:`, error);
          const account = accounts.find(a => a.id === accountId);
          const label = account?.name || account?.phone_number || accountId.substring(0, 8);
          failedAccounts.push({ id: accountId, error: error?.message || String(error) });
          // Log account label alongside the failure for easier debugging
          console.warn(`⚠️ Skipped "${label}" - continuing with remaining accounts`);
        }
      }));
    }

    // Clean up temp image files once after all updates complete
    if (tempFilePaths.length > 0) {
      await Promise.all(tempFilePaths.map(async (p) => {
        try {
          await api.messages.deleteTempFile(p);
        } catch (e) {
          console.warn('Failed to delete temp file:', e);
        }
      }));
    }

    // Show summary toast
    if (failedAccounts.length === 0) {
      toast.success(`Successfully updated ${succeeded} account(s)`);
    } else if (succeeded === 0) {
      toast.error(`Failed to update all ${failedAccounts.length} account(s)`);
    } else {
      toast.warning(
        `Updated ${succeeded} account(s), ${failedAccounts.length} failed - check console for details`
      );
    }

    setShowBulkUpdateDialog(false);
    setBulkUpdateName('');
    setBulkUpdateImages([]);
    setSelectionMode(false);
    setSelectedAccountIds(new Set());
  };

  const handleRefreshAllProfilePicturesClick = () => {
    const connectedAccounts = accounts.filter(acc => acc.status === 'connected');
    
    if (connectedAccounts.length === 0) {
      toast.warning(t('accounts.noConnectedToRefresh'));
      return;
    }

    setRefreshDialog(true);
  };

  const handleRefreshAllProfilePicturesConfirm = async () => {
    const connectedAccounts = accounts.filter(acc => acc.status === 'connected');
    setRefreshingPictures(true);

    try {
      for (const account of connectedAccounts) {
        await api.accounts.refreshProfilePicture(account.id);
      }

      // Reload accounts to show updated pictures
      await loadAccounts();
      
      toast.success(t('accounts.successfullyRefreshed').replace('{count}', connectedAccounts.length.toString()));
    } catch (error) {
      console.error('Failed to refresh profile pictures:', error);
      toast.error(t('accounts.failedToRefreshPictures'));
    } finally {
      setRefreshingPictures(false);
      // Ensure dialog state is cleared
      setRefreshDialog(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-2">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            {t('accounts.title')}
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            {t('accounts.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          {accounts.length > 0 && (
            <>
              <Button 
                onClick={handleRefreshAllProfilePicturesClick}
                size="lg" 
                variant="outline"
                disabled={refreshingPictures || accounts.filter(a => a.status === 'connected').length === 0}
                className="shadow-lg hover:shadow-xl transition-all"
              >
                {refreshingPictures ? (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                    {t('accounts.refreshing')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-5 w-5 mr-2" />
                    {t('accounts.refreshPictures')}
                  </>
                )}
              </Button>
              <Button 
                onClick={toggleSelectionMode} 
                size="lg" 
                variant={selectionMode ? "default" : "outline"}
                className="shadow-lg hover:shadow-xl transition-all"
              >
                <CheckSquare className="h-5 w-5 mr-2" />
                {selectionMode ? t('accounts.cancelSelection') : t('accounts.bulkUpdate')}
              </Button>
            </>
          )}
          <Button onClick={() => setShowAddDialog(true)} size="lg" className="shadow-lg hover:shadow-xl transition-all">
            <Plus className="h-5 w-5 mr-2" />
            {t('accounts.connectNewAccount')}
          </Button>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectionMode && (
        <div className="bg-primary/10 dark:bg-primary/20 border border-primary/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSelectAll}
              className="gap-2"
            >
              {selectedAccountIds.size === accounts.length ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {selectedAccountIds.size === accounts.length ? t('common.deselectAll') : t('common.selectAll')}
            </Button>
            <span className="text-sm font-medium text-primary">
              {t('accounts.selectedCount').replace('{selected}', selectedAccountIds.size.toString()).replace('{total}', accounts.length.toString())}
            </span>
          </div>
          <Button
            onClick={handleBulkUpdate}
            disabled={selectedAccountIds.size === 0}
            className="gap-2"
          >
            <Edit className="h-4 w-4" />
            {t('accounts.updateSelected')}
          </Button>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-primary/10 dark:bg-primary/20 p-4 rounded-xl border border-primary/20 dark:border-primary/30 flex items-center gap-3">
          <div className="p-2 bg-primary/20 dark:bg-primary/30 rounded-lg">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-primary dark:text-primary">{t('accounts.totalAccounts')}</p>
            <p className="text-2xl font-bold text-primary dark:text-primary">{accounts.length}</p>
          </div>
        </div>
        
        <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-xl border border-green-100 dark:border-green-900/50 flex items-center gap-3">
          <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
            <ShieldCheck className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-900 dark:text-green-100">{t('accounts.activeSessions')}</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">
              {accounts.filter(a => a.status === 'connected').length}
            </p>
          </div>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-muted-foreground/20 rounded-2xl bg-muted/5 mt-8">
          <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-6">
            <Users className="h-10 w-10 text-muted-foreground/50" />
          </div>
          <h3 className="text-xl font-semibold mb-2">{t('accounts.noAccounts')}</h3>
          <p className="text-muted-foreground mb-8 text-center max-w-sm">
            {t('accounts.noAccountsDescription')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} size="lg">
            <Plus className="h-5 w-5 mr-2" />
            {t('accounts.addFirstAccount')}
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-6">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onDelete={() => handleDeleteClick(account.id)}
              onDisconnect={() => handleDisconnect(account.id)}
              onReconnect={(method) => handleReconnect(account.id, method)}
              onRefreshConnection={() => handleRefreshConnection(account.id)}
              onResetSession={() => handleResetSession(account.id)}
              selectionMode={selectionMode}
              isSelected={selectedAccountIds.has(account.id)}
              onSelect={(selected) => toggleAccountSelection(account.id, selected)}
              onUpdated={loadAccounts}
            />
          ))}
        </div>
      )}

      {/* Bulk Update Dialog */}
      <Dialog open={showBulkUpdateDialog} onOpenChange={setShowBulkUpdateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('accounts.bulkUpdateTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('accounts.bulkUpdateDescription').replace('{count}', selectedAccountIds.size.toString())}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('accounts.whatsappDisplayName')}</label>
              <Input
                placeholder={t('accounts.enterNewDisplayName')}
                value={bulkUpdateName}
                onChange={(e) => setBulkUpdateName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('accounts.leaveEmptyNames')}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('accounts.profilePicture')}</label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const newFiles = Array.from(e.target.files || []);
                    if (newFiles.length > 0) {
                      setBulkUpdateImages(prev => [...prev, ...newFiles]);
                    }
                    e.target.value = '';
                  }}
                  className="cursor-pointer"
                />
              </div>
              {bulkUpdateImages.length > 0 && (
                <div className="space-y-1">
                  {bulkUpdateImages.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between text-xs bg-muted/50 rounded-md px-2 py-1">
                      <span className="flex items-center gap-1 text-green-600 truncate">
                        <Image className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setBulkUpdateImages(prev => prev.filter((_, i) => i !== index))}
                        className="text-muted-foreground hover:text-destructive ml-2 flex-shrink-0"
                      >
                        {language === 'he' ? 'הסר' : 'Remove'}
                      </button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    {language === 'he'
                      ? `לכל חשבון תיבחר תמונה אקראית מתוך ${bulkUpdateImages.length} התמונות שהועלו`
                      : `A random image out of the ${bulkUpdateImages.length} uploaded will be picked for each account`}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('accounts.leaveEmptyPictures')}
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowBulkUpdateDialog(false);
                  setBulkUpdateName('');
                  setBulkUpdateImages([]);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={executeBulkUpdate}
                disabled={!bulkUpdateName.trim() && bulkUpdateImages.length === 0}
              >
                {t('accounts.updateAccountsButton').replace('{count}', selectedAccountIds.size.toString())}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AddAccountDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onAccountAdded={loadAccounts}
      />

      {deleteDialog.open && (
        <ConfirmDialog
          key={`delete-${deleteDialog.accountId}`}
          open={deleteDialog.open}
          onOpenChange={(open) => setDeleteDialog({ open, accountId: null })}
          onConfirm={handleDeleteConfirm}
          title={t('accounts.deleteAccount')}
          description={t('accounts.deleteConfirm')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          variant="destructive"
        />
      )}

      {refreshDialog && (
        <ConfirmDialog
          key="refresh-pictures"
          open={refreshDialog}
          onOpenChange={setRefreshDialog}
          onConfirm={handleRefreshAllProfilePicturesConfirm}
          title={t('accounts.refreshPicturesTitle')}
          description={t('accounts.refreshConfirm').replace('{count}', accounts.filter(acc => acc.status === 'connected').length.toString())}
          confirmText={t('common.refresh')}
          cancelText={t('common.cancel')}
          variant="default"
        />
      )}

      {/* Reconnect Dialog */}
      <Dialog open={showReconnectDialog} onOpenChange={(open) => {
        setShowReconnectDialog(open);
        if (!open) {
          setReconnectAccountId('');
          setReconnectQrCode('');
          setReconnectPairingCode('');
        }
      }}>
        <DialogContent>
          <QRCodeDisplay
            qrCode={reconnectQrCode}
            pairingCode={reconnectPairingCode}
            connectionMethod={reconnectMethod}
            isConnecting={!reconnectQrCode && !reconnectPairingCode}
            onClose={() => setShowReconnectDialog(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
