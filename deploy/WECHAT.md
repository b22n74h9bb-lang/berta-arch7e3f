# WeChat integration plan — Berta / ARCH7E3F

Concrete path for owner-approved WeChat access into `https://app.bertapp.life/`.
**Names only.** Never put AppID secrets, tokens, AES keys, or webhook URLs in Slack or git.

Deadline context: must-have by **13 Nov 2026, 23:59 Asia/Shanghai**. Activation stays owner-gated.

## Goal

Let selected WeChat traffic become audited bridge events and (later) bounded plugin actions — without granting WeChat the app secret, database credentials, or user sessions.

## Recommended product surface (owner choice)

| Option | Use when | Notes |
|--------|----------|-------|
| **A. WeCom (企业微信) bot/callback** | Team / internal ops | Preferred for Seedgym ops. Stable callback + IP allowlist. |
| **B. Official Account (公众号) server callback** | Public subscriber channel | Good for Seedgym audience fan-in; weaker for private mission commands. |
| **C. Mini Program login only** | Phone UX later | Out of scope for the Nov 13 bridge; do not mix into plugin tokens. |

**Default proposal:** Option A for command/bridge; Option B only for public broadcast notifications outbound (no inbound mission mutations).

## Architecture (fits existing bridge)

```
WeChat callback  →  POST /api/webhooks/wechat  (HMAC / WeChat signature verify)
                 →  bridge_events row (source=wechat, payloadHash only)
                 →  optional mission_records projection
                 →  one #seedgym notification on owner-attention transitions

Claw / WeChat agent (if any) → plugin token (scoped) → same tRPC surface as users
```

Plugins never execute inside the app process. They call the same authenticated API with an explicit allowlist (`mission.create`, `task.assign`, `comment.add`, `approval.request`). Default deny. No wildcards.

## Environment variable names (host only)

| Name | Purpose |
|------|---------|
| `WECHAT_MODE` | `wecom` or `oa` (official account) |
| `WECHAT_CORP_ID` | WeCom corp id (Option A) |
| `WECHAT_AGENT_ID` | WeCom agent id (Option A) |
| `WECHAT_CORP_SECRET` | WeCom secret — **server only** |
| `WECHAT_TOKEN` | Callback verification token name |
| `WECHAT_ENCODING_AES_KEY` | Callback crypto key — **server only** |
| `WECHAT_OA_APP_ID` | Official Account app id (Option B) |
| `WECHAT_OA_APP_SECRET` | Official Account secret — **server only** |
| `WECHAT_CALLBACK_PATH` | Fixed path, default `/api/webhooks/wechat` |

Register the exact public callback URL on the WeChat console:
`https://app.bertapp.life/api/webhooks/wechat`

## Implementation steps

1. **Spec lock (Berta + owner):** choose A or B; list allowed inbound event types; list allowed outbound reply templates (text only).
2. **Ingress (Cursor):** fail-closed webhook route — reject when secrets unset; verify signature before parse; store `bridge_events` with `source=wechat` and `payloadHash`; never persist ciphertext secrets or plaintext tokens.
3. **Projection:** map a tiny allowlist of WeChat event types → `mission_records` (same rules as GitHub bridge).
4. **Plugin registration:** owner registers a `wechat-bridge` plugin version in Settings → pending → owner approve → plaintext plugin token shown once → store hash only.
5. **Outbound:** optional WeCom/OA text notify for approval transitions via host secrets; one notification per mission state change (no per-event spam).
6. **Acceptance tests:** signature reject, replay reject, pending plugin cannot act, revoked generation denied, no secrets in API responses.

## Explicit non-goals (Nov 13)

- No third-party Claw marketplace plugins without owner sign-off
- No storing WeChat user PII beyond what the bridge already stores for GitHub actors (login-like ids / refs)
- No payment, Mini Program commerce, or media upload pipelines
- No shared credentials in Slack

## Rollback

- Unset `WECHAT_*` secrets on the host → webhook 503/disabled by design
- Revoke the `wechat-bridge` plugin in Settings → `tokenGeneration` bumps; old tokens die
- Leave GitHub bridge and member approval untouched

## Evidence to post in `#seedgym`

- Chosen mode (A/B)
- Callback path registered (no secret values)
- PR link for ingress + plugin registration
- Test output: signature/permission cases pass
- Confirm `RESTORE_DRILL` / backup notes still treat WeChat secrets as host-only
