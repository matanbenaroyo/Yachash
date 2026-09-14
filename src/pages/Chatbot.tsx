import { useEffect, useState } from 'react';
import { Bot, Save, Send, Plus, Trash2, RefreshCw, AlertTriangle, Pencil, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Management area for the מערך היח״ש AI chatbot.
 *
 * Deliberately not overbuilt — it covers the things that must be configurable
 * (on/off, API key, staff destination numbers, knowledge) plus visibility into
 * conversations, escalations and requests, and a test console that exercises
 * the real pipeline without sending WhatsApp messages.
 */

const CATEGORIES = [
  {
    id: 'general',
    label: 'ידע כללי',
    hint: 'נהלים, אנשי קשר, שאלות נפוצות, הנחיות, קישורים.',
    meta: '{}',
  },
  {
    id: 'orders',
    label: 'פקודות',
    hint: 'שם הפקודה + סטטוס הפצה.',
    meta: '{"status":"הופצה","distributed_at":"2026-10-01"}',
  },
  {
    id: 'replacements',
    label: 'לו״ז החלפה',
    hint: 'מחזורי החלפה — מתי נכנסים ומתי יוצאים.',
    meta: '{"entry_date":"2026-11-02","exit_date":"2026-11-16"}',
  },
  {
    id: 'development_tracks',
    label: 'מסלולי פיתוח',
    hint: 'מסלולים, קהל יעד ותנאי קבלה.',
    meta: '{"audience":"נגדים"}',
  },
  {
    id: 'open_calls',
    label: 'קול קורא',
    hint: 'קולות קוראים קיימים.',
    meta: '{"status":"פתוח","deadline":"2026-12-31"}',
  },
] as const;

type TabId = 'settings' | 'knowledge' | 'fyi' | 'contacts' | 'conversations' | 'inbox' | 'test';

export default function Chatbot() {
  const [tab, setTab] = useState<TabId>('settings');
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const api = (window as any).electron?.chatbot;

  /**
   * Loads config/status/workflows. Failures are surfaced rather than swallowed:
   * without this the page sat on "טוען…" forever whenever an IPC call rejected,
   * with nothing on screen to say why.
   */
  const refresh = async () => {
    if (!api) return;
    try {
      const [cfg, st, wf] = await Promise.all([api.getConfig(), api.getStatus(), api.getWorkflows()]);
      setConfig(cfg);
      setStatus(st);
      setWorkflows(wf);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(String(e?.message ?? e));
    }
  };

  useEffect(() => { refresh(); }, []);

  const save = async (patch: any) => {
    setSaving(true);
    try {
      const updated = await api.saveConfig(patch);
      setConfig(updated);
      await refresh();
      toast.success('ההגדרות נשמרו');
    } catch (e: any) {
      toast.error('שמירה נכשלה', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  if (!api) {
    return <div className="p-6 text-muted-foreground">ממשק הצ׳אטבוט אינו זמין.</div>;
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-3" dir="rtl">
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">טעינת עמוד הבוט נכשלה</div>
            <div className="mt-1 font-mono text-xs break-all">{loadError}</div>
            <div className="mt-2 text-xs">
              אם מופיע "No handler registered" — סגור את האפליקציה והפעל מחדש עם <code>npm run electron:dev</code>.
            </div>
          </div>
        </div>
        <Button size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 ml-1" /> נסה שוב</Button>
      </div>
    );
  }

  if (!config) return <div className="p-6">טוען…</div>;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'settings', label: 'הגדרות' },
    { id: 'knowledge', label: 'מאגר ידע' },
    { id: 'fyi', label: 'הפצות מידע' },
    { id: 'contacts', label: 'אנשי קשר' },
    { id: 'conversations', label: 'שיחות' },
    { id: 'inbox', label: 'פניות והסלמות' },
    { id: 'test', label: 'בדיקה' },
  ];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">בוט מערך היח״ש</h1>
            <p className="text-sm text-muted-foreground">
              צ׳אטבוט AI שעונה בוואטסאפ. פועל בנפרד ממערכת הקמפיינים.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={status?.enabled ? 'default' : 'secondary'}>
            {status?.enabled ? 'פעיל' : 'כבוי'}
          </Badge>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 ml-1" /> רענן
          </Button>
        </div>
      </div>

      {status && !status.hasApiKey && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>לא הוגדר מפתח Anthropic API. הבוט לא יענה עד שיוגדר מפתח בלשונית ההגדרות.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="שיחות" value={status?.conversations ?? 0} />
        <Stat label="שיחות פעילות" value={status?.activeConversations ?? 0} />
        <Stat label="הסלמות פתוחות" value={status?.openEscalations ?? 0} />
        <Stat label="פניות שנשלחו" value={status?.requests ?? 0} />
      </div>

      <div className="flex gap-2 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsTab config={config} save={save} saving={saving} workflows={workflows} />}
      {tab === 'knowledge' && <KnowledgeTab api={api} onChange={refresh} />}
      {tab === 'fyi' && <FyiTab api={api} />}
      {tab === 'contacts' && <ContactsTab api={api} />}
      {tab === 'conversations' && <ConversationsTab api={api} />}
      {tab === 'inbox' && <InboxTab api={api} />}
      {tab === 'test' && <TestTab api={api} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ config, save, saving, workflows }: any) {
  const [form, setForm] = useState(config);
  useEffect(() => setForm(config), [config]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">הפעלה ומנוע AI</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>צ׳אטבוט פעיל</Label>
              <p className="text-xs text-muted-foreground">
                כשכבוי, הודעות נכנסות ממשיכות כרגיל ללא מענה אוטומטי.
              </p>
            </div>
            <Switch checked={!!form.enabled} onCheckedChange={v => set('enabled', v)} />
          </div>

          <div>
            <Label htmlFor="apiKey">מפתח Anthropic API</Label>
            <Input
              id="apiKey" type="password" placeholder="sk-ant-..."
              value={form.apiKey ?? ''} onChange={e => set('apiKey', e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              נשמר מקומית בבסיס הנתונים של האפליקציה בלבד.
            </p>
          </div>

          <div>
            <Label htmlFor="model">מודל</Label>
            <Input id="model" value={form.model ?? ''} onChange={e => set('model', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">מספרי סגל ליעד</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            מספרים בפורמט בינלאומי ללא סימנים, למשל 972501234567. אם שדה ריק — נעשה שימוש במספר הכללי.
          </p>
          <div>
            <Label htmlFor="veh">אישורי כניסת רכב</Label>
            <Input id="veh" value={form.vehicleEntryStaffPhone ?? ''} onChange={e => set('vehicleEntryStaffPhone', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gen">שאלות כלליות / הסלמות</Label>
            <Input id="gen" value={form.generalStaffPhone ?? ''} onChange={e => set('generalStaffPhone', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="oc">קול קורא</Label>
            <Input id="oc" value={form.openCallStaffPhone ?? ''} onChange={e => set('openCallStaffPhone', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">הפניה לסגל בכיר — ניתוב לפי דרגה</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            כשמישהי מבקשת להגיע לסגל בכיר או לרמ״דית — או כשאין לבוט תשובה ודאית — הבוט שולח לה
            את האפשרויות האלו ומעביר את הפנייה לגורם המתאים.
            הטקסט נשלח בדיוק כפי שהוא כתוב כאן.
          </p>
          {(form.seniorStaffRouting ?? []).map((r: any, i: number) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[2rem_1fr_10rem_10rem] gap-2 items-center">
              <div className="text-sm text-muted-foreground text-center">{r.option}</div>
              <Input
                value={r.label ?? ''}
                placeholder="תיאור הדרגה"
                onChange={e => {
                  const next = [...form.seniorStaffRouting];
                  next[i] = { ...next[i], label: e.target.value };
                  set('seniorStaffRouting', next);
                }}
              />
              <Input
                value={r.name ?? ''}
                placeholder="שם איש הקשר"
                onChange={e => {
                  const next = [...form.seniorStaffRouting];
                  next[i] = { ...next[i], name: e.target.value };
                  set('seniorStaffRouting', next);
                }}
              />
              <Input
                value={r.phone ?? ''}
                placeholder="972501234567"
                onChange={e => {
                  const next = [...form.seniorStaffRouting];
                  next[i] = { ...next[i], phone: e.target.value };
                  set('seniorStaffRouting', next);
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">הפצת מידע - FYI</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            רק המספרים ברשימה הזו רשאים לשלוח הפצת מידע. כל אחד אחר יקבל סירוב מנומס.
          </p>

          <div>
            <Label>קבוצות יעד להפצה</Label>
            {(form.fyiGroups ?? []).map((g: any, i: number) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_14rem] gap-2 mt-2">
                <Input
                  value={g.chatId ?? ''} placeholder="120363...@g.us"
                  onChange={e => { const n = [...form.fyiGroups]; n[i] = { ...n[i], chatId: e.target.value }; set('fyiGroups', n); }}
                />
                <Input
                  value={g.label ?? ''} placeholder="שם הקבוצה"
                  onChange={e => { const n = [...form.fyiGroups]; n[i] = { ...n[i], label: e.target.value }; set('fyiGroups', n); }}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" className="mt-2"
              onClick={() => set('fyiGroups', [...(form.fyiGroups ?? []), { chatId: '', label: '' }])}>
              <Plus className="h-4 w-4 ml-1" /> הוסף קבוצה
            </Button>
          </div>

          <div>
            <Label htmlFor="digest">שעת סיכום יומי</Label>
            <Input id="digest" className="max-w-[8rem]" value={form.fyiDigestTime ?? ''} placeholder="16:00"
              onChange={e => set('fyiDigestTime', e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              כל יום בשעה הזו נשלח לקבוצות סיכום של ההפצות מ-24 השעות האחרונות.
            </p>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div>
              <Label htmlFor="alertPhone">מספר להתרעות תפעוליות</Label>
              <Input id="alertPhone" value={form.alertPhone ?? ''} placeholder="972501234567"
                onChange={e => set('alertPhone', e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                לכאן נשלחות התרעות כשהבוט לא מצליח להתאושש, וגם הודעת "הבוט פעיל" יומית.
                השאר ריק כדי לכבות את שניהם.
              </p>
            </div>
            <div>
              <Label htmlFor="heartbeat">שעת הודעת "הבוט פעיל"</Label>
              <Input id="heartbeat" className="max-w-[8rem]" value={form.heartbeatTime ?? ''} placeholder="08:00"
                onChange={e => set('heartbeatTime', e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                אם ההודעה הזו <b>לא</b> מגיעה — זה הסימן שמשהו נפל. זה עובד גם כשהמחשב כבוי
                או שאין רשת, בניגוד להתרעה שתלויה במערכת שאולי שבורה.
              </p>
            </div>
          </div>

          <div>
            <Label>מורשים לשלוח ({(form.fyiSenders ?? []).length})</Label>
            <div className="space-y-2 mt-2 max-h-[22rem] overflow-auto pl-1">
              {(form.fyiSenders ?? []).map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[11rem_1fr_1fr_2rem] gap-2">
                  <Input value={r.phone ?? ''} placeholder="972501234567"
                    onChange={e => { const n = [...form.fyiSenders]; n[i] = { ...n[i], phone: e.target.value }; set('fyiSenders', n); }} />
                  <Input value={r.name ?? ''} placeholder="שם"
                    onChange={e => { const n = [...form.fyiSenders]; n[i] = { ...n[i], name: e.target.value }; set('fyiSenders', n); }} />
                  <Input value={r.role ?? ''} placeholder="תפקיד"
                    onChange={e => { const n = [...form.fyiSenders]; n[i] = { ...n[i], role: e.target.value }; set('fyiSenders', n); }} />
                  <Button size="sm" variant="ghost"
                    onClick={() => set('fyiSenders', form.fyiSenders.filter((_: any, j: number) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2"
              onClick={() => set('fyiSenders', [...(form.fyiSenders ?? []), { phone: '', name: '', role: '' }])}>
              <Plus className="h-4 w-4 ml-1" /> הוסף מורשה
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <Label>מורשים לעדכן את מאגר המידע ({(form.knowledgeEditors ?? []).length})</Label>
            <p className="text-xs text-muted-foreground mt-1">
              מי שברשימה יכולה לשלוח לבוט "להלן מידע חדש" ואחריו את המידע. הבוט מציג לה מה חדש ומה סותר את הקיים,
              והיא מאשרת מה להחליף ומה להשאיר לפני שמשהו משתנה. רשימה נפרדת וצרה יותר ממורשי ההפצה — כאן משנים את מה שהבוט עונה לכולם.
            </p>
            <div className="space-y-2 mt-2">
              {(form.knowledgeEditors ?? []).map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[11rem_1fr_1fr_2rem] gap-2">
                  <Input value={r.phone ?? ''} placeholder="972501234567"
                    onChange={e => { const n = [...form.knowledgeEditors]; n[i] = { ...n[i], phone: e.target.value }; set('knowledgeEditors', n); }} />
                  <Input value={r.name ?? ''} placeholder="שם"
                    onChange={e => { const n = [...form.knowledgeEditors]; n[i] = { ...n[i], name: e.target.value }; set('knowledgeEditors', n); }} />
                  <Input value={r.role ?? ''} placeholder="תפקיד"
                    onChange={e => { const n = [...form.knowledgeEditors]; n[i] = { ...n[i], role: e.target.value }; set('knowledgeEditors', n); }} />
                  <Button size="sm" variant="ghost"
                    onClick={() => set('knowledgeEditors', form.knowledgeEditors.filter((_: any, j: number) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2"
              onClick={() => set('knowledgeEditors', [...(form.knowledgeEditors ?? []), { phone: '', name: '', role: '' }])}>
              <Plus className="h-4 w-4 ml-1" /> הוסף מורשה לעדכון
            </Button>

            <div className="mt-4 pt-4 border-t space-y-2">
              <Label htmlFor="reminderTime">תזכורת יומית לעדכון מידע</Label>
              <Input id="reminderTime" className="max-w-[8rem]" value={form.knowledgeReminderTime ?? ''} placeholder="11:00"
                onChange={e => set('knowledgeReminderTime', e.target.value)} />
              <Textarea rows={2} value={form.knowledgeReminderText ?? ''}
                onChange={e => set('knowledgeReminderText', e.target.value)} />
              <p className="text-xs text-muted-foreground">
                כל יום בשעה הזו נשלחת התזכורת לכל מי שברשימה למעלה. <b>{'{שם}'}</b> מתחלף בשם הפרטי של כל אחד מהם.
                אם המחשב או הוואטסאפ לא היו זמינים — נשלחת עד 3 שעות באיחור, ואחרי זה מדלגים על היום.
                השאר את השעה ריקה כדי לכבות.
              </p>
              {(form.knowledgeEditors ?? []).length > 0 && form.knowledgeReminderTime && (
                <p className="text-xs rounded bg-muted px-3 py-2">
                  כך זה ייראה אצל {form.knowledgeEditors[0].name || form.knowledgeEditors[0].phone}:{' '}
                  <b>
                    {(form.knowledgeReminderText || '')
                      .replace(/\{שם\}/g, String(form.knowledgeEditors[0].name ?? '').trim().split(/\s+/)[0] ?? '')
                      .replace(/[ \t]{2,}/g, ' ').trim()}
                  </b>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">הודעת פתיחה</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={5} value={form.greeting ?? ''} onChange={e => set('greeting', e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">תהליכים פעילים</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {workflows.map((w: any) => (
              <Badge key={w.id} variant="secondary">{w.label}</Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            הוספת תהליך חדש נעשית בקוד: <code>electron/chatbot/workflows/index.ts</code>
          </p>
        </CardContent>
      </Card>

      <Button onClick={() => save(form)} disabled={saving}>
        <Save className="h-4 w-4 ml-1" /> {saving ? 'שומר…' : 'שמור הגדרות'}
      </Button>
    </div>
  );
}

function KnowledgeTab({ api, onChange }: any) {
  const [category, setCategory] = useState<string>('general');
  const [entries, setEntries] = useState<any[]>([]);
  const [draft, setDraft] = useState({ title: '', content: '', metadata: '{}' });
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);

  const current = CATEGORIES.find(c => c.id === category)!;

  const load = async () => setEntries(await api.knowledge.list(category));
  useEffect(() => { load(); setDraft(d => ({ ...d, metadata: current.meta })); }, [category]);

  const importDoc = async () => {
    if (!bulk.trim()) { toast.error('אין טקסט לייבוא'); return; }
    setBusy(true);
    try {
      const res = await api.knowledge.bulkImport(category, bulk);
      setBulk('');
      await load(); onChange?.();
      toast.success(`יובאו ${res.created} רשומות`);
    } catch (e: any) {
      toast.error('הייבוא נכשל', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const removeDemo = async () => {
    const res = await api.knowledge.deleteDemo();
    await load(); onChange?.();
    toast.success(`נמחקו ${res.deleted} רשומות דוגמה`);
  };

  const create = async () => {
    if (!draft.title.trim() || !draft.content.trim()) {
      toast.error('נדרשים כותרת ותוכן');
      return;
    }
    let metadata = {};
    try { metadata = JSON.parse(draft.metadata || '{}'); }
    catch { toast.error('מטא-דאטה אינו JSON תקין'); return; }

    await api.knowledge.create({ category, title: draft.title, content: draft.content, metadata });
    setDraft({ title: '', content: '', metadata: '{}' });
    await load(); onChange?.();
    toast.success('נוסף למאגר');
  };

  const remove = async (id: string) => {
    await api.knowledge.delete(id);
    await load(); onChange?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(c => (
          <Button key={c.id} size="sm" variant={category === c.id ? 'default' : 'outline'} onClick={() => setCategory(c.id)}>
            {c.label}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{current.hint}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">הדבקת מסמך שלם</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            הדבק כאן מסמך שלם והוא יפוצל אוטומטית לרשומות נפרדות — כך הבוט מוצא בדיוק את
            הסעיף הרלוונטי במקום לקרוא את כל המסמך.
            <br />
            הפיצול לפי כותרות שמתחילות ב-<code className="font-mono">#</code>, ואם אין כותרות — לפי שורה ריקה
            (השורה הראשונה בכל פסקה היא הכותרת).
          </p>
          <Textarea
            rows={8}
            dir="rtl"
            placeholder={'# שעות פעילות\nהסגל זמין א׳-ה׳ 08:00-16:00.\n\n# איש קשר לנושא רכב\nיובל — 052-451-2658'}
            value={bulk}
            onChange={e => setBulk(e.target.value)}
          />
          <Button size="sm" onClick={importDoc} disabled={busy}>
            <Plus className="h-4 w-4 ml-1" /> {busy ? 'מייבא…' : 'ייבא מסמך'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">הוספת רשומה בודדת</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="כותרת" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          <Textarea rows={3} placeholder="תוכן" value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} />
          <Input
            placeholder={`מטא-דאטה JSON, למשל ${current.meta}`}
            value={draft.metadata}
            onChange={e => setDraft({ ...draft, metadata: e.target.value })}
          />
          <Button size="sm" onClick={create}><Plus className="h-4 w-4 ml-1" /> הוסף</Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={removeDemo}>
          <Trash2 className="h-4 w-4 ml-1" /> מחק את כל רשומות הדוגמה
        </Button>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-sm text-muted-foreground">אין רשומות בקטגוריה זו.</p>}
        {entries.map(e => (
          <Card key={e.id}>
            <CardContent className="pt-4 flex justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium">{e.title}</div>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">{e.content}</div>
                {Object.keys(e.metadata ?? {}).length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1 font-mono break-all">
                    {JSON.stringify(e.metadata)}
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(e.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ConversationsTab({ api }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => { api.getConversations(100).then(setItems); }, []);
  useEffect(() => { if (selected) api.getMessages(selected).then(setMessages); }, [selected]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">אין שיחות עדיין.</p>}
        {items.map(c => (
          <Card key={c.id} className={`cursor-pointer ${selected === c.id ? 'border-primary' : ''}`} onClick={() => setSelected(c.id)}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-center">
                <span className="font-medium">{c.phoneNumber}</span>
                <Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{c.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {c.activeIntent ?? 'ללא כוונה פעילה'} · {c.lastMessageAt ?? c.createdAt}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">תמלול</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
          {!selected && <p className="text-sm text-muted-foreground">בחר שיחה.</p>}
          {messages.map((m, i) => (
            <div key={i} className={`rounded-md p-2 text-sm ${m.role === 'user' ? 'bg-muted' : 'bg-primary/10'}`}>
              <div className="text-xs text-muted-foreground mb-1">{m.role === 'user' ? 'משתמש' : 'בוט'}</div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function InboxTab({ api }: any) {
  const [escalations, setEscalations] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);

  useEffect(() => {
    api.getEscalations().then(setEscalations);
    api.getRequests().then(setRequests);
  }, []);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">הסלמות לסגל</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
          {escalations.length === 0 && <p className="text-sm text-muted-foreground">אין הסלמות.</p>}
          {escalations.map(e => (
            <div key={e.id} className="rounded-md border p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{e.phone_number}</span>
                <Badge variant={e.status === 'sent' ? 'default' : 'secondary'}>{e.status}</Badge>
              </div>
              <div className="text-muted-foreground whitespace-pre-wrap">{e.question}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">פניות שנשלחו</CardTitle></CardHeader>
        <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
          {requests.length === 0 && <p className="text-sm text-muted-foreground">אין פניות.</p>}
          {requests.map(r => (
            <div key={r.id} className="rounded-md border p-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{r.type}</span>
                <Badge variant={r.status === 'sent' ? 'default' : 'secondary'}>{r.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{r.phone_number} → {r.staff_phone || '—'}</div>
              <div className="text-xs font-mono break-all text-muted-foreground">{r.payload}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function FyiTab({ api }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => setItems(await api.getFyiMessages());
  useEffect(() => { load(); }, []);

  const sendDigest = async () => {
    setBusy(true);
    try {
      const res = await api.sendDigestNow();
      if (res.ok) toast.success('הסיכום נשלח (' + res.count + ' הודעות)', res.delivered.join(', '));
      else toast.error('הסיכום לא נשלח', res.error || 'אין הודעות ב-24 השעות האחרונות');
      await load();
    } catch (e: any) {
      toast.error('שגיאה', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const delivered = (m: any) => {
    try { return (JSON.parse(m.delivered_to || '[]') as string[]).join(', ') || '—'; }
    catch { return '—'; }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          הפצות מידע שהתקבלו מהמורשים והועברו לקבוצות.
        </p>
        <Button size="sm" onClick={sendDigest} disabled={busy}>
          <Send className="h-4 w-4 ml-1" /> {busy ? 'שולח…' : 'שלח סיכום עכשיו'}
        </Button>
      </div>

      {items.length === 0 && <p className="text-sm text-muted-foreground">עדיין לא התקבלו הפצות מידע.</p>}
      {items.map(m => (
        <Card key={m.id}>
          <CardContent className="pt-4 space-y-1">
            <div className="flex justify-between items-start gap-2">
              <div className="font-medium">{m.subject || '(ללא נושא)'}</div>
              <Badge variant={m.status === 'sent' ? 'default' : m.status === 'partial' ? 'secondary' : 'destructive'}>
                {m.status === 'sent' ? 'הופץ' : m.status === 'partial' ? 'הופץ חלקית' : m.status === 'failed' ? 'נכשל' : m.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {m.sender_name}{m.sender_role ? ' — ' + m.sender_role : ''} · {m.sender_phone} · {m.created_at}
            </div>
            {m.audience && <div className="text-sm"><span className="text-muted-foreground">אוכלוסיה: </span>{m.audience}</div>}
            {m.highlights && <div className="text-sm whitespace-pre-wrap"><span className="text-muted-foreground">דגשים: </span>{m.highlights}</div>}
            {m.tagav && <div className="text-sm"><span className="text-muted-foreground">תג״ב: </span>{m.tagav}</div>}
            <div className="text-xs text-muted-foreground">
              נשלח ל: {delivered(m)}{m.digest_sent_at ? ' · נכלל בסיכום' : ''}
            </div>
            {m.error && <div className="text-xs text-red-600">{m.error}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** 972509620042 -> 050-962-0042, for reading rather than for dialling. */
function displayPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  const local = d.startsWith('972') && d.length === 12 ? '0' + d.slice(3) : d;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : phone;
}

/** 1995-04-03 -> 03/04/1995, --04-03 -> 03/04. */
function displayBirthday(stored: string | null): string {
  if (!stored) return '';
  const full = stored.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[3]}/${full[2]}/${full[1]}`;
  const partial = stored.match(/^--(\d{2})-(\d{2})$/);
  return partial ? `${partial[2]}/${partial[1]}` : stored;
}

/** Days to the next birthday, or null. Mirrors electron/chatbot/contacts.ts. */
function daysToBirthday(stored: string | null): number | null {
  const m = stored?.match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (y: number) => {
    const leap = new Date(y, 1, 29).getMonth() === 1;
    return new Date(y, month - 1, month === 2 && day === 29 && !leap ? 28 : day);
  };
  let next = at(today.getFullYear());
  if (next < today) next = at(today.getFullYear() + 1);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

const EMPTY_CONTACT = { phone_number: '', full_name: '', personal_number: '', rank: '', birthday: '' };

function ContactsTab({ api }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ form: typeof EMPTY_CONTACT; originalPhone?: string } | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const load = () => api.getKnownContacts().then(setItems);
  useEffect(() => { load(); }, []);

  const filtered = items.filter(c => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    return [c.full_name, c.personal_number, c.rank].some(v => String(v ?? '').toLowerCase().includes(q))
      || (digits.length >= 3 && String(c.phone_number).includes(digits.replace(/^0/, '')));
  });

  const upcoming = items
    .map(c => ({ c, days: daysToBirthday(c.birthday) }))
    .filter(x => x.days !== null && x.days <= 7)
    .sort((a, b) => (a.days as number) - (b.days as number));

  const openEdit = (c?: any) => {
    setFormErrors([]);
    setEditing(c
      ? {
          originalPhone: c.phone_number,
          form: {
            phone_number: displayPhone(c.phone_number),
            full_name: c.full_name ?? '',
            personal_number: c.personal_number ?? '',
            rank: c.rank ?? '',
            birthday: displayBirthday(c.birthday),
          },
        }
      : { form: { ...EMPTY_CONTACT } });
  };

  const save = async () => {
    if (!editing) return;
    const res = await api.saveKnownContact(editing.form, editing.originalPhone);
    if (!res.ok) { setFormErrors(res.errors ?? ['השמירה נכשלה']); return; }
    toast.success(editing.originalPhone ? 'איש הקשר עודכן' : 'איש הקשר נוסף');
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await api.deleteKnownContact(deleting.phone_number);
    toast.success('איש הקשר נמחק');
    setDeleting(null);
    load();
  };

  const set = (key: keyof typeof EMPTY_CONTACT, value: string) =>
    setEditing(e => (e ? { ...e, form: { ...e.form, [key]: value } } : e));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="חיפוש לפי שם, טלפון, מספר אישי או דרגה" value={query}
          onChange={e => setQuery(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setImporting(true)}>
          <Upload className="h-4 w-4 ml-1" /> ייבוא מרובה
        </Button>
        <Button onClick={() => openEdit()}>
          <Plus className="h-4 w-4 ml-1" /> הוספת איש קשר
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {items.length} אנשי קשר. מי שמופיע כאן מזוהה על ידי הבוט, והוא לא יבקש ממנו שוב שם, מספר אישי ודרגה.
      </p>

      {upcoming.length > 0 && (
        <div className="rounded-lg border bg-accent/40 p-3 text-sm">
          <div className="font-medium mb-1">🎂 ימי הולדת בשבוע הקרוב</div>
          {upcoming.map(({ c, days }) => (
            <div key={c.phone_number}>
              {c.full_name || displayPhone(c.phone_number)} — {displayBirthday(c.birthday)}
              <span className="text-muted-foreground"> ({days === 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`})</span>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{items.length ? 'אין תוצאות לחיפוש.' : 'אין עדיין אנשי קשר.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="text-right">
                <th className="p-2">שם</th><th className="p-2">טלפון</th><th className="p-2">מספר אישי</th>
                <th className="p-2">דרגה</th><th className="p-2">יום הולדת</th><th className="p-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const days = daysToBirthday(c.birthday);
                return (
                  <tr key={c.phone_number} className="border-t hover:bg-muted/40">
                    <td className="p-2">{c.full_name || '—'}</td>
                    <td className="p-2 font-mono text-xs" dir="ltr">{displayPhone(c.phone_number)}</td>
                    <td className="p-2">{c.personal_number || '—'}</td>
                    <td className="p-2">{c.rank || '—'}</td>
                    <td className="p-2">
                      {c.birthday ? displayBirthday(c.birthday) : '—'}
                      {days !== null && days <= 7 && <span className="mr-1">🎂</span>}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="עריכה">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} title="מחיקה">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing?.originalPhone ? 'עריכת איש קשר' : 'הוספת איש קשר'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>שם מלא</Label>
                <Input value={editing.form.full_name} onChange={e => set('full_name', e.target.value)} /></div>
              <div><Label>טלפון *</Label>
                <Input dir="ltr" placeholder="050-123-4567" value={editing.form.phone_number}
                  onChange={e => set('phone_number', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>מספר אישי</Label>
                  <Input value={editing.form.personal_number} onChange={e => set('personal_number', e.target.value)} /></div>
                <div><Label>דרגה</Label>
                  <Input placeholder='סמ"ר, רס"ן…' value={editing.form.rank} onChange={e => set('rank', e.target.value)} /></div>
              </div>
              <div><Label>יום הולדת</Label>
                <Input dir="ltr" placeholder="03/04/1995 או 03/04" value={editing.form.birthday}
                  onChange={e => set('birthday', e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">יום/חודש/שנה. אפשר בלי שנה.</p>
              </div>
              {formErrors.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  {formErrors.map(e => <div key={e}>{e}</div>)}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>ביטול</Button>
            <Button onClick={save}><Save className="h-4 w-4 ml-1" /> שמירה</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        onConfirm={confirmDelete}
        title="מחיקת איש קשר"
        description={deleting ? `למחוק את ${deleting.full_name || displayPhone(deleting.phone_number)}? הבוט יבקש ממנו שוב את פרטיו בפנייה הבאה.` : ''}
        confirmText="מחיקה"
        cancelText="ביטול"
        variant="destructive"
      />

      <ImportContactsDialog api={api} open={importing} onClose={() => setImporting(false)} onImported={load} />
    </div>
  );
}

/**
 * Bulk import: paste from Excel or pick a file, see exactly what will happen,
 * then import. Nothing is written until the last step.
 *
 * Rows that cannot be read are shown with their line number and the reason,
 * and are never imported. Showing them matters: a row dropped without comment
 * is a person who is missing from the registry and nobody finds out.
 */
function ImportContactsDialog({ api, open, onClose, onImported }: any) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ rows: any[]; valid: number; invalid: number; fileName?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setText(''); setPreview(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const previewText = async () => {
    if (!text.trim()) return;
    setPreview(await api.previewContactImport(text));
  };

  const pickFile = async () => {
    const res = await api.pickContactFile();
    if (res) setPreview(res);
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    const contacts = preview.rows.filter(r => r.contact).map(r => r.contact);
    const res = await api.importKnownContacts(contacts);
    setBusy(false);
    if (!res.ok) { toast.error('הייבוא נכשל'); return; }
    toast.success(`נוספו ${res.added}, עודכנו ${res.updated}${res.skipped ? `, דולגו ${res.skipped}` : ''}`);
    onImported();
    close();
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent dir="rtl" className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>ייבוא אנשי קשר</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              העתיקו שורות מאקסל והדביקו כאן, או בחרו קובץ. עמודות מוכרות: שם, טלפון, מספר אישי, דרגה, יום הולדת.
              אם אין שורת כותרות — המערכת מזהה כל עמודה לפי התוכן.
            </p>
            <Textarea rows={10} dir="rtl" value={text} onChange={e => setText(e.target.value)}
              placeholder={'שם\tטלפון\tמספר אישי\tדרגה\tיום הולדת\nמתן בנרויו\t050-962-0042\t7643131\tרס"ן\t03/04/1995'} />
            <div className="flex gap-2">
              <Button onClick={previewText} disabled={!text.trim()}>תצוגה מקדימה</Button>
              <Button variant="outline" onClick={pickFile}><Upload className="h-4 w-4 ml-1" /> בחירת קובץ Excel / CSV</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              {preview.fileName && <Badge variant="outline">{preview.fileName}</Badge>}
              <Badge>{preview.valid} תקינים</Badge>
              {preview.invalid > 0 && <Badge variant="destructive">{preview.invalid} לא ייובאו</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              מי שכבר קיים לפי מספר הטלפון יעודכן — רק בשדות שמולאו כאן. שדה ריק בקובץ לא מוחק מידע קיים.
            </p>
            <div className="max-h-80 overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-muted-foreground">
                  <tr className="text-right">
                    <th className="p-2">שורה</th><th className="p-2">שם</th><th className="p-2">טלפון</th>
                    <th className="p-2">מ.א</th><th className="p-2">דרגה</th><th className="p-2">יום הולדת</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map(r => r.contact ? (
                    <tr key={r.line} className="border-t">
                      <td className="p-2 text-muted-foreground">{r.line}</td>
                      <td className="p-2">{r.contact.full_name || '—'}</td>
                      <td className="p-2 font-mono text-xs" dir="ltr">{r.contact.phone_display}</td>
                      <td className="p-2">{r.contact.personal_number || '—'}</td>
                      <td className="p-2">{r.contact.rank || '—'}</td>
                      <td className="p-2">{displayBirthday(r.contact.birthday) || '—'}</td>
                    </tr>
                  ) : (
                    <tr key={r.line} className="border-t bg-destructive/10">
                      <td className="p-2 text-muted-foreground">{r.line}</td>
                      <td className="p-2 text-destructive" colSpan={5}>
                        <div className="font-medium">{r.errors.join(' · ')}</div>
                        <div className="text-xs opacity-80 truncate">{r.raw}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {preview && <Button variant="outline" onClick={() => setPreview(null)}>חזרה</Button>}
          <Button variant="outline" onClick={close}>ביטול</Button>
          {preview && (
            <Button onClick={runImport} disabled={busy || preview.valid === 0}>
              ייבוא {preview.valid} אנשי קשר
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestTab({ api }: any) {
  const [phone, setPhone] = useState('test-console');
  const [input, setInput] = useState('');
  const [log, setLog] = useState<Array<{ role: string; text: string }>>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!input.trim() || busy) return;
    const message = input.trim();
    setInput('');
    setLog(l => [...l, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await api.simulate(phone, message);
      setLog(l => [...l, { role: 'bot', text: res?.reply || res?.error || '(אין תשובה)' }]);
    } catch (e: any) {
      setLog(l => [...l, { role: 'bot', text: `שגיאה: ${e?.message ?? e}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">קונסולת בדיקה</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          מריץ את התהליך המלא (זיהוי כוונה → תהליך → כלים → תשובה) בלי לשלוח הודעות וואטסאפ.
          שים לב: פעולות כמו שליחת בקשת רכב לסגל כן נשלחות בפועל אם מוגדר מספר סגל.
        </p>
        <div className="flex gap-2">
          <Input className="max-w-xs" value={phone} onChange={e => setPhone(e.target.value)} placeholder="מזהה משתמש לבדיקה" />
          <Button variant="outline" size="sm" onClick={async () => { await api.resetConversation(phone); setLog([]); toast.success('השיחה אופסה'); }}>
            אפס שיחה
          </Button>
        </div>

        <div className="rounded-md border p-3 space-y-2 min-h-[240px] max-h-[45vh] overflow-auto">
          {log.length === 0 && <p className="text-sm text-muted-foreground">נסה: "צריך להכניס רכב לקסטינה מחר"</p>}
          {log.map((m, i) => (
            <div key={i} className={`rounded-md p-2 text-sm ${m.role === 'user' ? 'bg-muted' : 'bg-primary/10'}`}>
              <div className="text-xs text-muted-foreground mb-1">{m.role === 'user' ? 'משתמש' : 'בוט'}</div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
          {busy && <p className="text-sm text-muted-foreground">חושב…</p>}
        </div>

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder="כתוב הודעה…"
          />
          <Button onClick={send} disabled={busy}><Send className="h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
