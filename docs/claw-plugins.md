# Claw plugins

Extension interface for `https://app.bertapp.life`. Owner approval is required before a plugin is anything other than a pending row. This build does not execute plugin code, does not call the network for hooks, and does not accept plugin tokens on any route.

## Registration

The owner registers a plugin from Settings. The row is always inserted as `pending`.

| Field | Rule |
| --- | --- |
| Name | 3–64 chars, lowercase letters, digits, hyphens. `wechat*` and `berta*` are reserved for first-party adapters. |
| Version | `major.minor.patch`. A new version is a new row and needs its own approval. |
| Kind | `first-party` or `third-party`. Kind does not grant access. |
| Surface | `extension` or `wechat`. WeChat must be first-party and named `wechat-official`. |
| Actions | One or more of `mission.create`, `task.assign`, `comment.add`, `approval.request`. No wildcards. |
| Hooks | Zero or more of `mission.updated`, `task.updated`, `approval.requested`, `approval.decided`. No wildcards. |
| Config | Short labels only. No URLs, tokens, or secret-like field names. |
| Isolation | Always `sandbox`. The caller cannot select host access. |

The manifest is stored in `plugins.scopes` as JSON. Legacy comma-separated action lists still parse as sandboxed extensions with no hooks.

## Approval

Only the verified owner can list, register, approve, or revoke. `pluginAllowsAction` remains default-deny: pending and revoked plugins allow nothing, and an approved plugin allows only the actions named on that row.

Approve bumps `tokenGeneration` and stores a SHA-256 hash of a one-time token. The plaintext is returned once to the owner session and is not logged. Revoke bumps the generation again and sets `revokedAt` on outstanding hashes, so a previously shown token no longer matches. Approving an already-approved row does not rotate the token.

There is no plugin HTTP API in this build. A captured token cannot call the app until a later owner-approved ingress exists.

## Hooks

`selectHookRecipients` returns approved sandbox plugins whose subscription list contains that exact event. Pending, revoked, invalid, non-sandbox, and wildcard subscriptions are dropped.

`dispatchPluginHooks` always returns `delivered: false`. With the host flag unset the reason is `hooks_disabled`. With the flag set and at least one recipient, the reason is `hooks_not_shipped`. No URL is stored on the plugin row, and this build does not open an outbound connection.

Signed envelope helper `outboundHookSignature` remains available for a future worker. It is not called from the request path.

## What a later delivery change must include

- An owner-approved code change, not only an environment flag.
- HTTPS endpoints from a host allowlist, not from plugin config.
- A summary payload (kind, id, state). No chat text, tokens, or webhook bodies.
- The existing replay window in `outboundHookFresh`.
- A worker that can be turned off by unsetting the flag and by revoking the plugin row.
