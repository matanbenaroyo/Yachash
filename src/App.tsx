import { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Key } from 'lucide-react';
import { LanguageProvider } from './contexts/LanguageContext';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Campaigns from './pages/Campaigns';
import CreateCampaignPage from './pages/CreateCampaignPage';
import CampaignTypePickerPage from './pages/CampaignTypePickerPage';
import CampaignEditorRouterPage from './pages/CampaignEditorRouterPage';
import CreateGroupAdderCampaignPage from './pages/CreateGroupAdderCampaignPage';
import GroupsCampaigns from './pages/GroupsCampaigns';
import CreateGroupsCampaignPage from './pages/CreateGroupsCampaignPage';
import Inbox from './pages/Inbox';
import Contacts from './pages/Contacts';
import Extractor from './pages/Extractor';
import AutoGroupJoin from './pages/AutoGroupJoin';
import WarmUp from './pages/WarmUp';
import FlowBuilder from './pages/FlowBuilder';
import Chatbot from './pages/Chatbot';
import FlowEditor from './pages/FlowEditor';
import Templates from './pages/Templates';
import Statistics from './pages/Statistics';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import LicenseDialog from './components/license/LicenseDialog';
import InitializationLoader from './components/InitializationLoader';
import { Toaster } from './components/ui/sonner';
import type { LicenseInfo } from './types';

function App() {
  const [isElectronReady, setIsElectronReady] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [showLicenseDialog, setShowLicenseDialog] = useState(true); // Start with true
  const [checkingLicense, setCheckingLicense] = useState(true);
  const [accountsInitialized, setAccountsInitialized] = useState(false);

  useEffect(() => {
    // Wait for electron API to be available
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max
    
    const checkElectron = () => {
      attempts++;
      
      if (window.electron) {
        setIsElectronReady(true);
        console.log('✅ Electron API is ready');
        checkLicense();
      } else if (attempts >= maxAttempts) {
        console.error('❌ Electron API not available after 5 seconds');
        setIsElectronReady(true); // תן להמשיך בכל זאת
        setCheckingLicense(false);
        setShowLicenseDialog(true);
      } else {
        console.log('⏳ Waiting for Electron API... (attempt', attempts, '/', maxAttempts, ')');
        setTimeout(checkElectron, 100);
      }
    };
    
    checkElectron();
  }, []);

  const checkLicense = async () => {
    try {
      console.log('🔍 Checking license...');
      console.log('window.electron:', window.electron ? 'exists' : 'missing');
      
      if (!window.electron) {
        console.error('❌ Electron API not available - running in browser mode?');
        setCheckingLicense(false);
        setShowLicenseDialog(true); // Show dialog anyway
        return;
      }
      
      if (!window.electron.license) {
        console.error('❌ License API not available');
        console.log('Available APIs:', Object.keys(window.electron));
        setCheckingLicense(false);
        setShowLicenseDialog(true); // Show dialog anyway
        return;
      }
      
      const info = await window.electron.license.check();
      console.log('📋 License info:', info);
      setLicenseInfo(info);
      
      if (!info.isValid) {
        console.log('⚠️ No valid license, showing dialog');
        setShowLicenseDialog(true);
      } else {
        console.log('✅ License is valid - app should load now!');
        setShowLicenseDialog(false); // Hide dialog
        
        // Force re-render
        setTimeout(() => {
          console.log('🔄 Re-checking render state...');
          console.log('licenseInfo.isValid:', info.isValid);
          console.log('showLicenseDialog:', false);
        }, 100);
        
        // Show expiry warning if less than 7 days left
        if (info.daysLeft !== undefined && info.daysLeft < 7 && info.daysLeft > 0) {
          console.warn(`⚠️ License expires in ${info.daysLeft} days`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to check license:', error);
      setShowLicenseDialog(true);
    } finally {
      setCheckingLicense(false);
    }
  };

  const handleLicenseActivated = () => {
    setShowLicenseDialog(false);
    checkLicense();
  };

  // Daily license check
  useEffect(() => {
    if (!isElectronReady) return;

    const interval = setInterval(checkLicense, 24 * 60 * 60 * 1000); // Every 24 hours
    return () => clearInterval(interval);
  }, [isElectronReady]);

  // Fix for dialog pointer-events getting stuck in Electron
  useEffect(() => {
    const cleanup = setInterval(() => {
      // Remove any stuck pointer-events styles from body
      if (document.body.style.pointerEvents === 'none') {
        console.warn('⚠️ Detected stuck pointer-events, fixing...');
        document.body.style.pointerEvents = '';
      }
    }, 500);

    return () => clearInterval(cleanup);
  }, []);

  if (!isElectronReady || checkingLicense) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading application...</p>
        </div>
      </div>
    );
  }

  // Debug logging
  console.log('🎨 Rendering App component...');
  console.log('   licenseInfo:', licenseInfo);
  console.log('   showLicenseDialog:', showLicenseDialog);
  console.log('   checkingLicense:', checkingLicense);
  console.log('   isElectronReady:', isElectronReady);

  // Test rendering
  if (licenseInfo?.isValid) {
    console.log('✅ Should render Router now!');
  }

  return (
    <LanguageProvider>
      <Toaster />
      {!licenseInfo?.isValid && (
        <LicenseDialog 
          open={showLicenseDialog} 
          onLicenseActivated={handleLicenseActivated}
        />
      )}
      
      {licenseInfo?.isValid && !accountsInitialized ? (
        <InitializationLoader onComplete={() => setAccountsInitialized(true)} />
      ) : licenseInfo?.isValid && accountsInitialized ? (
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/create" element={<CampaignTypePickerPage />} />
              <Route path="campaigns/create/message" element={<CreateCampaignPage />} />
              <Route path="campaigns/create/group-adder" element={<CreateGroupAdderCampaignPage />} />
              <Route path="campaigns/edit/:id" element={<CampaignEditorRouterPage />} />
              <Route path="groups-campaigns" element={<GroupsCampaigns />} />
              <Route path="groups-campaigns/create" element={<CreateGroupsCampaignPage />} />
              <Route path="groups-campaigns/edit/:id" element={<CreateGroupsCampaignPage />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="extractor" element={<Extractor />} />
              <Route path="auto-group-join" element={<AutoGroupJoin />} />
              <Route path="warmup" element={<WarmUp />} />
              <Route path="templates" element={<Templates />} />
              <Route path="statistics" element={<Statistics />} />
              <Route path="chatbot" element={<Chatbot />} />
              <Route path="flows" element={<FlowBuilder />} />
              <Route path="flows/:id" element={<FlowEditor />} />
              <Route path="logs" element={<Logs />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </Router>
      ) : showLicenseDialog ? (
        <div className="flex items-center justify-center h-screen bg-muted/20">
          <div className="text-center max-w-md p-8">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Key className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">License Required</h1>
            <p className="text-muted-foreground mb-6">
              Please activate your license to use Yachash
            </p>
            <p className="text-xs text-muted-foreground">
              Enter your license key in the dialog above
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Checking license...</p>
          </div>
        </div>
      )}
    </LanguageProvider>
  );
}

export default App;
