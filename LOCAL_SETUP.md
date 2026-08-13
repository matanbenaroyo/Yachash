# LeadSender — Local Development Setup

This is a personal fork of [`barelzrihan2002/leadsender`](https://github.com/barelzrihan2002/leadsender),
configured to develop locally without touching the original author's repositories or your
production LeadSender data.

---

## 1. Where the project lives

| | |
|---|---|
| **Project directory** | `C:\Users\97250\projects\leadsender` |
| **`origin`** (your fork, push here) | `https://github.com/matanbenaroyo/Yachash.git` |
| **`upstream`** (original, fetch only) | `https://github.com/barelzrihan2002/leadsender.git` |
| **Branch** | `main` |

The path deliberately has **no spaces** — `node-gyp` and `electron-builder` are unreliable on
Windows paths containing spaces.

> `upstream`'s **push** URL is intentionally set to the invalid value
> `DISABLED_NO_PUSH_TO_UPSTREAM`, so `git push upstream` fails loudly instead of
> pushing to the original author. Undo with:
> `git remote set-url --push upstream https://github.com/barelzrihan2002/leadsender.git`

---

## 2. Start the application

```bash
cd C:\Users\97250\projects\leadsender && npm run electron:dev
```

`electron:dev` runs `vite`, and `vite-plugin-electron` compiles `electron/main.ts` +
`electron/preload.ts` and launches the Electron window itself. The Vite dev server on
`http://localhost:5173` is only the renderer — **opening that URL in a browser is not
running the app** (there is no preload there, so `window.electron` is undefined and you
get stuck on the license dialog).

Hot reload: editing `src/**` hot-reloads the renderer; editing `electron/**` rebuilds the
main process and restarts Electron automatically.

## 3. Stop the application

Close the app window, or press `Ctrl+C` in the terminal running `npm run electron:dev`.
If a process is orphaned:

```bash
taskkill /F /IM electron.exe
```

---

## 4. Reinstall dependencies

**Do not run a bare `npm install` / `npm ci` on this machine — it will fail.**

You are on **Node 24**. `better-sqlite3@9.6.0` ships prebuilt binaries only up to Node ABI 120
(Node 22), so npm falls back to compiling from source with `node-gyp`, which needs Visual
Studio C++ Build Tools that are not installed here.

That fallback is unnecessary: `better-sqlite3` is only ever loaded by the **Electron** main
process, and a prebuilt binary for Electron's ABI (123) *does* exist. So install in two steps:

```bash
npm ci --ignore-scripts && npm run setup
```

`npm run setup` does the three things `--ignore-scripts` skipped:
1. `node node_modules/electron/install.js` — downloads the Electron binary
2. `electron-builder install-app-deps` — fetches the **Electron-ABI** `better-sqlite3` prebuild
3. `puppeteer browsers install chrome` — downloads Chrome for `whatsapp-web.js`

To verify the native module afterwards, the app logs `Database initialized at: ...` on startup.

---

## 5. Build the application

```bash
cd C:\Users\97250\projects\leadsender && npm run build:win
```

| Script | Does |
|---|---|
| `npm run build` | Renderer + main process bundles only (`dist/`, `dist-electron/`) |
| `npm run build:win` | Full Windows NSIS installer |
| `npm run electron:build` | Installer for the current platform |
| `npm run typecheck` | `tsc --noEmit` (see “Known issues”) |

Installers are written to **`release/`** and are git-ignored. Both build scripts pass
`--publish never`, so **nothing is ever uploaded**. Publishing would require an explicit,
deliberate command.

---

## 6. Where your data lives

`app.getPath('userData')` is the root of all app state — database, WhatsApp sessions,
media and license.

| Mode | Data directory |
|---|---|
| **Production** (installed LeadSender) | `%APPDATA%\leadsender` |
| **Development** (`npm run electron:dev`) | `%APPDATA%\leadsender-dev` |

**Dev is deliberately isolated** (`electron/main.ts`). Before this change, `npm run electron:dev`
shared the installed app's directory, so any experiment mutated your real database
(839 contacts), your connected WhatsApp session and your chat photos — and because campaigns
with `status='running'` **auto-resume on startup**, a stray test could have sent real messages
to real contacts.

Inside whichever directory is active:

| Path | Contents |
|---|---|
| `leadsender.db` | SQLite database (WAL mode; also `-wal` / `-shm` files) |
| `sessions/session-<accountId>/` | **WhatsApp logged-in sessions** (`whatsapp-web.js` LocalAuth) |
| `media/`, `chat-photos/` | Downloaded message media and avatars |
| `.license` | Activated license key |

To reset the dev sandbox: close the app and delete `%APPDATA%\leadsender-dev`.

### If the app reports "database disk image is malformed"

Usually the file is fine and the *connection* is not. The app now handles this itself,
at three levels:

| Level | Behaviour |
|---|---|
| While running | `withDbRecovery` reopens the connection and retries the query once |
| At startup | `initDatabase` sets stale `-wal`/`-shm` aside, then falls back to the newest backup that passes `quick_check`, then to an empty database — it never leaves the app unable to start |
| On quit | The WAL is checkpointed back into `leadsender.db`, so the next launch opens one consistent file |

Nothing is deleted during recovery. Everything set aside is kept in
`%APPDATA%\leadsender-dev\backups\` with a timestamp, so a database can always be
restored by copying a backup over `leadsender.db` while the app is closed.

Two causes are now designed out rather than handled:

- **Two copies running at once.** They shared one database and one WhatsApp session
  folder, each with the WAL memory-mapped. `app.requestSingleInstanceLock()` in
  `electron/main.ts` means the second launch focuses the existing window instead.
- **An oversized WAL.** SQLite checkpoints every 1000 pages by default, but only when
  the connection is idle — the app holds one long-lived connection, so the WAL reached
  ~4 MB and stayed there. `wal_autocheckpoint = 256` keeps it around 1 MB.

To verify the database by hand, with the app closed:

```bash
npx electron -e "const D=require('better-sqlite3');const d=new D(process.env.APPDATA+'/leadsender-dev/leadsender.db');console.log(d.pragma('integrity_check'));process.exit(0)"
```

**Do not force-kill the app** (`taskkill /F`, End Task) and do not run write scripts
against the database while it is open — both leave a WAL that a later launch has to
replay, which is how this state arises in the first place. Close it from its window,
or with `Get-Process electron | ForEach-Object { $_.CloseMainWindow() }`.

---

## 7. Never commit these

Already covered by `.gitignore` — do not override it:

- `node_modules/`, `dist/`, `dist-electron/`, `release/`
- `.env`, `.env.*` — secrets
- `*.db`, `*.sqlite`, `*.db-wal`, `*.db-shm` — databases
- `.wwebjs_auth/`, `sessions/` — **logged-in WhatsApp sessions.** Committing these would give
  anyone with repo access control of the connected WhatsApp accounts.
- `.wwebjs_cache/` — WhatsApp Web version snapshots (~4.5 MB; was tracked upstream)
- `electron/**/*.js`, `electron/**/*.d.ts`, `src/**/*.js`, `src/**/*.d.ts`, `*.tsbuildinfo` —
  compiled output (see “Known issues”)
- `test-data/` — local test fixtures and QR snapshots

Check before committing:

```bash
git status --short && git diff --cached --stat
```

---

## 8. Commit and push your own work

```bash
git add -A && git commit -m "feat: describe your change" && git push origin main
```

Always push to **`origin`**. `upstream` is fetch-only and its push URL is disabled.

---

## 9. Pull future updates from the original project

```bash
git fetch upstream && git log --oneline HEAD..upstream/main
```

Review what is incoming, then replay your commits on top:

```bash
git checkout main && git stash -u && git rebase upstream/main && git stash pop
```

`git stash -u` protects uncommitted work; `git stash pop` restores it. Prefer `rebase` so your
fork-specific commits stay on top and stay easy to identify. If you would rather not rewrite
history, use `git merge upstream/main` instead.

**Conflicts to expect**, because these are exactly the files this fork changed:

- `package.json` — keep **your** `repository` (`matanbenaroyo/Yachash`), your
  `--publish never` flags, and the `setup` / `typecheck` scripts
- `electron-builder.yml` — keep **your** `publish:` block and `directories.output: release`
- `electron/main.ts` — keep the dev-isolation block at the top
- `.gitignore` — keep your additions
- Deleted `*.js` / `*.d.ts` artifacts may reappear from upstream. Re-delete them; they shadow
  the `.ts` sources.

Never `git push upstream`.

---

## 10. Known issues (pre-existing, not blocking)

- **`npm run typecheck` reports 7 errors.** All pre-existing upstream type errors; none block
  the build, because Vite/esbuild strips types without checking them. Notably
  `src/pages/Settings.tsx` passes `'ar'` to a `'en' | 'he'` parameter, so Arabic is likely
  half-wired.
- **`electron-builder.json` is dead config.** electron-builder resolves `.yml` before `.json`,
  so **`electron-builder.yml` is the only file that takes effect**. Edit that one.
- **`electron/database/schema.sql` is dead code** — the live schema is the `SCHEMA` string
  inside `electron/database/index.ts`.
- **The app is license-gated** against the original author's Supabase project
  (`electron/services/LicenseManager.ts`, URL + anon key hardcoded upstream). Without a valid
  license the UI shows only the activation dialog and no backend services start. Your existing
  `.license` was copied into the dev directory, which is why dev runs unlocked.
- **`whatsapp-web.js` tracks a moving git branch** (`github:pedroslopez/whatsapp-web.js#main`).
  `package-lock.json` pins a commit, so `npm ci` is reproducible — but a future
  `npm update` could pull an unrelated upstream state.

---

## 11. AI chatbot — מערך היח״ש

A modular AI chatbot that answers incoming WhatsApp messages in Hebrew. It is
**separate from the bulk-campaign system** and **off by default**.

### Where things live

| Path | Purpose |
|---|---|
| `electron/chatbot/ChatbotService.ts` | Engine — orchestrates the whole turn |
| `electron/chatbot/intentRouter.ts` | Classifies a message into one of 8 intents |
| `electron/chatbot/workflows/index.ts` | **One entry per capability** — add new workflows here |
| `electron/chatbot/tools/index.ts` | The AI/business-logic boundary: every real action |
| `electron/chatbot/knowledge/KnowledgeService.ts` | Retrieval over all data sources |
| `electron/chatbot/ConversationManager.ts` | Per-phone conversation state |
| `electron/chatbot/dateParser.ts` | Hebrew relative dates (מחר, יום ראשון, 20.8) |
| `electron/chatbot/prompts/system.ts` | System prompts (wording only, no logic) |
| `src/pages/Chatbot.tsx` | Management UI |

### Turning it on

1. Open **בוט היח״ש** in the sidebar → **הגדרות**.
2. Paste an Anthropic API key (get one at <https://console.anthropic.com>).
   It is stored in the app's local `settings` table — never in the repo.
3. Set the staff destination numbers (international format, e.g. `972501234567`):
   - אישורי כניסת רכב → `vehicleEntryStaffPhone`
   - שאלות כלליות / הסלמות → `generalStaffPhone`
   - קול קורא → `openCallStaffPhone`
   A blank field falls back to the general number.
4. Toggle **צ׳אטבוט פעיל** and save.

The bot then answers incoming messages on connected accounts. It runs **after**
the existing automation flows, so a message a flow already handled never reaches it.

### Managing knowledge

**מאגר ידע** tab. Five categories, each backed by the same table:
`ידע כללי`, `פקודות`, `לו״ז החלפה`, `מסלולי פיתוח`, `קול קורא`.

Each row has a title, content, and a JSON metadata blob for the fields that
category needs:

| Category | Useful metadata |
|---|---|
| `orders` | `{"status": "הופצה", "distributed_at": "2026-10-01"}` |
| `replacements` | `{"entry_date": "2026-11-02", "exit_date": "2026-11-16"}` |
| `development_tracks` | `{"audience": "נגדים"}` |
| `open_calls` | `{"status": "פתוח", "deadline": "2026-12-31"}` |

Rows titled `[דוגמה]` are placeholder demo data seeded on first run —
**delete them and enter the real organizational data.**

### Testing without sending messages

**בדיקה** tab runs the full pipeline (intent → workflow → tools → reply) and
shows the bot's answer without sending anything over WhatsApp. Note that
completion actions (forwarding a vehicle request to staff) *do* send if a staff
number is configured.

### Adding a new workflow

Append one `WorkflowDefinition` to `electron/chatbot/workflows/index.ts` with its
intent, required fields, allowed tools, instructions and completion action; add
the intent to `ChatbotIntent` in `types.ts`, and a tool to `tools/index.ts` if it
needs a new action. The engine, conversation state and IPC layer do not change.

### Guarantees

- The AI never invents organizational facts — dates, orders, schedules, tracks
  and procedures come only from tool results.
- The AI cannot declare an action successful; only a tool result can.
- Unanswerable questions are escalated to the configured staff number rather
  than guessed at.

### Still to provide

Real data for all five knowledge categories, and the staff WhatsApp numbers.
Until then the bot will correctly say it has no information and escalate.
