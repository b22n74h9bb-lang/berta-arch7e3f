-- Owner charter versions. The highest version is the active system prompt.
-- Idempotent. Do not put charter text, memory, or secrets in this file.
--
-- Apply on the Bandwagon host after MySQL is up (preferred: npm run db:push
-- from a checkout whose DATABASE_URL reaches the database). Or pipe this file:
--
--   docker compose -f deploy/docker-compose.yml --env-file .env exec -T mysql \
--     sh -c 'mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
--     < db/migrations/0001_charters.sql

CREATE TABLE IF NOT EXISTS `charters` (
  `id` serial AUTO_INCREMENT NOT NULL,
  `version` int NOT NULL,
  `body` mediumtext NOT NULL,
  `authorUserId` bigint unsigned NOT NULL,
  `restoredFromVersion` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `charters_id` PRIMARY KEY(`id`),
  CONSTRAINT `charters_version_idx` UNIQUE(`version`)
)
