import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  Send, 
  MessageSquare, 
  BookUser,
  Download,
  Flame,
  Workflow,
  Bot,
  FileText,
  Terminal,
  UserPlus,
  Settings,
  LogOut,
  HeadphonesIcon,
  Megaphone,
  BarChart3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import logoImage from '@/images/lead-logo.png';
import { api } from '@/lib/api';

export default function Sidebar() {
  const { t, language } = useLanguage();
  const [userName, setUserName] = useState('User');
  const [userEmail, setUserEmail] = useState('');
  const [hasLogAccess, setHasLogAccess] = useState(false);

  // Build navigation array dynamically based on permissions
  const navigation = [
    { name: t('dashboard'), href: '/dashboard', icon: LayoutDashboard },
    { name: t('accounts'), href: '/accounts', icon: Users },
    { name: t('campaigns'), href: '/campaigns', icon: Send },
    { name: language === 'he' ? 'קמפייני קבוצות' : language === 'ar' ? 'حملات المجموعات' : 'Groups Campaigns', href: '/groups-campaigns', icon: Megaphone },
    { name: t('inbox'), href: '/inbox', icon: MessageSquare },
    { name: t('contacts'), href: '/contacts', icon: BookUser },
    { name: language === 'he' ? 'חילוץ מקבוצות' : language === 'ar' ? 'استخراج من المجموعات' : 'Group Extractor', href: '/extractor', icon: Download },
    { name: language === 'he' ? 'Auto Group Join' : language === 'ar' ? 'الانضمام التلقائي للمجموعة' : 'Auto Group Join', href: '/auto-group-join', icon: UserPlus },
    { name: t('warmup'), href: '/warmup', icon: Flame },
    { name: t('templates'), href: '/templates', icon: FileText },
    { name: language === 'he' ? 'סטטיסטיקות' : language === 'ar' ? 'إحصائيات' : 'Statistics', href: '/statistics', icon: BarChart3 },
    { name: language === 'he' ? 'בוט היח״ש' : language === 'ar' ? 'روبوت الوحدة' : 'Unit Chatbot', href: '/chatbot', icon: Bot },
    { name: t('flows'), href: '/flows', icon: Workflow },
    // Only show Logs if user has log_access = true
    ...(hasLogAccess ? [{ name: language === 'he' ? 'לוגים' : language === 'ar' ? 'السجلات' : 'Logs', href: '/logs', icon: Terminal }] : []),
    { name: t('settings'), href: '/settings', icon: Settings },
  ];

  const handleSupportClick = () => {
    const whatsappUrl = 'https://wa.me/972528380323';
    if (window.electron?.shell?.openExternal) {
      window.electron.shell.openExternal(whatsappUrl);
    } else {
      window.open(whatsappUrl, '_blank');
    }
  };

  useEffect(() => {
    loadLicenseUser();
    checkLogAccess();
  }, []);

  const loadLicenseUser = async () => {
    try {
      const user = await api.license.getUser();
      if (user.name) {
        setUserName(user.name);
      }
      if (user.email) {
        setUserEmail(user.email);
      }
    } catch (error) {
      console.error('Failed to load license user:', error);
    }
  };

  const checkLogAccess = async () => {
    try {
      const licenseInfo = await api.license.check();
      setHasLogAccess(licenseInfo.logAccess === true);
      console.log('🔍 Log access for this user:', licenseInfo.logAccess ? 'GRANTED' : 'DENIED');
    } catch (error) {
      console.error('Failed to check log access:', error);
      setHasLogAccess(false);
    }
  };
  const { dir } = useLanguage();
  
  return (
    <div className={cn(
      "flex h-screen w-72 flex-col bg-card/50 backdrop-blur-xl",
      dir === 'rtl' ? 'border-l' : 'border-r'
    )}>
      <div className="flex h-32 items-center justify-center px-8 border-b border-border/50" style={{ backgroundColor: 'white' }}>
        <img 
          src={logoImage} 
          alt="Yachash" 
          className="h-20 w-auto object-contain"
        />
      </div>
      
      <nav className="flex-1 space-y-2 px-4 py-6">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 group relative overflow-hidden',
                isActive
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div 
                    className={cn(
                      "absolute top-0 bottom-0 w-1 bg-primary",
                      dir === 'rtl' ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'
                    )}
                  />
                )}
                <item.icon className={cn(
                  "h-5 w-5 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.name}
              </>
            )}
          </NavLink>
        ))}
        
        {/* Support Button */}
        <button
          onClick={handleSupportClick}
          className={cn(
            'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 group relative overflow-hidden w-full',
            'text-muted-foreground hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-600 dark:hover:text-green-400'
          )}
        >
          <HeadphonesIcon className={cn(
            "h-5 w-5 transition-colors",
            "text-muted-foreground group-hover:text-green-600 dark:group-hover:text-green-400"
          )} />
          {language === 'he' ? 'תמיכה' : language === 'ar' ? 'الدعم' : 'Support'}
        </button>
      </nav>
      
      <div className="p-6 border-t border-border/50">
        <NavLink to="/settings">
          {({ isActive }) => (
            <div className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer",
              isActive 
                ? "bg-primary/10 border-primary/30 shadow-sm" 
                : "bg-accent/30 border-border/50 hover:bg-accent/50 hover:border-primary/20"
            )}>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{userName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {userEmail || 'v1.0.0'}
                </p>
              </div>
              {isActive && (
                <Settings className="h-4 w-4 text-primary" />
              )}
            </div>
          )}
        </NavLink>
      </div>
    </div>
  );
}
