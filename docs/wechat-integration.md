# WeChat integration

Concrete path for a first-party WeChat adapter. This build does not connect to WeChat. `GET` and `POST /api/wechat/callback` return `503 wechat_disabled` even if host flags, secrets, and a valid signature are present. The handler does not read the body and does not echo `echostr`.

Personal WeChat is out of scope. Do not use unofficial clients, web-session scraping, or a group-robot webhook URL stored in the repo. The supported products are WeCom (企业微信, a self-built app) and a verified WeChat Official Account (服务号).

## Secret names

Set these on the host only, after the owner accepts a delivery change. Do not put values in git, Slack, or plugin config.

| Name | Role |
| --- | --- |
| `WECHAT_ADAPTER` | Later builds may accept only `enabled`. This build ignores it. |
| `WECHAT_APP_ID` | Official Account app id, or WeCom corp id. |
| `WECHAT_APP_SECRET` | Official Account app secret, or WeCom app secret. |
| `WECHAT_TOKEN` | Callback signature token. |
| `WECHAT_ENCODING_AES_KEY` | Official encrypted-message key. |

`PLUGIN_HOOKS_ENABLED` is the separate outbound-hook flag. Leave it unset. This build does not deliver hooks.

## Phase 0 — this change

1. Owner opens Settings → Extensions → Fill WeChat draft.
2. The draft is `wechat-official` `0.1.0`, first-party, sandbox, actions `approval.request` and `comment.add`, hook `approval.decided`, `account_mode` of `wecom` or `official-account`.
3. Register leaves the row `pending`. Approve stores a token hash and still does not open the callback.
4. The readiness checklist reports each gate. `connected` and `shipped` stay false. The callback gate stays “not shipped” even when the other gates are true.

## Phase 1 — owner-approved callback, still no replies

A follow-up may mount the real handshake only when all of these are true:

- This phase is a reviewed code change.
- `WECHAT_ADAPTER` is `enabled`.
- All four secret names are non-empty on the host.
- An approved `wechat-official` row exists.
- The request signature matches WeChat’s published check: SHA1 of the sorted token, timestamp, and nonce. `wechatSignature` already implements that comparison and is covered by tests. It is not used by the live route yet.

`GET` may then return `echostr` so the WeChat console can verify the URL `https://app.bertapp.life/api/wechat/callback`. `POST` still returns a disabled response. Do not decrypt message XML, do not call `api.weixin.qq.com` or `qyapi.weixin.qq.com`, and do not store message text in this phase.

## Phase 2 — bounded inbound and outbound

After a separate approval:

- Decrypt with `WECHAT_ENCODING_AES_KEY` on the server. Persist a hash, the account mode, and a truncated sender id. Do not persist the raw XML or the secrets.
- Map a message into the plugin actions already granted on the row (`comment.add` or `approval.request`). Drop anything else.
- Outbound calls go only to the official API for the chosen mode, and only to recipients already in that WeCom app or Official Account. No fan-out to arbitrary open ids.
- Revoking the plugin row, or unsetting `WECHAT_ADAPTER`, stops both directions on the next request.
- Rate-limit at the route. Failures are logged as codes, not payloads.

## Operator rollback

1. Revoke `wechat-official` in Settings.
2. Unset `WECHAT_ADAPTER` on the host and restart the app.
3. Remove the callback URL from the WeChat or WeCom console.
4. Confirm `GET /api/wechat/callback` is still `503` and that Settings shows Connected: no.

No migration of chat history is required. Phase 0 stores no WeChat messages.
