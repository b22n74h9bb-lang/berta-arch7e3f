# Backup / restore drill — Berta

Non-production restore evidence for the 12 Nov 2026, 18:00 Asia/Shanghai checkpoint.
Ariel reviews. Cursor implements. No secrets in this file. Do not run against production.

## Goal

Show that core task / mission / chat rows remain usable after a backup → wipe → restore cycle when Slack and GitHub are disconnected.

## What is covered

| Artifact | Covered |
|----------|---------|
| Schema for all Drizzle tables (including `approvals`, `sandbox_jobs`, `members`) | Yes — applied via `db:push` |
| Sample rows verified after restore | `users`, `missions`, `tasks`, `chat_messages`, `approvals`, `sandbox_jobs`, `members` |
| Generated media in object storage | No — provider dependency; document only |
| Kimi / GitHub OAuth secrets | No — host `.env` only; never dump secrets |
| Production Bandwagon MySQL | Optional later — needs host access; this drill uses a throwaway MySQL |

## Non-production drill (required for the checkpoint)

Requirements: Docker, Node 22+, this repo checkout.

```bash
# From repo root. Uses a disposable MySQL on loopback only.
bash scripts/restore-drill.sh
```

The script:

1. Starts `berta-restore-drill-mysql` (MySQL 8) bound to `127.0.0.1` only.
2. Applies schema with `npm run db:push` against that instance.
3. Inserts labeled sample rows for `users`, `missions`, `tasks`, `chat_messages`, `approvals`, `sandbox_jobs`, and `members`.
4. Writes a logical dump to `/tmp/berta-restore-drill/before.sql` by default (`DRILL_ARTIFACT_DIR` overrides).
5. Drops and recreates the database.
6. Restores the dump.
7. Verifies row counts and the sample task title.
8. Prints `RESTORE_DRILL=PASS` or `FAIL` and tears the container down unless `KEEP_DRILL=1`.

Evidence to paste in `#seedgym` (no secrets): script exit code, `RESTORE_DRILL=PASS`, table counts, timestamp Asia/Shanghai.

## Production dump (optional, host-only)

Only when Bandwagon MySQL access is available. Never paste connection strings or dump contents into Slack.

```bash
# On the VPS, names only — fill credentials from host secret store.
mysqldump --single-transaction --routines --triggers \
  -h 127.0.0.1 -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  > "/root/berta-backup-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

Restore into a **non-production** database first. Confirm counts. Only then consider a production cutover under owner approval.

Pre-deploy tarball pattern already used on host (example name only):
`/root/berta-arch7e3f.bak-pre-pr4-*.tgz` — code tree backup, not a DB dump.

## Remaining provider dependencies (honest)

After a successful MySQL restore, these still need live credentials / network:

- Kimi agent gateway (`KIMI_AGENTGW_*`) for AI replies
- GitHub / Kimi OAuth for new sign-ins
- Object storage for image keys already stored as `storage:…`
- Slack Environment webhook for outbound notifications

The app remains the ledger for tasks, missions, chat text, approvals, and members without those providers.

## Review checklist (Ariel)

- [ ] Script run from a clean checkout against throwaway MySQL
- [ ] `RESTORE_DRILL=PASS` printed
- [ ] Sample task title present after restore
- [ ] No production host targeted
- [ ] No secrets in Slack evidence
