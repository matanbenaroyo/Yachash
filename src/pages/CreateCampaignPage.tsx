import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Send, 
  Image as ImageIcon, 
  Video, 
  FileText, 
  X, 
  CheckSquare,
  Square,
  Upload,
  Smartphone,
  Calendar,
  Clock,
  Zap,
  MoreVertical,
  Phone,
  Video as VideoIcon,
  Wifi,
  Battery,
  Signal,
  Info,
  Smile,
  Bold,
  Italic,
  Strikethrough,
  Code
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import type { Account, Tag } from '@/types';
import { cn } from '@/lib/utils';

export default function CreateCampaignPage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { id: campaignId } = useParams<{ id: string }>();
  const isEditMode = !!campaignId;
  const [loading, setLoading] = useState(false);
  const [loadingCampaign, setLoadingCampaign] = useState(isEditMode);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [duoplusAccounts, setDuoplusAccounts] = useState<Account[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string>('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'document' | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [existingContactsCount, setExistingContactsCount] = useState(0);

  const buildUniqueCampaignContacts = (contacts: Array<{ phone_number: string }>) => {
    const seen = new Set<string>();

    return contacts.reduce<Array<{ phone_number: string }>>((uniqueContacts, contact) => {
      const phoneNumber = contact.phone_number?.trim();
      if (!phoneNumber || seen.has(phoneNumber)) {
        return uniqueContacts;
      }

      seen.add(phoneNumber);
      uniqueContacts.push({ phone_number: phoneNumber });
      return uniqueContacts;
    }, []);
  };

  const applyFormatting = (formatType: 'bold' | 'italic' | 'strikethrough' | 'monospace') => {
    const textarea = messageTextareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = formData.message.substring(start, end);
    
    if (!selectedText) {
      // אם לא נבחר טקסט, הוסף placeholder
      let formatted = '';
      switch (formatType) {
        case 'bold':
          formatted = '*טקסט מודגש*';
          break;
        case 'italic':
          formatted = '_טקסט נטוי_';
          break;
        case 'strikethrough':
          formatted = '~טקסט עם קו חוצה~';
          break;
        case 'monospace':
          formatted = '```טקסט מונוספייס```';
          break;
      }
      
      const newMessage = formData.message.substring(0, start) + formatted + formData.message.substring(end);
      setFormData({ ...formData, message: newMessage });
      
      // Set cursor position after the formatting
      setTimeout(() => {
        const newPos = start + formatted.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      }, 10);
      return;
    }

    // Apply formatting to selected text
    let formatted = '';
    switch (formatType) {
      case 'bold':
        formatted = `*${selectedText}*`;
        break;
      case 'italic':
        formatted = `_${selectedText}_`;
        break;
      case 'strikethrough':
        formatted = `~${selectedText}~`;
        break;
      case 'monospace':
        formatted = `\`\`\`${selectedText}\`\`\``;
        break;
    }

    const newMessage = formData.message.substring(0, start) + formatted + formData.message.substring(end);
    setFormData({ ...formData, message: newMessage });

    // Restore selection
    setTimeout(() => {
      textarea.setSelectionRange(start, start + formatted.length);
      textarea.focus();
    }, 10);
  };

  // Popular emojis list
  const popularEmojis = [
    '😊', '😃', '😄', '😁', '😅', '😂', '🤣', '😉', '😍', '🥰',
    '😘', '😗', '😙', '😚', '🤗', '🤩', '🤔', '🤨', '😐', '😑',
    '😶', '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫',
    '🥱', '😴', '😌', '😛', '😜', '😝', '🤤', '😒', '😓', '😔',
    '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '👐', '🤲',
    '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
    '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
    '⭐', '🌟', '✨', '💫', '🌈', '🔥', '💯', '✅', '❌', '⚠️',
    '🎉', '🎊', '🎁', '🎈', '🎀', '🎂', '🍰', '🧁', '🥳', '🎯'
  ];

  const [formData, setFormData] = useState({
    name: '',
    message: '',
    min_delay: 30,
    max_delay: 60,
    max_messages_per_day: 100,
    start_hour: 9,
    end_hour: 18,
    scheduled_start_datetime: null as string | null,
    enable_scheduling: false,
    messages_before_break: null as number | null,
    break_duration: null as number | null,
    enable_breaks: false,
    skip_recent_contacts: false,
    skip_recent_days: 7,
    send_mode: 'web' as 'web' | 'cloud_phone'
  });

  // Extra message variants (besides formData.message which is variant #1).
  // At send time the scheduler picks one variant at random for each contact.
  const [messageVariants, setMessageVariants] = useState<string[]>([]);

  const addMessageVariant = () => {
    setMessageVariants(prev => [...prev, '']);
  };

  const updateMessageVariant = (index: number, value: string) => {
    setMessageVariants(prev => prev.map((variant, i) => (i === index ? value : variant)));
  };

  const removeMessageVariant = (index: number) => {
    setMessageVariants(prev => prev.filter((_, i) => i !== index));
  };

  // Test message state
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [testAccountId, setTestAccountId] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    loadAccounts();
    loadTags();
    loadTemplates();
    
    if (isEditMode && campaignId) {
      loadCampaignData(campaignId);
    }
  }, []);

  const loadCampaignData = async (id: string) => {
    try {
      setLoadingCampaign(true);
      
      // Load campaign details
      const campaign = await api.campaigns.getById(id);
      if (!campaign) {
        toast.error(language === 'he' ? 'קמפיין לא נמצא' : 'Campaign not found');
        navigate('/campaigns');
        return;
      }
      
      // Check if campaign can be edited
      if (!['draft', 'paused', 'stopped'].includes(campaign.status)) {
        toast.error(language === 'he' ? 'לא ניתן לערוך קמפיין זה' : 'Cannot edit this campaign');
        navigate('/campaigns');
        return;
      }
      
      // Populate form with existing data
      setFormData({
        name: campaign.name,
        message: campaign.message,
        min_delay: campaign.min_delay || 30,
        max_delay: campaign.max_delay || 60,
        max_messages_per_day: campaign.max_messages_per_day || 100,
        start_hour: campaign.start_hour || 9,
        end_hour: campaign.end_hour || 18,
        scheduled_start_datetime: campaign.scheduled_start_datetime || null,
        enable_scheduling: !!campaign.scheduled_start_datetime,
        messages_before_break: campaign.messages_before_break || null,
        break_duration: campaign.break_duration || null,
        enable_breaks: !!(campaign.messages_before_break && campaign.break_duration),
        skip_recent_contacts: campaign.skip_recent_contacts || false,
        skip_recent_days: campaign.skip_recent_days || 7,
        send_mode: campaign.send_mode === 'cloud_phone' ? 'cloud_phone' : 'web'
      });

      // Load extra message variants (variant #1 is formData.message above)
      setMessageVariants(campaign.message_variants || []);
      
      // Load media if exists
      if (campaign.media_path) {
        setMediaType(campaign.media_type as any || null);
        // For existing media, we'll show the path as preview
        setMediaPreview(campaign.media_path);
      }
      
      // Load existing contacts
      const contacts = await api.campaigns.getContacts(id);
      setExistingContactsCount(contacts.length);
      
      // Load assigned accounts
      const accountIds = await api.campaigns.getAccounts(id);
      setSelectedAccounts(accountIds);
      
      console.log('✅ Campaign loaded for editing:', campaign.name);
    } catch (error) {
      console.error('Failed to load campaign:', error);
      toast.error(language === 'he' ? 'שגיאה בטעינת קמפיין' : 'Failed to load campaign');
      navigate('/campaigns');
    } finally {
      setLoadingCampaign(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await window.electron.templates.getAll();
      setTemplates(data);
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker]);

  const loadAccounts = async () => {
    const data = await api.accounts.getAll();
    setAccounts(data.filter(acc => acc.status === 'connected'));
    // Cloud-phone sending doesn't require an active WhatsApp Web session - just a linked DuoPlus device
    setDuoplusAccounts(data.filter(acc => !!acc.duoplus_device_id));
  };

  const loadTags = async () => {
    const data = await api.tags.getAll();
    // Filter out BlackList tag - users shouldn't select it for campaigns
    const filteredTags = data.filter(tag => tag.name !== 'BlackList' && !tag.is_system);
    setTags(filteredTags);
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMediaFile(file);

    // Determine media type
    if (file.type.startsWith('image/')) {
      setMediaType('image');
      const reader = new FileReader();
      reader.onload = (e) => setMediaPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
      setMediaType('video');
      const reader = new FileReader();
      reader.onload = (e) => setMediaPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setMediaType('document');
      setMediaPreview(file.name);
    }
  };

  const removeMedia = () => {
    setMediaFile(null);
    setMediaPreview('');
    setMediaType(null);
  };

  // Accounts eligible for the currently selected send mode
  const sendableAccounts = formData.send_mode === 'cloud_phone' ? duoplusAccounts : accounts;

  const toggleSelectAllAccounts = () => {
    if (selectedAccounts.length === sendableAccounts.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts(sendableAccounts.map(acc => acc.id));
    }
  };

  const handleSendModeChange = (mode: 'web' | 'cloud_phone') => {
    setFormData(prev => ({ ...prev, send_mode: mode }));
    // Accounts eligible differ per mode - clear selection to avoid mismatched accounts being submitted
    setSelectedAccounts([]);
    if (mode === 'cloud_phone') {
      removeMedia();
    }
  };

  const toggleAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    );
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSendTestMessage = async () => {
    if (!testPhoneNumber.trim()) {
      toast.warning(language === 'he' ? 'נא להזין מספר טלפון' : language === 'ar' ? 'الرجاء إدخال رقم الهاتف' : 'Please enter a phone number');
      return;
    }

    if (!formData.message.trim()) {
      toast.warning(language === 'he' ? 'נא להזין הודעה' : language === 'ar' ? 'الرجاء إدخال رسالة' : 'Please enter a message');
      return;
    }

    const accountToUse = testAccountId || selectedAccounts[0];
    if (!accountToUse) {
      toast.warning(language === 'he' ? 'נא לבחור חשבון לשליחה' : language === 'ar' ? 'الرجاء تحديد حساب للإرسال' : 'Please select an account to send from');
      return;
    }

    setSendingTest(true);
    try {
      // Replace variables in message (basic replacement for test)
      let messageToSend = formData.message.replace(/\{\{name\}\}/g, 'Test User');
      
      if (mediaFile && mediaType) {
        // Send with media
        console.log('📤 Sending test message with media...');
        const arrayBuffer = await mediaFile.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        
        // Save as temp file
        const tempPath = await window.electron.messages.saveTempFile(mediaFile.name, buffer as any);
        
        try {
          await window.electron.messages.sendMedia(accountToUse, testPhoneNumber, tempPath, messageToSend);
          toast.success(language === 'he' ? '✅ הודעת טסט נשלחה בהצלחה!' : language === 'ar' ? '✅ تم إرسال رسالة الاختبار بنجاح!' : '✅ Test message sent successfully!');
        } finally {
          // Clean up temp file
          await window.electron.messages.deleteTempFile(tempPath);
        }
      } else {
        // Send text only
        console.log('📤 Sending test message...');
        await window.electron.messages.send(accountToUse, testPhoneNumber, messageToSend);
        toast.success(language === 'he' ? '✅ הודעת טסט נשלחה בהצלחה!' : language === 'ar' ? '✅ تم إرسال رسالة الاختبار بنجاح!' : '✅ Test message sent successfully!');
      }
    } catch (error) {
      console.error('Failed to send test message:', error);
      toast.error(language === 'he' ? '❌ שליחת הודעת הטסט נכשלה' : language === 'ar' ? '❌ فشل إرسال رسالة الاختبار' : '❌ Failed to send test message');
    } finally {
      setSendingTest(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.warning(t('createCampaign.validation.campaignNameRequired'));
      return;
    }
    
    if (!formData.message.trim()) {
      toast.warning(t('createCampaign.validation.messageRequired'));
      return;
    }
    
    if (selectedAccounts.length === 0) {
      toast.warning(t('createCampaign.validation.accountRequired'));
      return;
    }
    
    if (!isEditMode && selectedTags.length === 0) {
      toast.warning(t('createCampaign.validation.tagRequired'));
      return;
    }

    setLoading(true);
    try {
      let campaignData: any = { ...formData };
      
      // If scheduling is enabled, convert datetime-local to ISO string
      if (formData.enable_scheduling && formData.scheduled_start_datetime) {
        // Convert from datetime-local format to ISO string
        campaignData.scheduled_start_datetime = new Date(formData.scheduled_start_datetime).toISOString();
      } else {
        campaignData.scheduled_start_datetime = null;
      }
      
      // If breaks are enabled, keep the values, otherwise set to null
      if (!formData.enable_breaks) {
        campaignData.messages_before_break = null;
        campaignData.break_duration = null;
      }
      
      // Convert skip_recent_contacts to 0/1 for SQLite
      campaignData.skip_recent_contacts = formData.skip_recent_contacts ? 1 : 0;

      // Extra message variants (variant #1 is campaignData.message above)
      campaignData.message_variants = messageVariants.filter(variant => variant.trim().length > 0);
      
      // Remove enable_scheduling and enable_breaks from data (not DB fields)
      delete campaignData.enable_scheduling;
      delete campaignData.enable_breaks;
      
      // Cloud-phone send mode only supports text - never persist media for it
      if (formData.send_mode === 'cloud_phone') {
        campaignData.media_path = null;
        campaignData.media_type = null;
        campaignData.media_caption = null;
      } else if (mediaFile) {
        console.log('💾 Saving campaign media:', mediaFile.name);
        const arrayBuffer = await mediaFile.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        
        // Save media file and get the path
        const mediaPath = await api.campaigns.saveMedia(mediaFile.name, buffer as any);
        console.log('✅ Media saved to:', mediaPath);
        
        // Add media info to campaign data
        campaignData.media_path = mediaPath;
        campaignData.media_type = mediaType;
        campaignData.media_caption = formData.message; // Use message as caption
      } else if (isEditMode && !mediaFile && mediaPreview) {
        // Keep existing media if in edit mode and no new file selected
        campaignData.media_path = mediaPreview;
      }
      
      if (isEditMode && campaignId) {
        // UPDATE existing campaign
        await api.campaigns.update(campaignId, campaignData);
        
        // Update accounts (replace all)
        await api.campaigns.setAccounts(campaignId, selectedAccounts);
        
        // Add new contacts (keep existing + add new from selected tags)
        if (selectedTags.length > 0) {
          const allContacts = await api.contacts.getAll();
          const filteredContacts = allContacts.filter(contact => 
            contact.tags?.some(tag => selectedTags.includes(tag.id))
          );
          const uniqueContacts = buildUniqueCampaignContacts(filteredContacts);
          
          if (uniqueContacts.length > 0) {
            await api.campaigns.addContacts(
              campaignId,
              uniqueContacts
            );
          }
        }
        
        toast.success(language === 'he' ? 'קמפיין עודכן בהצלחה' : 'Campaign updated successfully');
      } else {
        // CREATE new campaign
        const campaign = await api.campaigns.create(campaignData);
        await api.campaigns.addAccounts(campaign.id, selectedAccounts);

        const allContacts = await api.contacts.getAll();
        const filteredContacts = allContacts.filter(contact => 
          contact.tags?.some(tag => selectedTags.includes(tag.id))
        );
        const uniqueContacts = buildUniqueCampaignContacts(filteredContacts);
        
        if (uniqueContacts.length > 0) {
          await api.campaigns.addContacts(
            campaign.id,
            uniqueContacts
          );
        }

        toast.success(t('createCampaign.toast.success'));
      }
      
      navigate('/campaigns');
    } catch (error) {
      console.error(isEditMode ? 'Failed to update campaign:' : 'Failed to create campaign:', error);
      toast.error(isEditMode 
        ? (language === 'he' ? 'שגיאה בעדכון קמפיין' : 'Failed to update campaign')
        : t('createCampaign.toast.error')
      );
    } finally {
      setLoading(false);
    }
  };

  // WhatsApp Preview Component
  const WhatsAppPreview = () => {
    const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    
    return (
      <div className="relative mx-auto border-gray-800 dark:border-gray-800 bg-gray-800 border-[14px] rounded-[2.5rem] h-[600px] w-[300px] shadow-2xl scale-95 transform transition-transform hover:scale-100 duration-500">
        <div className="w-[148px] h-[18px] bg-gray-800 top-0 rounded-b-[1rem] left-1/2 -translate-x-1/2 absolute z-20"></div>
        <div className="h-[32px] w-[3px] bg-gray-800 absolute -start-[17px] top-[72px] rounded-s-lg"></div>
        <div className="h-[46px] w-[3px] bg-gray-800 absolute -start-[17px] top-[124px] rounded-s-lg"></div>
        <div className="h-[46px] w-[3px] bg-gray-800 absolute -start-[17px] top-[178px] rounded-s-lg"></div>
        <div className="h-[64px] w-[3px] bg-gray-800 absolute -end-[17px] top-[142px] rounded-e-lg"></div>
        
        {/* Screen Content */}
        <div className="rounded-[2rem] overflow-hidden w-full h-full bg-[#E5DDD5] dark:bg-[#0b141a] relative flex flex-col">
          {/* Status Bar */}
          <div className="bg-[#008069] dark:bg-[#202c33] px-4 pt-3 pb-2 flex justify-between items-center text-white text-[10px] z-10">
            <span>{currentTime}</span>
            <div className="flex gap-1">
              <Signal className="h-3 w-3" />
              <Wifi className="h-3 w-3" />
              <Battery className="h-3 w-3" />
            </div>
          </div>

          {/* WhatsApp Header */}
          <div className="bg-[#008069] dark:bg-[#202c33] px-3 py-2 flex items-center justify-between text-white shadow-sm z-10">
            <div className="flex items-center gap-2">
              <ArrowLeft className="h-5 w-5 cursor-pointer" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center overflow-hidden">
                  <span className="text-gray-600 font-bold text-xs">JD</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-semibold text-sm leading-tight">{t('createCampaign.whatsappPreview.contactName')}</span>
                  <span className="text-[10px] opacity-80 leading-tight">{t('createCampaign.whatsappPreview.online')}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <VideoIcon className="h-4 w-4" />
              <Phone className="h-4 w-4" />
              <MoreVertical className="h-4 w-4" />
            </div>
          </div>

          {/* Chat Background & Messages */}
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4"
            style={{
              backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
              backgroundSize: '400px',
              backgroundBlendMode: 'overlay',
              backgroundColor: '#e5ddd5'
            }}
          >
             {/* Date Divider */}
             <div className="flex justify-center my-2">
                <span className="bg-[#e9edef] dark:bg-[#1f2c34] text-gray-800 dark:text-gray-300 text-[10px] px-2 py-1 rounded-lg shadow-sm font-medium">
                  {t('createCampaign.whatsappPreview.today')}
                </span>
             </div>

             {/* The Message Bubble */}
             <div className="flex justify-end">
                <div className="bg-[#d9fdd3] dark:bg-[#005c4b] rounded-lg rounded-tr-none p-2 max-w-[85%] shadow-sm relative group">
                  {/* Tail */}
                  <div className="absolute top-0 -right-2 w-0 h-0 border-t-[10px] border-t-[#d9fdd3] dark:border-t-[#005c4b] border-r-[10px] border-r-transparent transform rotate-0"></div>
                  
                  {/* Media Preview inside bubble */}
                  {mediaPreview && (
                    <div className="mb-2 rounded-lg overflow-hidden bg-black/10">
                      {mediaType === 'image' && (
                        <img src={mediaPreview} alt="Preview" className="w-full h-auto object-cover" />
                      )}
                      {mediaType === 'video' && (
                        <video src={mediaPreview} className="w-full h-auto" controls />
                      )}
                      {mediaType === 'document' && (
                        <div className="bg-white/50 p-3 flex items-center gap-3 rounded-lg border border-black/5">
                          <FileText className="h-8 w-8 text-red-500" />
                          <span className="text-sm truncate max-w-[120px] font-medium">{mediaFile?.name}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message Text */}
                  <p className="text-[13px] text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed" dir={language === 'he' || language === 'ar' ? 'rtl' : 'ltr'}>
                    {formData.message || t('createCampaign.whatsappPreview.defaultMessage')}
                  </p>
                  
                  {/* Timestamp & Ticks */}
                  <div className="flex items-end justify-end gap-1 mt-1">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {currentTime}
                    </span>
                    <span className="text-[#53bdeb]">
                      <svg viewBox="0 0 16 11" height="11" width="16" preserveAspectRatio="xMidYMid meet" className="" version="1.1" x="0px" y="0px" enableBackground="new 0 0 16 11">
                        <path fill="currentColor" d="M12.157,0.492L4.545,8.127L1.875,5.434c-0.345-0.348-0.906-0.348-1.254,0c-0.342,0.345-0.342,0.903,0,1.251 l3.298,3.322c0.165,0.165,0.386,0.258,0.627,0.258c0.235,0,0.456-0.093,0.621-0.258l8.241-8.268c0.345-0.345,0.345-0.903,0-1.248 C13.06,0.146,12.502,0.146,12.157,0.492z M15.385,0.492l-8.244,8.268L6.505,8.127l7.623-7.635c0.346-0.348,0.906-0.348,1.254,0 C15.73,0.837,15.73,1.396,15.385,0.492z M12.791,9.006l-1.304,1.31c-0.345,0.348-0.906,0.348-1.251,0L6.505,6.582 l0.636-0.64l3.111,3.137c0.165,0.168,0.386,0.258,0.624,0.258c0.235,0,0.456-0.09,0.621-0.258l1.293-1.299 C12.791,7.78,12.791,9.006,12.791,9.006z"></path>
                      </svg>
                    </span>
                  </div>
                </div>
             </div>
          </div>
          
          {/* Input Bar Mockup */}
          <div className="bg-[#f0f2f5] dark:bg-[#202c33] p-2 flex items-center gap-2 z-10 border-t border-gray-200 dark:border-gray-800">
            <div className="bg-white dark:bg-[#2a3942] rounded-full p-2 cursor-pointer hover:bg-gray-100 transition-colors">
                <span className="text-gray-500 text-xl">😊</span>
            </div>
            <div className="bg-white dark:bg-[#2a3942] flex-1 rounded-lg px-4 py-2 text-sm text-gray-400 border border-transparent focus:border-[#00a884]">
                {t('createCampaign.whatsappPreview.inputPlaceholder')}
            </div>
            <div className="bg-[#00a884] rounded-full p-2.5 shadow-sm cursor-pointer hover:bg-[#008f6f] transition-colors">
                <span className="text-white text-sm">🎤</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loadingCampaign) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">
            {language === 'he' ? 'טוען קמפיין...' : 'Loading campaign...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <div className="flex-none px-8 py-6 border-b border-primary/10 bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/campaigns')}
              className="rounded-full hover:bg-primary/10 hover:text-primary transition-colors h-10 w-10"
            >
              <ArrowLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                {isEditMode 
                  ? (language === 'he' ? 'ערוך קמפיין' : language === 'ar' ? 'تحرير الحملة' : 'Edit Campaign')
                  : t('createCampaign.title')
                }
              </h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                {isEditMode && existingContactsCount > 0 ? (
                  <span className="text-blue-600 dark:text-blue-400">
                    {language === 'he' 
                      ? `${existingContactsCount} אנשי קשר קיימים`
                      : `${existingContactsCount} existing contacts`
                    }
                  </span>
                ) : (
                  <>
                    <span className={cn("h-2.5 w-2.5 rounded-full animate-pulse", accounts.length > 0 ? "bg-green-500" : "bg-yellow-500")}></span>
                    {t('createCampaign.accountsAvailable').replace('{count}', accounts.length.toString())}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-3">
             <Button variant="outline" onClick={() => navigate('/campaigns')} className="border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all">
                {t('createCampaign.buttons.discard')}
             </Button>
             <Button onClick={handleSubmit} disabled={loading || loadingCampaign} className="gap-2 shadow-lg hover:shadow-primary/30 transition-all bg-gradient-to-r from-primary to-primary/90 hover:scale-[1.02] active:scale-[0.98]">
                <Send className="h-4 w-4" />
                {loading 
                  ? (isEditMode 
                      ? (language === 'he' ? 'מעדכן...' : 'Updating...') 
                      : t('createCampaign.buttons.launching')
                    )
                  : (isEditMode 
                      ? (language === 'he' ? 'עדכן קמפיין' : 'Update Campaign')
                      : t('createCampaign.buttons.launch')
                    )
                }
             </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-7xl mx-auto p-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            
            {/* Left Column: Form Configuration */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-8 pb-20">
              
              {/* Step 1: Campaign Details & Message */}
              <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm overflow-hidden hover:shadow-2xl transition-all duration-300 group">
                <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-indigo-500"></div>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-lg shadow-sm group-hover:scale-110 transition-transform">1</div>
                    <div>
                      <CardTitle className="text-xl">{t('createCampaign.step1.title')}</CardTitle>
                      <CardDescription>{t('createCampaign.step1.description')}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 pl-6 pr-6 pb-8">
                  <div className="grid gap-2">
                    <Label htmlFor="name" className="text-base font-medium">{t('createCampaign.step1.campaignName')}</Label>
                    <Input
                      id="name"
                      placeholder={t('createCampaign.step1.campaignNamePlaceholder')}
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="text-lg font-medium h-12 border-primary/20 focus:border-primary focus:ring-primary/20 bg-background/50"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label className="flex justify-between items-center text-base font-medium">
                        {t('createCampaign.step1.messageContent')}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                            className="text-xs font-normal bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 h-7 relative"
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            {t('templates.loadTemplate')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const currentMessage = formData.message;
                              const needsSpace = currentMessage.length > 0 && !currentMessage.endsWith(' ');
                              const newMessage = currentMessage + (needsSpace ? ' {{name}}' : '{{name}}');
                              setFormData({ ...formData, message: newMessage });
                            }}
                            className="text-xs font-normal bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 h-7"
                          >
                            {t('createCampaign.step1.personalizeHint')}
                          </Button>
                        </div>
                    </Label>
                    
                    {/* Template Selector Dropdown */}
                    {showTemplateSelector && templates.length > 0 && (
                      <div className="relative z-10 mb-2">
                        <div className="absolute top-0 right-0 w-96 bg-white dark:bg-slate-900 border rounded-xl shadow-2xl p-3 max-h-[300px] overflow-y-auto">
                          <div className="text-xs font-semibold mb-2 text-muted-foreground">
                            {t('templates.selectTemplate')}
                          </div>
                          <div className="space-y-1">
                            {templates.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={async () => {
                                  // Load message
                                  setFormData({ 
                                    ...formData, 
                                    message: template.message 
                                  });
                                  
                                  // Load media if exists
                                  if (template.media_path && template.media_type) {
                                    try {
                                      // Get file from backend via IPC
                                      const fileData = await window.electron.templates.getMediaFile(template.media_path);
                                      
                                      if (fileData) {
                                        // Convert array back to Uint8Array
                                        const uint8Array = new Uint8Array(fileData.buffer);
                                        const blob = new Blob([uint8Array]);
                                        const file = new File([blob], fileData.fileName, { 
                                          type: template.media_type === 'image' 
                                            ? 'image/jpeg' 
                                            : template.media_type === 'video' 
                                            ? 'video/mp4' 
                                            : 'application/pdf' 
                                        });
                                        
                                        setMediaFile(file);
                                        
                                        // Create preview URL
                                        const reader = new FileReader();
                                        reader.onload = (e) => {
                                          setMediaPreview(e.target?.result as string);
                                        };
                                        reader.readAsDataURL(file);
                                        
                                        setMediaType(template.media_type);
                                      }
                                    } catch (error) {
                                      console.error('Failed to load template media:', error);
                                    }
                                  } else {
                                    // Clear media if template has none
                                    setMediaFile(null);
                                    setMediaPreview('');
                                    setMediaType(null);
                                  }
                                  
                                  setShowTemplateSelector(false);
                                  toast.success(t('templates.useTemplate'));
                                }}
                                className="w-full text-left p-3 rounded-lg hover:bg-accent transition-colors border border-transparent hover:border-primary/20"
                              >
                                <div className="font-medium text-sm mb-1">{template.name}</div>
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {template.message}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Formatting Toolbar */}
                    <div className="flex gap-1 p-1 bg-muted/30 rounded-lg border mb-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => applyFormatting('bold')}
                        className="h-8 px-2 hover:bg-background"
                        title={t('createCampaign.formatting.bold')}
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => applyFormatting('italic')}
                        className="h-8 px-2 hover:bg-background"
                        title={t('createCampaign.formatting.italic')}
                      >
                        <Italic className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => applyFormatting('strikethrough')}
                        className="h-8 px-2 hover:bg-background"
                        title={t('createCampaign.formatting.strikethrough')}
                      >
                        <Strikethrough className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => applyFormatting('monospace')}
                        className="h-8 px-2 hover:bg-background"
                        title={t('createCampaign.formatting.monospace')}
                      >
                        <Code className="h-3.5 w-3.5" />
                      </Button>
                      <div className="h-6 w-[1px] bg-border my-auto mx-1"></div>
                      <span className="text-[10px] text-muted-foreground my-auto px-2">
                        {language === 'he' ? 'בחר טקסט ולחץ' : language === 'ar' ? 'حدد النص وانقر' : 'Select text and click'}
                      </span>
                    </div>
                    
                    <div className="relative group/textarea">
                        <Textarea
                        ref={messageTextareaRef}
                        id="message"
                        placeholder={t('createCampaign.step1.messagePlaceholder')}
                        value={formData.message}
                        onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                        className="min-h-[180px] resize-none pr-12 leading-relaxed text-base border-primary/20 focus:border-primary focus:ring-primary/20 bg-background/50 transition-all"
                        />
                        <div className="absolute bottom-3 right-3 flex gap-2">
                            <input
                                type="file"
                                id="media-upload"
                                className="hidden"
                                accept="image/*,video/*,.pdf,.doc,.docx"
                                onChange={handleMediaUpload}
                            />
                            
                            {/* Emoji Picker */}
                            <div className="relative" ref={emojiPickerRef}>
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                className="h-9 px-3 rounded-full hover:bg-amber-100 dark:hover:bg-amber-900/20 hover:text-amber-600 transition-colors gap-1.5"
                                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                              >
                                <Smile className="h-4 w-4" />
                                <span className="text-xs font-medium hidden sm:inline">
                                  {language === 'he' ? 'אימוג\'י' : language === 'ar' ? 'رموز' : 'Emoji'}
                                </span>
                              </Button>
                              
                              {showEmojiPicker && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-40" 
                                    onClick={() => setShowEmojiPicker(false)}
                                  />
                                  <div className="absolute bottom-full right-0 mb-2 z-50 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border p-3 w-[280px]">
                                    <div className="text-xs font-semibold mb-2 text-muted-foreground">
                                      {language === 'he' ? 'בחר אימוג\'י' : language === 'ar' ? 'اختر رمز تعبيري' : 'Select emoji'}
                                    </div>
                                    <div className="grid grid-cols-10 gap-1 max-h-[200px] overflow-y-auto">
                                      {popularEmojis.map((emoji, idx) => (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={() => {
                                            setFormData({ ...formData, message: formData.message + emoji });
                                            setShowEmojiPicker(false);
                                          }}
                                          className="text-xl hover:bg-accent rounded p-1 transition-colors"
                                        >
                                          {emoji}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                            
                            {formData.send_mode !== 'cloud_phone' && (
                              <Button 
                                type="button" 
                                variant="outline"
                                size="sm" 
                                className="h-9 px-4 rounded-full border-dashed border-primary/30 hover:border-primary hover:bg-primary/5 text-primary gap-2 shadow-sm hover:shadow-md transition-all font-medium"
                                onClick={() => document.getElementById('media-upload')?.click()}
                              >
                                <Upload className="h-4 w-4" />
                                <span className="text-xs hidden sm:inline">
                                  {mediaFile 
                                    ? (language === 'he' ? 'שנה קובץ' : language === 'ar' ? 'تغيير الملف' : 'Change')
                                    : (language === 'he' ? 'צרף קובץ' : language === 'ar' ? 'إرفاق ملف' : 'Attach File')
                                  }
                                </span>
                              </Button>
                            )}
                        </div>
                    </div>
                    {formData.send_mode === 'cloud_phone' && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Info className="h-3.5 w-3.5" />
                            {language === 'he' ? 'שליחה בטלפון ענן תומכת בטקסט בלבד - מדיה לא תישלח.' : language === 'ar' ? 'الإرسال عبر الهاتف السحابي يدعم النص فقط - لن يتم إرسال الوسائط.' : 'Cloud phone sending only supports text - media will not be sent.'}
                        </p>
                    )}
                    {mediaFile && formData.send_mode !== 'cloud_phone' && (
                        <div className="flex items-center gap-4 p-4 border border-primary/20 rounded-xl bg-primary/5 animate-in fade-in slide-in-from-bottom-2">
                            <div className="h-12 w-12 rounded-lg bg-background flex items-center justify-center shadow-sm">
                              {mediaType === 'image' ? <ImageIcon className="h-6 w-6 text-blue-500" /> : 
                               mediaType === 'video' ? <Video className="h-6 w-6 text-purple-500" /> : 
                               <FileText className="h-6 w-6 text-orange-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{mediaFile.name}</div>
                              <div className="text-xs text-muted-foreground">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                            <Button type="button" variant="ghost" size="icon" onClick={removeMedia} className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    )}

                    {/* Message Variants (random selection at send time) */}
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                          {t('createCampaign.step1.messageVariantsTitle')}
                        </Label>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addMessageVariant}
                          className="text-xs font-normal h-7"
                        >
                          {t('createCampaign.step1.addMessageVariant')}
                        </Button>
                      </div>

                      {messageVariants.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {t('createCampaign.step1.messageVariantsHint')}
                        </p>
                      )}

                      {messageVariants.map((variant, index) => (
                        <div key={index} className="relative">
                          <div className="text-[11px] font-medium text-muted-foreground mb-1">
                            {t('createCampaign.step1.messageVariantLabel')} {index + 2}
                          </div>
                          <Textarea
                            value={variant}
                            onChange={(e) => updateMessageVariant(index, e.target.value)}
                            placeholder={t('createCampaign.step1.messagePlaceholder')}
                            className="min-h-[100px] resize-none pr-10 leading-relaxed text-base border-primary/20 focus:border-primary focus:ring-primary/20 bg-background/50 transition-all"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeMessageVariant(index)}
                            className="absolute top-6 right-2 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Step 2: Target Audience */}
              <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm overflow-hidden hover:shadow-2xl transition-all duration-300 group">
                <div className="h-1.5 w-full bg-gradient-to-r from-purple-500 to-pink-500"></div>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 font-bold text-lg shadow-sm group-hover:scale-110 transition-transform">2</div>
                    <div>
                      <CardTitle className="text-xl">{t('createCampaign.step2.title')}</CardTitle>
                      <CardDescription>{t('createCampaign.step2.description')}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-8 pl-6 pr-6 pb-8">
                   {/* Send Mode Selection */}
                   <div className="space-y-3">
                        <Label className="text-base font-medium">
                          {language === 'he' ? 'אופן שליחה' : language === 'ar' ? 'طريقة الإرسال' : 'Send Mode'}
                        </Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => handleSendModeChange('web')}
                                className={cn(
                                    "text-left p-4 rounded-xl border-2 transition-all",
                                    formData.send_mode === 'web'
                                        ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                                        : "border-border/50 hover:border-primary/30 bg-background/50"
                                )}
                            >
                                <p className="font-semibold text-sm">{language === 'he' ? 'WhatsApp Web' : language === 'ar' ? 'واتساب ويب' : 'WhatsApp Web'}</p>
                                <p className="text-xs text-muted-foreground mt-1">{language === 'he' ? 'שולח דרך חיבור ה-WhatsApp Web הקיים. תומך בטקסט ומדיה.' : language === 'ar' ? 'يرسل عبر اتصال واتساب ويب الحالي. يدعم النص والوسائط.' : 'Sends through the existing WhatsApp Web session. Supports text and media.'}</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleSendModeChange('cloud_phone')}
                                className={cn(
                                    "text-left p-4 rounded-xl border-2 transition-all",
                                    formData.send_mode === 'cloud_phone'
                                        ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                                        : "border-border/50 hover:border-primary/30 bg-background/50"
                                )}
                            >
                                <p className="font-semibold text-sm">{language === 'he' ? 'טלפון ענן (DuoPlus)' : language === 'ar' ? 'هاتف سحابي (DuoPlus)' : 'Cloud Phone (DuoPlus)'}</p>
                                <p className="text-xs text-muted-foreground mt-1">{language === 'he' ? 'שולח דרך אפליקציית WhatsApp במכשיר ענן. טקסט בלבד, ללא מדיה.' : language === 'ar' ? 'يرسل عبر تطبيق واتساب على هاتف سحابي. نص فقط، بدون وسائط.' : 'Sends through the WhatsApp app on a cloud phone device. Text only, no media.'}</p>
                            </button>
                        </div>
                        {formData.send_mode === 'cloud_phone' && duoplusAccounts.length === 0 && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-xs text-amber-900 dark:text-amber-100 flex items-center gap-2">
                                    <Info className="h-3.5 w-3.5 flex-shrink-0" />
                                    {language === 'he'
                                        ? 'אין חשבונות עם מזהה מכשיר DuoPlus. הגדר מזהה מכשיר לחשבון בעמוד החשבונות.'
                                        : language === 'ar'
                                        ? 'لا توجد حسابات مرتبطة بمعرف جهاز DuoPlus. قم بتعيين معرف الجهاز للحساب في صفحة الحسابات.'
                                        : 'No accounts have a DuoPlus device ID assigned. Set a device ID for an account on the Accounts page.'
                                    }
                                </p>
                            </div>
                        )}
                   </div>

                   <Separator className="bg-border/50" />

                   {/* Accounts Selection */}
                   <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Label className="text-base font-medium flex items-center gap-2">
                              <Smartphone className="h-4 w-4 text-primary" />
                              {t('createCampaign.step2.sendFromAccounts')}
                            </Label>
                            <Button variant="ghost" size="sm" onClick={toggleSelectAllAccounts} className="h-8 text-xs gap-2 hover:bg-primary/10 hover:text-primary">
                                {selectedAccounts.length === sendableAccounts.length ? <CheckSquare className="h-4 w-4"/> : <Square className="h-4 w-4"/>}
                                {selectedAccounts.length === sendableAccounts.length ? t('createCampaign.step2.deselectAll') : t('createCampaign.step2.selectAll')}
                            </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {sendableAccounts.map(account => (
                                <div
                                    key={account.id}
                                    onClick={() => toggleAccount(account.id)}
                                    className={cn(
                                        "flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md",
                                        selectedAccounts.includes(account.id) 
                                            ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm" 
                                            : "border-border/50 hover:border-primary/30 bg-background/50"
                                    )}
                                >
                                    <div className="relative">
                                        {account.profile_picture_url ? (
                                            <img src={account.profile_picture_url} alt="" className="h-12 w-12 rounded-full object-cover shadow-sm border-2 border-background" />
                                        ) : (
                                            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center border-2 border-background shadow-sm">
                                                <Smartphone className="h-6 w-6 text-primary" />
                                            </div>
                                        )}
                                        {selectedAccounts.includes(account.id) && (
                                            <div className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full p-1 shadow-sm animate-in zoom-in">
                                                <CheckSquare className="h-3 w-3" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="overflow-hidden">
                                        <p className="font-semibold text-sm truncate">{account.name || t('createCampaign.step2.unnamed')}</p>
                                        <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">{account.phone_number}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                   </div>

                   <Separator className="bg-border/50" />

                   {/* Tags Selection */}
                   <div className="space-y-4">
                        <Label className="text-base font-medium flex items-center gap-2">
                          <Upload className="h-4 w-4 text-primary" />
                          {t('createCampaign.step2.targetAudience')}
                        </Label>
                        <div className="flex flex-wrap gap-3 bg-background/50 p-4 rounded-xl border border-border/50 min-h-[100px]">
                            {tags.length === 0 ? (
                                <div className="w-full flex flex-col items-center justify-center py-4 text-muted-foreground">
                                  <p className="text-sm">{t('createCampaign.step2.noTags')}</p>
                                </div>
                            ) : (
                                tags.map(tag => (
                                    <Badge
                                        key={tag.id}
                                        variant="outline"
                                        className={cn(
                                            "cursor-pointer px-4 py-2 text-sm transition-all select-none border-2 hover:scale-105 active:scale-95",
                                            selectedTags.includes(tag.id) 
                                              ? "bg-primary text-primary-foreground border-primary shadow-md" 
                                              : "bg-background hover:bg-accent hover:text-accent-foreground hover:border-accent-foreground/30"
                                        )}
                                        onClick={() => toggleTag(tag.id)}
                                        style={selectedTags.includes(tag.id) ? {} : { borderColor: tag.color }}
                                    >
                                        {tag.name}
                                    </Badge>
                                ))
                            )}
                        </div>
                   </div>
                </CardContent>
              </Card>

              {/* Step 3: Schedule & Limits */}
              <Card className="border-none shadow-xl bg-card/50 backdrop-blur-sm overflow-hidden hover:shadow-2xl transition-all duration-300 group">
                <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-yellow-500"></div>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400 font-bold text-lg shadow-sm group-hover:scale-110 transition-transform">3</div>
                    <div>
                      <CardTitle className="text-xl">{t('createCampaign.step3.title')}</CardTitle>
                      <CardDescription>{t('createCampaign.step3.description')}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-8 pl-6 pr-6 pb-8">
                    
                    {/* Delays */}
                    <div className="space-y-6">
                        <div className="flex justify-between items-center bg-background/50 p-3 rounded-lg border border-border/50">
                            <Label className="flex items-center gap-2 text-base font-medium">
                                <Clock className="h-5 w-5 text-orange-500" /> {t('createCampaign.step3.delayBetweenMessages')}
                            </Label>
                            <Badge variant="secondary" className="text-sm font-mono px-3">
                                {formData.min_delay}s - {formData.max_delay}s
                            </Badge>
                        </div>
                        <div className="px-2">
                             <div className="flex items-center gap-6">
                                <div className="flex-1 space-y-3">
                                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
                                        <span>{t('createCampaign.step3.minDelay')}</span>
                                    </div>
                                    <Input 
                                        type="number" 
                                        value={formData.min_delay}
                                        onChange={e => setFormData({...formData, min_delay: +e.target.value})}
                                        className="h-12 text-center font-mono text-lg border-orange-200 focus:border-orange-500 focus:ring-orange-200"
                                    />
                                </div>
                                <div className="w-8 h-[2px] bg-border mt-8"></div>
                                <div className="flex-1 space-y-3">
                                    <div className="flex justify-between text-sm font-medium text-muted-foreground">
                                        <span>{t('createCampaign.step3.maxDelay')}</span>
                                    </div>
                                    <Input 
                                        type="number" 
                                        value={formData.max_delay}
                                        onChange={e => setFormData({...formData, max_delay: +e.target.value})}
                                        className="h-12 text-center font-mono text-lg border-orange-200 focus:border-orange-500 focus:ring-orange-200"
                                    />
                                </div>
                             </div>
                        </div>
                    </div>

                    <Separator className="bg-border/50" />

                    {/* Limits & Hours */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <Label className="flex items-center gap-2 text-base font-medium">
                                <Zap className="h-5 w-5 text-yellow-500" /> {t('createCampaign.step3.dailyLimit')}
                            </Label>
                            <div className="flex items-center gap-3 bg-background/50 p-4 rounded-xl border border-border/50">
                                <Input 
                                    type="number" 
                                    value={formData.max_messages_per_day}
                                    onChange={e => setFormData({...formData, max_messages_per_day: +e.target.value})}
                                    className="h-12 text-lg font-mono w-24 text-center border-yellow-200 focus:border-yellow-500 focus:ring-yellow-200"
                                />
                                <span className="text-sm font-medium text-muted-foreground">{t('createCampaign.step3.msgsPerAccount')}</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-2 text-base font-medium">
                                    <Calendar className="h-5 w-5 text-blue-500" /> {t('createCampaign.step3.workingHours')}
                                </Label>
                                <Button 
                                    type="button" 
                                    size="sm" 
                                    variant="outline"
                                    onClick={() => setFormData({...formData, start_hour: 0, end_hour: 24})}
                                    className="h-8 text-xs hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-colors"
                                >
                                    <Clock className="h-3 w-3 mr-1.5" />
                                    {t('createCampaign.step3.set24_7')}
                                </Button>
                            </div>
                            
                            <div className="flex items-center gap-3 bg-background/50 p-4 rounded-xl border border-border/50">
                                <div className="flex-1">
                                    <p className="text-xs text-muted-foreground mb-1 text-center">{t('createCampaign.step3.startTime')}</p>
                                    <Input 
                                        type="number" 
                                        min={0} 
                                        max={23}
                                        value={formData.start_hour}
                                        onChange={e => setFormData({...formData, start_hour: +e.target.value})}
                                        className="text-center font-mono text-lg h-12 border-blue-200 focus:border-blue-500 focus:ring-blue-200"
                                    />
                                    <p className="text-[10px] text-muted-foreground mt-1 text-center font-mono bg-muted/50 rounded px-1">
                                        {String(formData.start_hour).padStart(2, '0')}:00
                                    </p>
                                </div>
                                <span className="text-muted-foreground font-bold">-</span>
                                <div className="flex-1">
                                    <p className="text-xs text-muted-foreground mb-1 text-center">{t('createCampaign.step3.endTime')}</p>
                                    <Input 
                                        type="number" 
                                        min={0} 
                                        max={24}
                                        value={formData.end_hour}
                                        onChange={e => setFormData({...formData, end_hour: +e.target.value})}
                                        className="text-center font-mono text-lg h-12 border-blue-200 focus:border-blue-500 focus:ring-blue-200"
                                    />
                                    <p className="text-[10px] text-muted-foreground mt-1 text-center font-mono bg-muted/50 rounded px-1">
                                        {String(formData.end_hour).padStart(2, '0')}:00
                                    </p>
                                </div>
                            </div>
                            
                            {/* Visual indicator for 24/7 mode */}
                            {formData.start_hour === 0 && formData.end_hour === 24 && (
                                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-2.5 animate-in fade-in slide-in-from-top-2">
                                    <p className="text-xs text-green-800 dark:text-green-200 font-medium flex items-center justify-center gap-1.5">
                                        <CheckSquare className="h-3.5 w-3.5" />
                                        {t('createCampaign.step3.alwaysOn')}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    <Separator className="bg-border/50" />

                    {/* Campaign Scheduling */}
                    <div className="space-y-4 bg-blue-50/50 dark:bg-blue-950/10 p-5 rounded-xl border border-blue-100 dark:border-blue-900/30">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="enable_scheduling"
                                checked={formData.enable_scheduling}
                                onCheckedChange={checked => setFormData({...formData, enable_scheduling: checked})}
                                className="data-[state=checked]:bg-blue-600"
                            />
                            <Label htmlFor="enable_scheduling" className="cursor-pointer flex items-center gap-2 font-medium text-base">
                                <Calendar className="h-5 w-5 text-blue-600" />
                                {t('createCampaign.scheduling.enableScheduling')}
                            </Label>
                        </div>
                        
                        {formData.enable_scheduling && (
                            <div className="pl-14 animate-in fade-in slide-in-from-top-2">
                                <div className="max-w-sm space-y-2">
                                    <Label className="text-sm text-muted-foreground">
                                        {t('createCampaign.scheduling.startDateTime')}
                                    </Label>
                                    <Input 
                                        type="datetime-local"
                                        value={formData.scheduled_start_datetime || ''}
                                        onChange={e => setFormData({...formData, scheduled_start_datetime: e.target.value})}
                                        min={new Date().toISOString().slice(0, 16)}
                                        className="font-mono h-12 text-lg border-blue-200 focus:border-blue-500 focus:ring-blue-200 bg-background"
                                    />
                                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-1.5">
                                        <Info className="h-3.5 w-3.5" />
                                        {language === 'he' 
                                            ? 'הקמפיין יתחיל אוטומטית בתאריך ושעה שנבחרו'
                                            : language === 'ar'
                                            ? 'ستبدأ الحملة تلقائياً في التاريخ والوقت المحددين'
                                            : 'Campaign will start automatically at the selected date and time'
                                        }
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator className="bg-border/50" />

                    {/* Break Configuration */}
                    <div className="space-y-4 bg-purple-50/50 dark:bg-purple-950/10 p-5 rounded-xl border border-purple-100 dark:border-purple-900/30">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="enable_breaks"
                                checked={formData.enable_breaks}
                                onCheckedChange={checked => setFormData({...formData, enable_breaks: checked})}
                                className="data-[state=checked]:bg-purple-600"
                            />
                            <Label htmlFor="enable_breaks" className="cursor-pointer flex items-center gap-2 font-medium text-base">
                                <Clock className="h-5 w-5 text-purple-600" />
                                {language === 'he' 
                                    ? 'הפעל הפסקות אוטומטיות'
                                    : language === 'ar'
                                    ? 'تمكين فترات الراحة التلقائية'
                                    : 'Enable Automatic Breaks'
                                }
                            </Label>
                        </div>
                        
                        {formData.enable_breaks && (
                            <div className="pl-14 animate-in fade-in slide-in-from-top-2">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label className="text-sm text-muted-foreground flex items-center gap-2">
                                                <Send className="h-4 w-4 text-purple-500" />
                                                {language === 'he' 
                                                    ? 'מספר הודעות לפני הפסקה'
                                                    : language === 'ar'
                                                    ? 'عدد الرسائل قبل الاستراحة'
                                                    : 'Messages before break'
                                                }
                                            </Label>
                                            <Input 
                                                type="number"
                                                min={1}
                                                value={formData.messages_before_break || ''}
                                                onChange={e => setFormData({...formData, messages_before_break: e.target.value ? +e.target.value : null})}
                                                placeholder={language === 'he' ? 'לדוגמה: 50' : language === 'ar' ? 'مثال: 50' : 'e.g., 50'}
                                                className="h-12 text-center font-mono text-lg border-purple-200 focus:border-purple-500 focus:ring-purple-200 bg-background"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-sm text-muted-foreground flex items-center gap-2">
                                                <Clock className="h-4 w-4 text-purple-500" />
                                                {language === 'he' 
                                                    ? 'משך ההפסקה (דקות)'
                                                    : language === 'ar'
                                                    ? 'مدة الاستراحة (دقائق)'
                                                    : 'Break duration (minutes)'
                                                }
                                            </Label>
                                            <Input 
                                                type="number"
                                                min={1}
                                                value={formData.break_duration || ''}
                                                onChange={e => setFormData({...formData, break_duration: e.target.value ? +e.target.value : null})}
                                                placeholder={language === 'he' ? 'לדוגמה: 10' : language === 'ar' ? 'مثال: 10' : 'e.g., 10'}
                                                className="h-12 text-center font-mono text-lg border-purple-200 focus:border-purple-500 focus:ring-purple-200 bg-background"
                                            />
                                        </div>
                                    </div>
                                    
                                    {formData.messages_before_break && formData.break_duration && (
                                        <div className="bg-purple-100 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-3 animate-in fade-in slide-in-from-top-2">
                                            <p className="text-xs text-purple-800 dark:text-purple-200 font-medium flex items-center gap-2">
                                                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                                                <span>
                                                    {language === 'he' 
                                                        ? `כל חשבון יקח הפסקה של ${formData.break_duration} דקות אחרי כל ${formData.messages_before_break} הודעות`
                                                        : language === 'ar'
                                                        ? `سيأخذ كل حساب استراحة ${formData.break_duration} دقيقة بعد كل ${formData.messages_before_break} رسالة`
                                                        : `Each account will take a ${formData.break_duration}-minute break after every ${formData.messages_before_break} messages`
                                                    }
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator className="bg-border/50" />

                    {/* Skip Recent Contacts */}
                    <div className="space-y-4 bg-red-50/50 dark:bg-red-950/10 p-5 rounded-xl border border-red-100 dark:border-red-900/30">
                        <div className="flex items-center gap-3">
                            <Switch
                                id="skip_recent_contacts"
                                checked={formData.skip_recent_contacts}
                                onCheckedChange={checked => setFormData({...formData, skip_recent_contacts: checked})}
                                className="data-[state=checked]:bg-red-600"
                            />
                            <Label htmlFor="skip_recent_contacts" className="cursor-pointer flex items-center gap-2 font-medium text-base">
                                <Info className="h-5 w-5 text-red-600" />
                                {language === 'he' 
                                    ? 'דלג על אנשי קשר שקיבלו הודעה לאחרונה'
                                    : language === 'ar'
                                    ? 'تخطي جهات الاتصال التي تلقت رسائل مؤخرًا'
                                    : 'Skip contacts who received messages recently'
                                }
                            </Label>
                        </div>
                        
                        {formData.skip_recent_contacts && (
                            <div className="pl-14 animate-in fade-in slide-in-from-top-2">
                                <div className="max-w-sm space-y-2">
                                    <Label className="text-sm text-muted-foreground flex items-center gap-2">
                                        <Calendar className="h-4 w-4 text-red-500" />
                                        {language === 'he' 
                                            ? 'מספר ימים לאחור'
                                            : language === 'ar'
                                            ? 'عدد الأيام السابقة'
                                            : 'Number of days back'
                                        }
                                    </Label>
                                    <Input 
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={formData.skip_recent_days}
                                        onChange={e => setFormData({...formData, skip_recent_days: +e.target.value})}
                                        className="h-12 text-center font-mono text-lg border-red-200 focus:border-red-500 focus:ring-red-200 bg-background"
                                    />
                                    <div className="bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 animate-in fade-in slide-in-from-top-2">
                                        <p className="text-xs text-red-800 dark:text-red-200 font-medium flex items-center gap-2">
                                            <Info className="h-3.5 w-3.5 flex-shrink-0" />
                                            <span>
                                                {language === 'he' 
                                                    ? `אנשי קשר שקיבלו הודעה ב-${formData.skip_recent_days} הימים האחרונים לא יקבלו הודעה מהקמפיין`
                                                    : language === 'ar'
                                                    ? `جهات الاتصال التي تلقت رسائل في آخر ${formData.skip_recent_days} يومًا لن تتلقى رسائل من الحملة`
                                                    : `Contacts who received messages in the last ${formData.skip_recent_days} days will not receive campaign messages`
                                                }
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
              </Card>

            </div>

            {/* Right Column: Preview (Sticky) */}
            <div className="hidden lg:block lg:col-span-5 xl:col-span-4">
              <div className="sticky top-24 space-y-8">
                <div className="flex items-center justify-between px-2">
                    <h3 className="font-bold text-xl bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">{t('createCampaign.preview.title')}</h3>
                    <Badge variant="outline" className="bg-background/50 backdrop-blur border-primary/20 text-primary">{t('createCampaign.preview.whatsappWeb')}</Badge>
                </div>
                
                <div className="flex justify-center transform hover:scale-[1.02] transition-transform duration-500">
                    <WhatsAppPreview />
                </div>

                {/* Summary Card below phone */}
                <Card className="border-none shadow-xl bg-card/80 backdrop-blur overflow-hidden">
                    <div className="h-1 w-full bg-gradient-to-r from-primary via-blue-500 to-purple-500"></div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">{t('createCampaign.summary.title')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                                <p className="text-xs text-muted-foreground mb-1">{t('createCampaign.summary.selectedAccounts')}</p>
                                <p className="text-2xl font-bold text-primary">{selectedAccounts.length}</p>
                            </div>
                            <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                                <p className="text-xs text-muted-foreground mb-1">{t('createCampaign.summary.targetTags')}</p>
                                <p className="text-2xl font-bold text-purple-600">{selectedTags.length}</p>
                            </div>
                        </div>
                        
                        <div className="bg-primary/5 p-4 rounded-xl border border-primary/10">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-muted-foreground">{t('createCampaign.summary.estDailyVolume')}</span>
                                <Zap className="h-4 w-4 text-yellow-500" />
                            </div>
                            <p className="text-3xl font-bold text-primary">
                                {t('createCampaign.summary.msgsCount').replace('{count}', (selectedAccounts.length * formData.max_messages_per_day).toString())}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 opacity-70">Based on limits and accounts</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Test Message Card - only applicable to WhatsApp Web send mode */}
                {formData.send_mode !== 'cloud_phone' && (
                <Card className="border-none shadow-xl bg-card/80 backdrop-blur overflow-hidden">
                    <div className="h-1 w-full bg-gradient-to-r from-green-500 to-emerald-500"></div>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Send className="h-5 w-5 text-green-600" />
                            {language === 'he' ? 'שלח הודעת טסט' : language === 'ar' ? 'إرسال رسالة اختبار' : 'Send Test Message'}
                        </CardTitle>
                        <CardDescription>
                            {language === 'he' 
                                ? 'בדוק איך ההודעה נראית לפני שליחת הקמפיין'
                                : language === 'ar'
                                ? 'تحقق من شكل الرسالة قبل إرسال الحملة'
                                : 'Test how your message looks before launching the campaign'
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {/* Account Selection */}
                        {selectedAccounts.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-xs text-muted-foreground">
                                    {language === 'he' ? 'שלח מחשבון' : language === 'ar' ? 'إرسال من حساب' : 'Send from account'}
                                </Label>
                                <select
                                    value={testAccountId || selectedAccounts[0] || ''}
                                    onChange={(e) => setTestAccountId(e.target.value)}
                                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    {selectedAccounts.map(accId => {
                                        const account = accounts.find(a => a.id === accId);
                                        return (
                                            <option key={accId} value={accId}>
                                                {account?.name || account?.phone_number || accId.substring(0, 8)}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}

                        {/* Phone Number Input */}
                        <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">
                                {language === 'he' ? 'מספר טלפון' : language === 'ar' ? 'رقم الهاتف' : 'Phone number'}
                            </Label>
                            <Input
                                type="tel"
                                placeholder={language === 'he' ? '972501234567' : language === 'ar' ? '972501234567' : '972501234567'}
                                value={testPhoneNumber}
                                onChange={(e) => setTestPhoneNumber(e.target.value)}
                                className="h-10 font-mono"
                            />
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Info className="h-3 w-3" />
                                {language === 'he' 
                                    ? 'כולל קוד מדינה, ללא +'
                                    : language === 'ar'
                                    ? 'يشمل رمز البلد، بدون +'
                                    : 'Include country code, without +'
                                }
                            </p>
                        </div>

                        {/* Send Button */}
                        <Button
                            onClick={handleSendTestMessage}
                            disabled={sendingTest || !formData.message.trim() || !testPhoneNumber.trim() || selectedAccounts.length === 0}
                            className="w-full gap-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                        >
                            <Send className="h-4 w-4" />
                            {sendingTest 
                                ? (language === 'he' ? 'שולח...' : language === 'ar' ? 'إرسال...' : 'Sending...')
                                : (language === 'he' ? 'שלח הודעת טסט' : language === 'ar' ? 'إرسال رسالة اختبار' : 'Send Test Message')
                            }
                        </Button>

                        {selectedAccounts.length === 0 && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-xs text-amber-900 dark:text-amber-100 flex items-center gap-2">
                                    <Info className="h-3.5 w-3.5" />
                                    {language === 'he' 
                                        ? 'בחר לפחות חשבון אחד כדי לשלוח הודעת טסט'
                                        : language === 'ar'
                                        ? 'حدد حسابًا واحدًا على الأقل لإرسال رسالة اختبار'
                                        : 'Select at least one account to send a test message'
                                    }
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
