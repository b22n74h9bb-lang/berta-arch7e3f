# BandwagonHost cutover — `app.bertapp.life`

Operator checklist for Berta. No secrets in this file.

## Live probe (Cursor, 2026-11-09 ~14:12 Asia/Shanghai)

| Check | Result |
|-------|--------|
| DNS A `bertapp.life` / `app.bertapp.life` | `172.96.18.215` (IT7 / Bandwagon LA, `*.16clouds.com`) |
| TCP `:22` | open |
| TCP `:80` | open — HTTP `502 Bad Gateway`, `Server: Pingora` |
| TCP `:443` | open — TLS handshake EOF, **no peer certificate** |
| TCP `:3000` / `:8080` | closed/filtered from public internet |

**Diagnosis:** edge/proxy answers on 80/443, but the Node app is not reachable behind it (502) and TLS is not terminating correctly (no cert). Bind the app on `127.0.0.1:3000`, point the proxy at it, finish Let's Encrypt / Caddy HTTPS.

## Ordered steps on the VPS

1. **SSH** to the box (port 22 is open).
2. Install Docker + Compose **or** Node 22 + MySQL + Caddy/nginx.
3. Clone `b22n74h9bb-lang/berta-arch7e3f`, create `.env` from `.env.example` (**host only**).
4. Ensure Kimi OAuth redirect includes:
   `https://app.bertapp.life/api/oauth/callback`
5. Bring up stack:
   ```bash
   docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
   ```
6. Schema (once MySQL is up; from a one-off container or host with `DATABASE_URL`):
   ```bash
   npm run db:push
   ```
7. Put **Caddy** (`deploy/Caddyfile`) or **nginx** (`deploy/nginx.app.conf.example`) in front. Prefer binding app to `127.0.0.1:3000` only (compose already does this).
8. Fix whatever currently returns Pingora `502` on `:80` — either replace it with Caddy/nginx, or set its upstream to `127.0.0.1:3000`.
9. Confirm TLS shows a real cert (`openssl s_client -connect app.bertapp.life:443 -servername app.bertapp.life`).
10. Verify:
    ```bash
    curl -fsS https://app.bertapp.life/api/health
    # → {"ok":true,"service":"berta-arch7e3f",...}
    ```
11. Owner success bar: HTTPS load → Kimi sign-in → save task → iPhone Add to Home Screen.
12. Ping Cursor/Ariel in `#arch7e3f` to re-probe from outside.

## If you only have one public IP

Do **not** expose MySQL publicly. Keep `:3000` on loopback. Only 80/443 (and 22 for admin) should be public.
