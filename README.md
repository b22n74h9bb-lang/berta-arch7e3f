# Berta — ARCH7E3F Mission Control

An installable, mobile-first mission-control PWA for Berta: authenticated AI chat, voice interaction, persistent ARCH7E3F mission state, explicit approvals, and sandbox-job tracking.

## What is implemented

- React 19 + TypeScript + Vite + Tailwind CSS frontend
- Hono + tRPC 11 backend with SuperJSON
- MySQL persistence through Drizzle ORM
- Kimi OAuth and JWT account sessions
- Server-side AI calls with runtime model selection and typed error handling
- Direct image creation from the console: one-tap dialog → gateway generation → object storage, with the result previewed immediately and archived as a sandbox job record
- Voice input and spoken replies where the browser supports them
- Local screen preview; frames are not sent to Berta
- Mission objectives, tasks, Rabbit-mode settings, and credit planning limits
- Persistent sandbox queue records and approval/rejection controls
- Installable PWA with a service worker, application-shell cache, manifest, and Apple touch icons

## Important behavior

The sandbox does **not** pretend to execute code. Jobs are persisted as queue records until a real isolated executor is connected. Runtime URLs are saved as unverified, and no Claw token is stored by the app.

AI and mission data require a network connection. The mission credit budget is a planning control; it does not change actual subscription or gateway quota.

Image generation calls the agent gateway's `generate_image` tool from the server, downloads the result, and uploads it to platform object storage. Only the storage key is persisted (`sandboxJobs.output = "storage:<key>"`); short-lived presigned URLs are minted at render time. Every generation attempt and stored byte consumes the site owner's quota, and a failed attempt is never retried automatically — the failure is written to the job record and chat log instead.

ARCH7E3F keeps molecular CRISPR evidence separate from aggregate public-reaction analysis. It excludes mouse-derived core data, human experimentation, individual targeting, de-anonymization, manipulation, and causal claims linking molecular findings to complex social behavior.

## Requirements

- Node.js 22+
- MySQL-compatible database
- Kimi OAuth application credentials
- Kimi agent gateway credentials for AI chat and image generation
- Platform object storage resource (`KIMI_STORAGE_RESOURCE_ID`) for generated media

Copy the environment template and fill in your own values:

```bash
cp .env.example .env
```

Never commit `.env` or expose `KIMI_AGENTGW_API_KEY`, `KIMI_AGENTGW_BASE_URL`, `APP_SECRET`, or `DATABASE_URL` to browser code.

## Development

```bash
npm install
npm run db:push
npm run dev
```

The development server runs on port 3000. The PNG application icons are restored automatically during `npm install` from the Base64 text assets in `assets/`.

## Verification and production

```bash
npm run check
npm run build
npm start
```

The production server serves `dist/public` and the bundled `dist/boot.js` backend.

## Docker

```bash
docker build -t berta-arch7e3f .
docker run --env-file .env -p 3000:3000 berta-arch7e3f
```

## Install on iPhone

1. Open the deployed app in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Open Berta from the icon and sign in.

## Project map

- `src/` — mobile-first React interface
- `api/` — Hono/tRPC backend, authentication, AI provider, media generation, and queries
- `db/` — Drizzle schema and seed scaffold
- `contracts/` — shared types and constants
- `public/` — manifest, service worker, and generated icon destinations
- `assets/` — text-encoded source assets used by the icon restoration script

## License

No license has been selected yet. All rights remain with the repository owner until one is added.
