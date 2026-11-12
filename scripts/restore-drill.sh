#!/usr/bin/env bash
# Non-production MySQL backup → wipe → restore drill for Berta.
# Never point this at production. No secrets printed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONTAINER="${DRILL_CONTAINER:-berta-restore-drill-mysql}"
DRILL_PORT="${DRILL_PORT:-3307}"
DRILL_DB="${DRILL_DB:-berta_restore_drill}"
DRILL_USER="${DRILL_USER:-berta}"
DRILL_PASS="${DRILL_PASS:-berta_drill_only}"
ROOT_PASS="${DRILL_ROOT_PASS:-root_drill_only}"
ARTIFACT_DIR="${DRILL_ARTIFACT_DIR:-/tmp/berta-restore-drill}"
SAMPLE_TASK="RESTORE-DRILL-SAMPLE-TASK"

cleanup() {
  if [[ "${KEEP_DRILL:-0}" == "1" ]]; then
    echo "KEEP_DRILL=1 — leaving container ${CONTAINER} running on 127.0.0.1:${DRILL_PORT}"
    return
  fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! command -v docker >/dev/null; then
  echo "RESTORE_DRILL=FAIL reason=docker_missing"
  exit 1
fi
if ! command -v npm >/dev/null; then
  echo "RESTORE_DRILL=FAIL reason=npm_missing"
  exit 1
fi

mkdir -p "$ARTIFACT_DIR"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "Starting throwaway MySQL on 127.0.0.1:${DRILL_PORT}…"
docker run -d --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PASS" \
  -e MYSQL_DATABASE="$DRILL_DB" \
  -e MYSQL_USER="$DRILL_USER" \
  -e MYSQL_PASSWORD="$DRILL_PASS" \
  -p "127.0.0.1:${DRILL_PORT}:3306" \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci >/dev/null

echo "Waiting for MySQL…"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" mysqladmin ping -h 127.0.0.1 -uroot -p"$ROOT_PASS" --silent >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! docker exec "$CONTAINER" mysqladmin ping -h 127.0.0.1 -uroot -p"$ROOT_PASS" --silent >/dev/null 2>&1; then
  echo "RESTORE_DRILL=FAIL reason=mysql_not_ready"
  exit 1
fi

export DATABASE_URL="mysql://${DRILL_USER}:${DRILL_PASS}@127.0.0.1:${DRILL_PORT}/${DRILL_DB}"
# Satisfy drizzle / app env loaders without touching host secrets.
export APP_ID="${APP_ID:-restore-drill}"
export APP_SECRET="${APP_SECRET:-restore-drill-secret-not-for-prod}"
export KIMI_AUTH_URL="${KIMI_AUTH_URL:-https://auth.example}"
export KIMI_OPEN_URL="${KIMI_OPEN_URL:-https://open.example}"

if [[ ! -d node_modules ]]; then
  npm install --legacy-peer-deps >/dev/null
fi

echo "Applying schema…"
npm run db:push >/dev/null

echo "Inserting sample ledger rows…"
docker exec -i "$CONTAINER" mysql -u"$DRILL_USER" -p"$DRILL_PASS" "$DRILL_DB" <<SQL
INSERT INTO users (unionId, name, email, role, createdAt, updatedAt, lastSignInAt)
VALUES ('restore-drill:owner', 'Restore Drill', NULL, 'admin', NOW(), NOW(), NOW());
SET @uid := LAST_INSERT_ID();
INSERT INTO missions (userId, code, title, objective, status, rabbitMode, voiceReplies, creditBudget, runtimeStatus, createdAt, updatedAt)
VALUES (@uid, 'ARCH7E3F', 'Restore drill mission', 'Prove backup and restore for core ledger tables.', 'active', 1, 0, 5, 'unconfigured', NOW(), NOW());
INSERT INTO tasks (userId, title, category, status, progress, position, createdAt, updatedAt)
VALUES (@uid, '${SAMPLE_TASK}', 'Mission', 'todo', 0, 0, NOW(), NOW());
INSERT INTO chat_messages (userId, role, content, createdAt)
VALUES (@uid, 'system', 'restore-drill seed message', NOW());
INSERT INTO approvals (userId, title, detail, risk, status, createdAt)
VALUES (@uid, 'RESTORE-DRILL-APPROVAL', 'Sample approval for restore drill', 'low', 'pending', NOW());
INSERT INTO sandbox_jobs (userId, name, kind, status, progress, budgetCredits, executor, createdAt, updatedAt)
VALUES (@uid, 'RESTORE-DRILL-JOB', 'probe', 'queued', 0, 1, 'not-connected', NOW(), NOW());
INSERT INTO members (githubId, login, status, role, sessionGeneration, userId, createdAt, updatedAt)
VALUES ('0', 'restore-drill', 'pending', 'member', 1, @uid, NOW(), NOW());
SQL

BEFORE="${ARTIFACT_DIR}/before.sql"
echo "Dumping logical backup to ${BEFORE}…"
# Root dump avoids PROCESS/tablespace privilege gaps on the app user.
docker exec "$CONTAINER" mysqldump -uroot -p"$ROOT_PASS" \
  --single-transaction --routines --triggers --no-tablespaces \
  --set-gtid-purged=OFF "$DRILL_DB" > "$BEFORE"
# Strip password-on-CLI warnings from the dump file if any leaked to stdout.
if ! grep -q "CREATE TABLE" "$BEFORE"; then
  echo "RESTORE_DRILL=FAIL reason=empty_dump"
  exit 1
fi

echo "Wiping database…"
docker exec "$CONTAINER" mysql -uroot -p"$ROOT_PASS" -e "DROP DATABASE \`${DRILL_DB}\`; CREATE DATABASE \`${DRILL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON \`${DRILL_DB}\`.* TO '${DRILL_USER}'@'%'; FLUSH PRIVILEGES;" 2>/dev/null

echo "Restoring dump…"
docker exec -i "$CONTAINER" mysql -uroot -p"$ROOT_PASS" "$DRILL_DB" < "$BEFORE" 2>/dev/null

echo "Verifying…"
VERIFY_SQL=$(cat <<SQL
SELECT CONCAT(
  'users=', (SELECT COUNT(*) FROM users),
  ' missions=', (SELECT COUNT(*) FROM missions),
  ' tasks=', (SELECT COUNT(*) FROM tasks),
  ' chat_messages=', (SELECT COUNT(*) FROM chat_messages),
  ' approvals=', (SELECT COUNT(*) FROM approvals),
  ' sandbox_jobs=', (SELECT COUNT(*) FROM sandbox_jobs),
  ' members=', (SELECT COUNT(*) FROM members)
);
SELECT title FROM tasks WHERE title='${SAMPLE_TASK}' LIMIT 1;
SQL
)
VERIFY_OUT="$(docker exec -i "$CONTAINER" mysql -N -uroot -p"$ROOT_PASS" "$DRILL_DB" 2>/dev/null <<<"$VERIFY_SQL")"
COUNTS="$(printf '%s\n' "$VERIFY_OUT" | sed -n '1p')"
TASK="$(printf '%s\n' "$VERIFY_OUT" | sed -n '2p')"

echo "counts: ${COUNTS}"
echo "sample_task: ${TASK:-MISSING}"

if [[ "$TASK" == "$SAMPLE_TASK" ]] \
  && [[ "$COUNTS" == *"users=1"* ]] \
  && [[ "$COUNTS" == *"missions=1"* ]] \
  && [[ "$COUNTS" == *"tasks=1"* ]] \
  && [[ "$COUNTS" == *"chat_messages=1"* ]] \
  && [[ "$COUNTS" == *"approvals=1"* ]] \
  && [[ "$COUNTS" == *"sandbox_jobs=1"* ]] \
  && [[ "$COUNTS" == *"members=1"* ]]; then
  echo "RESTORE_DRILL=PASS"
  echo "artifact=${BEFORE}"
  echo "note=throwaway_mysql_only_not_production"
  exit 0
fi

echo "RESTORE_DRILL=FAIL reason=verification"
exit 1
