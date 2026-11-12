/** Keep identical to the statement in db/migrations/0001_charters.sql. */
export const CHARTERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS \`charters\` (
  \`id\` serial AUTO_INCREMENT NOT NULL,
  \`version\` int NOT NULL,
  \`body\` mediumtext NOT NULL,
  \`authorUserId\` bigint unsigned NOT NULL,
  \`restoredFromVersion\` int NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT \`charters_id\` PRIMARY KEY(\`id\`),
  CONSTRAINT \`charters_version_idx\` UNIQUE(\`version\`)
)`;
