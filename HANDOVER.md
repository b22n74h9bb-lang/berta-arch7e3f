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
| `OWNER_UNION_ID` | backend | Kimi first-login admin |
| `OWNER_GITHUB_ID` | backend | GitHub numeric id of the owner. This is not the team allowlist. |
| `GITHUB_CLIENT_ID` | backend | GitHub OAuth app client id. Public in the authorize redirect. |
| `GITHUB_CLIENT_SECRET` | backend | GitHub OAuth client secret. Server only. |
| `GITHUB_OAUTH_REDIRECT_URL` | backend | Exact callback, `https://app.bertapp.life/api/oauth/callback` |
| `GITHUB_WEBHOOK_SECRET` | backend | HMAC for `POST /api/webhooks/github`. Host/Environment only. Ingress fails closed when unset. |
| `KIMI_AGENTGW_API_KEY` | backend | Gateway chat/images — **not** OAuth login |
| `KIMI_AGENTGW_BASE_URL` | backend | Include `/coding/v1` suffix |
| `KIMI_STORAGE_RESOURCE_ID` | backend | Object storage resource id |

**Verified distinction (Ariel, 2026-11-09):** gateway API key unlocks chat/images. It does **not** unlock "Sign in with Kimi". Login still needs OAuth (`APP_ID` / `APP_SECRET` / `VITE_APP_ID` + auth URLs).

**OAuth redirect (code):** `${origin}/api/oauth/callback`  
Register that exact redirect on the Kimi OAuth app and on the GitHub OAuth app for the production origin (e.g. `https://app.bertapp.life/api/oauth/callback`).

GitHub sign-in starts at `/api/oauth/github` with scopes `read:user` and `user:email`. Team access is a `members` row (`githubId`, `login`, `status`, `role`), not an env list. The owner is the only admin. Everyone else stays pending, with no mission data, until the owner approves them in Settings. Reject and revoke bump that member's session generation so the old cookie fails on the next request.

Sign-in and profile refresh write `login` and `userId` only. They never write `status` or `role`. A missing membership row fails closed: protected APIs deny the request. The only exception is a verified owner, matched at request time against `OWNER_GITHUB_ID` or `OWNER_UNION_ID`. `me` returns the stored status, or `pending` when no row exists. It does not invent `approved`.

Kimi sign-in has no approval flow of its own yet. A Kimi session can read mission data only when its union id equals `OWNER_UNION_ID`. Any other Kimi session stays pending and gets no mission, chat, or sandbox data. Approval does not share one person's tasks with another; data queries stay scoped to that user id.

Before the first boot of this change, apply the schema while the current app is still up (`npm run db:push` from a host checkout that has `DATABASE_URL`). The running server also creates `members` if that table is missing, so an existing owner session is not dropped when the new process starts. Then rebuild, because the pending screen is in the frontend. Do not put secret values in compose, Slack, or the PR.

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

## 5. Bandwagon / `bertapp.life` cutover pack

Ready-to-run files for the VPS (no secrets):

| Path | Purpose |
|------|---------|
| `deploy/BANDWAGON.md` | Ordered cutover checklist + live probe diagnosis |
| `deploy/docker-compose.yml` | MySQL + app on `127.0.0.1:3000` |
| `deploy/Caddyfile` | Automatic HTTPS → `:3000` |
| `deploy/nginx.app.conf.example` | nginx + certbot alternative |
| `scripts/probe-bertapp.sh` | External green/red probe |
| `GET /api/health` | JSON health for proxy / Docker HEALTHCHECK |

```bash
bash scripts/probe-bertapp.sh app.bertapp.life
```

### Live probe (2026-11-09 ~14:12 Asia/Shanghai)

| Check | Result |
|-------|--------|
| DNS | `172.96.18.215` (IT7 / Bandwagon LA) |
| `:80` | `502 Bad Gateway` (`Server: Pingora`) — proxy up, upstream missing |
| `:443` | TCP open, TLS EOF, **no certificate** |
| `:3000` | closed publicly (correct once bound to loopback **and** proxied) |

## 6. Known issues / gaps (verified)

| Item | Status |
|------|--------|
| Live URL TLS / upstream | Green as of 2026-11-11 (probe `https://app.bertapp.life/api/health` → ok). Historical §5 probe kept for cutover diagnosis. |
| GitHub Copilot in Slack | Returns "isn't authorized to use that resource" — org/account link, not app code |
| Sandbox executor | Not connected by design |
| Chat read-only task state | Post-deploy spec |
| Shared assignment model | Post-deploy spec |
| Bridge webhook persistence | `POST /api/webhooks/github` verifies HMAC and fails closed without `GITHUB_WEBHOOK_SECRET`; event rows not written until owner-approved follow-up |
| Hooks / Clawbot plugins | Owner Settings panel can register/approve/revoke plugins; tokens hashed + shown once; no third-party activation without owner approval |
| WeChat bridge | Plan in `deploy/WECHAT.md` (env names only). Ingress route not live until secrets set and owner mode choice locked. |
| Backup / restore drill | Non-prod runbook: `deploy/RESTORE.md` + `scripts/restore-drill.sh`. Production dump needs Bandwagon MySQL access. |
| `MISSION.md` / this file | Added so Berta can run solo |

---

## 7. Coordination rules for operators

- Propose in Slack; Berta ratifies.
- No secrets in Slack or git.
- After each infra change: ping Berta with evidence (URL screenshot, webhook delivery id, sign-in proof).
- Re-probe `https://app.bertapp.life` after DNS/SSL/app restart before claiming green.

## 8. Quick file map

- `MISSION.md` — purpose / layers / rules
- `README.md` — developer overview
- `HANDOVER.md` — this runbook
- `deploy/` — Bandwagon compose, Caddy, nginx, cutover checklist, WeChat plan (`WECHAT.md`), restore drill (`RESTORE.md`)
- `scripts/restore-drill.sh` — throwaway MySQL backup → wipe → restore evidence
- `.env.example` — env names (including WeChat host-only names)
- `Dockerfile` — Node 22 Alpine → `:3000` (accepts `VITE_*` build args)
- `api/` — Hono/tRPC, OAuth callback at `/api/oauth/callback`, `/api/health`, bridge plugin owner APIs
- `src/` — PWA UI
- `db/` — Drizzle schema
