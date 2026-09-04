import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Key, Mail, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface LicenseDialogProps {
  open: boolean;
  onLicenseActivated: () => void;
}

export default function LicenseDialog({ open, onLicenseActivated }: LicenseDialogProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setError('Please enter a license key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // בדוק שה-API זמין
      if (!window.electron) {
        setError('Electron API not available. Please restart the application.');
        setLoading(false);
        return;
      }

      if (!window.electron.license) {
        setError('License API not available. Please restart the application.');
        console.error('window.electron:', window.electron);
        console.error('Available APIs:', Object.keys(window.electron));
        setLoading(false);
        return;
      }

      const result = await window.electron.license.activate(licenseKey.trim());

      if (result.success) {
        onLicenseActivated();
      } else {
        setError(result.error || 'Activation failed');
      }
    } catch (err: any) {
      console.error('Activation error:', err);
      setError(err.message || 'Activation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleActivate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Key className="h-8 w-8 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-2xl">Activate Yachash</DialogTitle>
          <DialogDescription className="text-center">
            Enter your license key to start using Yachash
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="license-key">License Key</Label>
            <Input
              id="license-key"
              placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="font-mono text-sm"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Enter your license key to activate Yachash
            </p>
          </div>

          <Button
            onClick={handleActivate}
            disabled={loading || !licenseKey.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Activating...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Activate License
              </>
            )}
          </Button>

          <div className="text-center pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-2">
              Don't have a license?
            </p>
            <Button
              variant="link"
              onClick={() => {
                // פתח אתר רכישה
                window.open('https://your-website.com/purchase', '_blank');
              }}
            >
              Purchase Yachash
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
