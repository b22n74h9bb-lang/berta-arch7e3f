# MISSION — ARCH7E3F program (v1)

Canonical purpose reference for this repository and the surrounding Seedgym / ARCH7E3F team.
Source: Berta mission brief, owner-approved direction, 2026-11-08.
Disagreements resolve upward: Berta, then owner.

## Who we are

Owner-led micro-program. Owner = final authority on everything.

Team:

- **Berta** — coordinator / team lead, owner-bound
- **Ariel** — research + publishing ops
- **Cursor** — build agent (investigate and ship fixes into the repo)
- **Perplexity Computer** — analysis
- **GitHub Copilot** — repo assistant in Slack (when authorized)

## What we are building — four layers

1. **Berta, the app** (this repo) — a mobile-first PWA, the owner's personal operator console: AI chat, missions, tasks, voice, sandbox jobs. Near-term goal: deployed on HTTPS, signed in via Kimi, installed on the owner's iPhone. Repo: `b22n74h9bb-lang/berta-arch7e3f`.
2. **Seedgym, the public front** — YouTube / X channel publishing daily. Purpose: audience + proof of operation. It funds attention, not directly money.
3. **千里 (Qianli), the venture** — the media / business layer being built on the family's channels, on top of the first two layers.
4. **ARCH7E3F-lab, the research layer** — private, Origin-hosted. Long-horizon research program. Not in GitHub, not in Slack beyond program notes.

When in doubt, ask: does this serve layer 1–4, or is it noise?

## Operating rules

- **Propose, don't ratify:** anyone proposes; Berta ratifies, on the owner's word. No self-approved "approved workstreams".
- **Secrets never in Slack or repos:** tokens / keys live in environment stores only. Document **names**, never values.
- **Deploy first, features after:** current phase is the PWA on the owner's phone. The three task-handling gaps are the post-deploy spec, not today's work:
  1. Chat read-only task state
  2. Sandbox worker (real isolated executor)
  3. Shared assignment model
- **Verified vs assumption:** label them. If a source is unreachable, name the gap — don't guess.
- **Public channels get public-level data only.** Private owner data stays owner-side.

## Research exclusions (unchanged)

ARCH7E3F research (layer 4) keeps molecular CRISPR evidence separate from aggregate public-reaction analysis. Excluded: mouse-derived core data, human experimentation, individual targeting, de-anonymization, manipulation, and causal claims linking molecular findings to complex social behavior.

## Near-term success bar (layer 1)

1. `https://app.bertapp.life` (or the owner-chosen HTTPS URL) loads
2. Kimi sign-in works
3. Save a task
4. iPhone Safari → Share → Add to Home Screen

See `HANDOVER.md` for env names, bring-up, webhooks, and known issues.
