import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import logoImage from '@/images/lead-logo.png';

interface InitProgress {
  total: number;
  completed: number;
  failed: number;
  isComplete: boolean;
  currentAccount?: string;
}

interface InitializationLoaderProps {
  onComplete: () => void;
}

export default function InitializationLoader({ onComplete }: InitializationLoaderProps) {
  const { language } = useLanguage();
  const [progress, setProgress] = useState<InitProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    isComplete: false,
  });
  const [fetchedInitial, setFetchedInitial] = useState(false);

  // Translations
  const labels = {
    title: language === 'he' ? 'מתחיל את Yachash' : language === 'ar' ? 'بدء تشغيل Yachash' : 'Starting Yachash',
    subtitle: language === 'he' ? 'מחבר את חשבונות הווטסאפ שלך...' : language === 'ar' ? 'جارٍ توصيل حسابات واتساب...' : 'Connecting your WhatsApp accounts...',
    noAccounts: language === 'he' ? 'טוען את האפליקציה...' : language === 'ar' ? 'جارٍ تحميل التطبيق...' : 'Loading application...',
    accountsProgress: language === 'he' ? 'חשבונות חוברו' : language === 'ar' ? 'الحسابات المتصلة' : 'Accounts connected',
    failed: language === 'he' ? 'נכשלו' : language === 'ar' ? 'فشل' : 'Failed',
    ofTotal: language === 'he' ? 'מתוך' : language === 'ar' ? 'من' : 'of',
    hint: language === 'he'
      ? 'הפעולה עשויה לקחת עד כמה דקות בהתאם למספר החשבונות'
      : language === 'ar'
      ? 'قد تستغرق هذه العملية عدة دقائق حسب عدد الحسابات'
      : 'This may take a few minutes depending on the number of accounts',
  };

  useEffect(() => {
    // Fetch initial status on mount
    const fetchInitial = async () => {
      try {
        if (window.electron?.accounts?.getInitStatus) {
          const status = await window.electron.accounts.getInitStatus();
          setProgress(status);
          if (status.isComplete) {
            // Already done - skip loader
            onComplete();
            return;
          }
        }
      } catch (err) {
        console.error('Failed to get init status:', err);
      }
      setFetchedInitial(true);
    };

    fetchInitial();

    // Listen for progress updates
    const handleProgress = (update: InitProgress) => {
      setProgress(update);
      if (update.isComplete) {
        // Small delay so user sees the 100% completion before navigating
        setTimeout(() => onComplete(), 800);
      }
    };

    if (window.electron?.on) {
      window.electron.on('accounts:initProgress', handleProgress);
    }

    return () => {
      if (window.electron?.removeListener) {
        window.electron.removeListener('accounts:initProgress', handleProgress);
      }
    };
  }, [onComplete]);

  const percent = progress.total > 0
    ? Math.round(((progress.completed + progress.failed) / progress.total) * 100)
    : 0;

  const dir = language === 'he' || language === 'ar' ? 'rtl' : 'ltr';

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-background via-background to-primary/5" dir={dir}>
      <div className="max-w-md w-full px-8 text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="bg-white rounded-2xl p-6 shadow-lg">
            <img src={logoImage} alt="Yachash" className="h-16 w-auto object-contain" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold mb-2">{labels.title}</h1>
        <p className="text-muted-foreground mb-8">
          {progress.total === 0 && fetchedInitial ? labels.noAccounts : labels.subtitle}
        </p>

        {/* Progress Bar */}
        {progress.total > 0 && (
          <>
            <div className="w-full bg-muted rounded-full h-3 overflow-hidden mb-3 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${percent}%` }}
              />
            </div>

            {/* Percentage + Counts */}
            <div className="flex items-center justify-between text-sm mb-4">
              <span className="font-medium text-foreground">{percent}%</span>
              <span className="text-muted-foreground">
                {progress.completed + progress.failed} {labels.ofTotal} {progress.total}
              </span>
            </div>

            {/* Status Badges */}
            <div className="flex items-center justify-center gap-6 mt-6 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-muted-foreground">
                  {labels.accountsProgress}: <span className="font-semibold text-foreground">{progress.completed}</span>
                </span>
              </div>
              {progress.failed > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-muted-foreground">
                    {labels.failed}: <span className="font-semibold text-foreground">{progress.failed}</span>
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Spinner when no accounts or initial fetch */}
        {(progress.total === 0 || !fetchedInitial) && (
          <div className="flex justify-center mb-4">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
          </div>
        )}

        {/* Hint */}
        {progress.total > 3 && !progress.isComplete && (
          <p className="text-xs text-muted-foreground mt-8">{labels.hint}</p>
        )}
      </div>
    </div>
  );
}
