# HANDOVER — Berta / ARCH7E3F app

Permanent runbook so Berta (or any operator) can deploy and operate this app without Cursor.
Names only for secrets. Never paste values into Slack or commits.

**Repo:** `b22n74h9bb-lang/berta-arch7e3f`  
**Baseline documented against:** `main` @ `1a050a5` (+ this docs PR)  
**Target URL (owner, 2026-11-09):** `https://app.bertapp.life`  
**Host (owner):** BandwagonHost LA

---

## 1. What this pipeline is

```
Browser PWA (Vite/React)
  → HTTPS reverse proxy
  → Node 22 process (Hono + tRPC) on :3000
  → MySQL (Drizzle)
  → Kimi OAuth (sign-in)
  → Kimi agent gateway (chat + image gen, server-side only)
  → Platform object storage (generated media keys)
```

- Frontend is installable (service worker + manifest).
- Sandbox jobs are **queue records only** until a real executor is connected (`executor: "not-connected"`).
- Image generation: server calls gateway → downloads → uploads to object storage → persists `storage:<key>` only.
- No Claw token is stored by the app. Runtime URLs saved as unverified.

---

## 2. Environment variables (names only)

Copy from `.env.example`. Fill on the **host only**.

| Name | Where used | Notes |
|------|------------|-------|
| `APP_ID` | backend | Application ID |
| `APP_SECRET` | backend | JWT signing — never browser |
| `DATABASE_URL` | backend | `mysql://…` — never browser |
| `VITE_KIMI_AUTH_URL` | frontend build | e.g. `https://auth.kimi.com` |
| `VITE_APP_ID` | frontend build | Must match OAuth app id |
| `KIMI_AUTH_URL` | backend | Same family as Vite auth URL |
| `KIMI_OPEN_URL` | backend | e.g. `https://open.kimi.com` |
| `OWNER_UNION_ID` | backend | First-login admin |
| `KIMI_AGENTGW_API_KEY` | backend | Gateway chat/images — **not** OAuth login |
| `KIMI_AGENTGW_BASE_URL` | backend | Include `/coding/v1` suffix |
| `KIMI_STORAGE_RESOURCE_ID` | backend | Object storage resource id |

**Verified distinction (Ariel, 2026-11-09):** gateway API key unlocks chat/images. It does **not** unlock "Sign in with Kimi". Login still needs OAuth (`APP_ID` / `APP_SECRET` / `VITE_APP_ID` + auth URLs).

**OAuth redirect (code):** `${origin}/api/oauth/callback`  
Register that exact redirect on the Kimi OAuth app for the production origin (e.g. `https://app.bertapp.life/api/oauth/callback`).

---

## 3. Bring-up

### Requirements

- Node.js 22+ **or** Docker (`Dockerfile` is Node 22 Alpine, exposes `3000`)
- MySQL reachable from the host
- Reverse proxy → HTTPS for the public hostname (Let's Encrypt / CDN)
- All env vars above set on the host (and present at **build** time for `VITE_*`)

### Bare metal

```bash
git clone https://github.com/b22n74h9bb-lang/berta-arch7e3f.git
cd berta-arch7e3f
cp .env.example .env   # fill values on host only
npm install
npm run db:push
npm run build
npm start              # serves dist/public + dist/boot.js on :3000
```

### Docker

```bash
docker build -t berta-arch7e3f .
docker run --env-file .env -p 3000:3000 berta-arch7e3f
```

Note: `VITE_*` are baked at image build time. Rebuild the image after changing them.

### Checks before calling it done

```bash
npm run check
npm run test
npm run build
```

### Owner success bar

1. HTTPS URL loads
2. Kimi sign-in works
3. Save a task
4. iPhone Safari → Share → Add to Home Screen

---

## 4. GitHub events → #seedgym (webhook handover)

Goal: push / PR activity reaches Slack even if the GitHub Slack app or Copilot access dies.

### Option A — GitHub Slack app (preferred while it works)

1. In Slack, open the GitHub app → connect the org owner account (`b22n74h9bb-lang`).
2. Subscribe `#seedgym` to `b22n74h9bb-lang/berta-arch7e3f` for `push`, `pull_request`, `issues` (as needed).
3. Verify with a no-op commit or draft PR; confirm a message lands in `#seedgym`.

### Option B — Fallback: repo webhook → Slack incoming webhook

Use when Option A is unavailable.

1. **Slack side:** create an Incoming Webhook for `#seedgym` (Slack app → Incoming Webhooks). Copy the webhook URL into a **host/secret store only** — never into this repo or Slack chat.
2. **GitHub side:** repo Settings → Webhooks → Add webhook:
   - Payload URL = Slack incoming webhook URL (or a tiny relay you control that forwards to Slack)
   - Content type = `application/json`
   - Secret = random string stored only in GitHub + your relay (optional but recommended)
   - Events: at minimum `push` and `Pull requests`
3. Deliver a ping; GitHub shows green delivery.

### Push payload shape (what GitHub sends)

Top-level fields operators usually care about:

| Field | Meaning |
|-------|---------|
| `ref` | e.g. `refs/heads/main` |
| `after` | new commit SHA |
| `repository.full_name` | `b22n74h9bb-lang/berta-arch7e3f` |
| `pusher.name` | who pushed |
| `commits[].id` / `message` / `url` | commit list |
| `compare` | compare URL |
| `head_commit` | tip commit object |

PR events use `action`, `number`, `pull_request.html_url`, `pull_request.title`, `sender.login`.

Slack Incoming Webhooks expect a JSON body like `{ "text": "…" }` (or Block Kit). Map GitHub fields into `text` in a relay if you do not use the official GitHub Slack app.

### What Berta needs from repo admin

- Permission to manage webhooks on `b22n74h9bb-lang/berta-arch7e3f`
- A Slack incoming webhook (or GitHub Slack app install) scoped to `#seedgym`
- One test push after cutover

---

## 5. Known issues / gaps (verified)

| Item | Status |
|------|--------|
| Live URL TLS (2026-11-09 probe) | `app.bertapp.life` DNS → `172.96.18.215`; TLS handshake failed from Cursor probe; `:3000` connection refused — treat HTTPS cutover as **in progress / broken until re-verified** |
| GitHub Copilot in Slack | Returns "isn't authorized to use that resource" — org/account link, not app code |
| Sandbox executor | Not connected by design |
| Chat read-only task state | Post-deploy spec |
| Shared assignment model | Post-deploy spec |
| `MISSION.md` / this file | Added in handover docs PR so Berta can run solo |

---

## 6. Coordination rules for operators

- Propose in Slack; Berta ratifies.
- No secrets in Slack or git.
- After each infra change: ping Berta with evidence (URL screenshot, webhook delivery id, sign-in proof).
- Re-probe `https://app.bertapp.life` after DNS/SSL/app restart before claiming green.

## 7. Quick file map

- `MISSION.md` — purpose / layers / rules
- `README.md` — developer overview
- `.env.example` — env names
- `Dockerfile` — Node 22 Alpine → `:3000`
- `api/` — Hono/tRPC, OAuth callback at `/api/oauth/callback`
- `src/` — PWA UI
- `db/` — Drizzle schema
