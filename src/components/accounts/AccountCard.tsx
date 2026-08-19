import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Wifi, WifiOff, Trash2, Globe, Smartphone, MoreVertical, QrCode, Hash, Cloud, RefreshCw, RotateCcw } from 'lucide-react';
import { formatDistance } from 'date-fns';
import { he, ar } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import type { Account } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AccountCardProps {
  account: Account;
  onDelete: () => void;
  onDisconnect: () => void;
  onReconnect?: (method: 'qr' | 'code') => void;
  /** Rebuild the connection, keeping the saved login. Available in any state. */
  onRefreshConnection?: () => void;
  /** Forget the saved login and pair again from a new QR. Destructive. */
  onResetSession?: () => void;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  selectionMode?: boolean;
  onUpdated?: () => void;
}

export default function AccountCard({ account, onDelete, onDisconnect, onReconnect, onRefreshConnection, onResetSession, isSelected, onSelect, selectionMode, onUpdated }: AccountCardProps) {
  const { t, language } = useLanguage();
  const isConnected = account.status === 'connected';
  const canReconnect = account.status === 'disconnected' || account.status === 'qr';
  const [showDeviceIdDialog, setShowDeviceIdDialog] = useState(false);
  const [deviceIdInput, setDeviceIdInput] = useState(account.duoplus_device_id || '');
  const [savingDeviceId, setSavingDeviceId] = useState(false);

  const saveDeviceId = async () => {
    setSavingDeviceId(true);
    try {
      await api.accounts.setDuoplusDeviceId(account.id, deviceIdInput.trim() || null);
      toast.success(language === 'he' ? 'מזהה מכשיר DuoPlus נשמר' : language === 'ar' ? 'تم حفظ معرف جهاز DuoPlus' : 'DuoPlus device ID saved');
      setShowDeviceIdDialog(false);
      onUpdated?.();
    } catch (error) {
      console.error('Failed to save DuoPlus device ID:', error);
      toast.error(language === 'he' ? 'שגיאה בשמירת מזהה המכשיר' : language === 'ar' ? 'خطأ في حفظ معرف الجهاز' : 'Failed to save device ID');
    } finally {
      setSavingDeviceId(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'bg-green-500/10 text-green-600 border-green-200';
      case 'connecting':
        return 'bg-yellow-500/10 text-yellow-600 border-yellow-200';
      case 'qr':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'disconnected':
      default:
        return 'bg-gray-500/10 text-gray-600 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'connected': return t('accounts.connected');
      case 'connecting': return t('accounts.connecting');
      case 'qr': return language === 'he' ? 'סרוק QR' : 'Scan QR';
      default: return t('accounts.disconnected');
    }
  };

  return (
    <Card className={`group hover:shadow-md transition-all duration-300 border-muted/60 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
      <CardContent className="p-0">
        {/* Header Background */}
        <div className={`h-24 w-full bg-gradient-to-r ${isConnected ? 'from-green-500/10 to-emerald-500/10' : 'from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900'} relative`}>
          {selectionMode && (
            <div className="absolute top-4 left-4">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => onSelect?.(e.target.checked)}
                className="h-5 w-5 rounded border-2 border-white shadow-sm cursor-pointer accent-primary"
              />
            </div>
          )}
          <div className="absolute top-4 right-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-white/50 backdrop-blur-sm hover:bg-white/80 rounded-full">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isConnected && (
                  <>
                    <DropdownMenuItem onClick={onDisconnect} className="text-orange-600">
                      <WifiOff className="mr-2 h-4 w-4" />
                      {language === 'he' ? 'התנתק' : 'Disconnect'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                
                {canReconnect && onReconnect && (
                  <>
                    <DropdownMenuItem onClick={() => onReconnect('qr')} className="text-green-600">
                      <QrCode className="mr-2 h-4 w-4" />
                      {language === 'he' ? 'חבר מחדש - QR Code' : 'Reconnect - QR Code'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onReconnect('code')} className="text-blue-600">
                      <Hash className="mr-2 h-4 w-4" />
                      {language === 'he' ? 'חבר מחדש - Pairing Code' : 'Reconnect - Pairing Code'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                
                {/* Recovery actions, deliberately shown in EVERY state.
                    A connection that wedges leaves the account on 'connecting',
                    which is exactly when the options above are hidden — so the
                    one state that needs recovery had none available. */}
                {onRefreshConnection && (
                  <DropdownMenuItem onClick={onRefreshConnection} className="text-blue-600">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {language === 'he' ? 'רענון חיבור' : 'Refresh connection'}
                  </DropdownMenuItem>
                )}
                {onResetSession && (
                  <DropdownMenuItem onClick={onResetSession} className="text-amber-600">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    {language === 'he' ? 'איפוס סשן וסריקת QR מחדש' : 'Reset session & rescan QR'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => setShowDeviceIdDialog(true)} className="text-indigo-600">
                  <Cloud className="mr-2 h-4 w-4" />
                  {account.duoplus_device_id
                    ? (language === 'he' ? 'ערוך מזהה מכשיר DuoPlus' : language === 'ar' ? 'تحرير معرف جهاز DuoPlus' : 'Edit DuoPlus Device ID')
                    : (language === 'he' ? 'הגדר מזהה מכשיר DuoPlus' : language === 'ar' ? 'تعيين معرف جهاز DuoPlus' : 'Set DuoPlus Device ID')
                  }
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={onDelete} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {language === 'he' ? 'מחק' : 'Delete'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="px-6 pb-6 -mt-10">
          {/* Avatar / Icon */}
          <div className="flex justify-between items-end mb-4">
            {account.profile_picture_url ? (
              <img
                src={account.profile_picture_url}
                alt={account.name || 'WhatsApp Account'}
                className="h-20 w-20 rounded-full border-4 border-background shadow-lg object-cover bg-white"
                onError={(e) => {
                  // אם התמונה לא נטענת, הסתר אותה והצג את האייקון
                  e.currentTarget.style.display = 'none';
                  const iconDiv = e.currentTarget.nextElementSibling as HTMLElement;
                  if (iconDiv) iconDiv.style.display = 'flex';
                }}
              />
            ) : null}
            <div 
              className={`h-20 w-20 rounded-full flex items-center justify-center border-4 border-background shadow-sm ${isConnected ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'} ${account.profile_picture_url ? 'hidden' : ''}`}
            >
              <Smartphone className="h-10 w-10" />
            </div>
            
            <Badge variant="outline" className={`px-3 py-1 ${getStatusColor(account.status)}`}>
              {isConnected && <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse" />}
              {getStatusText(account.status)}
            </Badge>
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold truncate">{account.name || (language === 'he' ? 'חשבון ווטסאפ' : 'WhatsApp Account')}</h3>
              <p className="text-sm text-muted-foreground truncate">{account.phone_number}</p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t">
              {account.proxy_host && (
                <div className="flex items-center text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                  <Globe className="h-3 w-3 mr-2 text-primary" />
                  <span className="truncate">{account.proxy_host}:{account.proxy_port}</span>
                </div>
              )}

              {account.duoplus_device_id && (
                <div className="flex items-center text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 p-2 rounded-md">
                  <Cloud className="h-3 w-3 mr-2" />
                  <span className="truncate font-mono">{account.duoplus_device_id}</span>
                </div>
              )}
              
              {account.last_seen && (
                <p className="text-xs text-muted-foreground flex items-center justify-end mt-1">
                  {language === 'he' ? 'נראה לאחרונה ' : language === 'ar' ? 'آخر ظهور ' : 'Last seen '}
                  {formatDistance(new Date(account.last_seen), new Date(), { 
                    addSuffix: true,
                    locale: language === 'he' ? he : language === 'ar' ? ar : undefined
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      <Dialog open={showDeviceIdDialog} onOpenChange={setShowDeviceIdDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {language === 'he' ? 'מזהה מכשיר DuoPlus' : language === 'ar' ? 'معرف جهاز DuoPlus' : 'DuoPlus Device ID'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="duoplus_device_id">
              {language === 'he' ? 'מזהה תמונת המכשיר (image_id)' : language === 'ar' ? 'معرف صورة الجهاز (image_id)' : 'Device image ID (image_id)'}
            </Label>
            <Input
              id="duoplus_device_id"
              value={deviceIdInput}
              onChange={(e) => setDeviceIdInput(e.target.value)}
              placeholder="e.g. 7Uw0M"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {language === 'he'
                ? 'ניתן למצוא מזהה זה ברשימת הענן שלך בקונסולת DuoPlus'
                : language === 'ar'
                ? 'يمكنك العثور على هذا المعرف في قائمة أجهزتك السحابية في لوحة تحكم DuoPlus'
                : 'You can find this ID in your cloud phone list in the DuoPlus console'
              }
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeviceIdDialog(false)}>
              {language === 'he' ? 'ביטול' : language === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={saveDeviceId} disabled={savingDeviceId}>
              {savingDeviceId
                ? (language === 'he' ? 'שומר...' : language === 'ar' ? 'جاري الحفظ...' : 'Saving...')
                : (language === 'he' ? 'שמור' : language === 'ar' ? 'حفظ' : 'Save')
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
