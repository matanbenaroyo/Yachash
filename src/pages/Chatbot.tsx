import { useEffect, useState } from 'react';
import { Bot, Save, Send, Plus, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';

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

type TabId = 'settings' | 'knowledge' | 'conversations' | 'inbox' | 'test';

export default function Chatbot() {
  const [tab, setTab] = useState<TabId>('settings');
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  const api = (window as any).electron?.chatbot;

  const refresh = async () => {
    if (!api) return;
    const [cfg, st, wf] = await Promise.all([api.getConfig(), api.getStatus(), api.getWorkflows()]);
    setConfig(cfg);
    setStatus(st);
    setWorkflows(wf);
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
  if (!config) return <div className="p-6">טוען…</div>;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'settings', label: 'הגדרות' },
    { id: 'knowledge', label: 'מאגר ידע' },
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
