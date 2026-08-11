# LeadSender — Local Development Setup

This is a personal fork of [`barelzrihan2002/leadsender`](https://github.com/barelzrihan2002/leadsender),
configured to develop locally without touching the original author's repositories or your
production LeadSender data.

---

## 1. Where the project lives

| | |
|---|---|
| **Project directory** | `C:\Users\97250\projects\leadsender` |
| **`origin`** (your fork, push here) | `https://github.com/matanbenaroyo/leadsender.git` |
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

- `package.json` — keep **your** `repository` (`matanbenaroyo/leadsender`), your
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
