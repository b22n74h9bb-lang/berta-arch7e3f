import { desc, eq, sql } from "drizzle-orm";
import {
  CHARTER_HISTORY_LIMIT,
  type CharterHistoryItem,
  type CharterVersion,
} from "@contracts/charter";
import { charters } from "@db/schema";
import { log } from "../lib/logger";
import { getDb } from "./connection";
import { CharterStorageError } from "../charter/errors";
import { CHARTERS_TABLE_SQL } from "../charter/table-sql";

let chartersTableReady: Promise<void> | null = null;

function ensureChartersTable(): Promise<void> {
  if (!chartersTableReady) {
    chartersTableReady = getDb()
      .execute(sql.raw(CHARTERS_TABLE_SQL))
      .then(() => undefined)
      .catch(() => {
        chartersTableReady = null;
        log.error("charters table is unavailable");
        throw new CharterStorageError();
      });
  }
  return chartersTableReady;
}

function toVersion(row: {
  version: number;
  body: string;
  authorUserId: number;
  createdAt: Date;
  restoredFromVersion: number | null;
}): CharterVersion {
  return {
    version: row.version,
    body: row.body,
    authorUserId: Number(row.authorUserId),
    createdAt: row.createdAt,
    restoredFromVersion: row.restoredFromVersion,
  };
}

export async function latestCharter(): Promise<CharterVersion | null> {
  await ensureChartersTable();
  const rows = await getDb()
    .select()
    .from(charters)
    .orderBy(desc(charters.version))
    .limit(1);
  const row = rows.at(0);
  return row ? toVersion(row) : null;
}

export async function charterByVersion(version: number): Promise<CharterVersion | null> {
  await ensureChartersTable();
  const rows = await getDb()
    .select()
    .from(charters)
    .where(eq(charters.version, version))
    .limit(1);
  const row = rows.at(0);
  return row ? toVersion(row) : null;
}

export async function listCharterHistory(): Promise<CharterHistoryItem[]> {
  await ensureChartersTable();
  const rows = await getDb()
    .select({
      version: charters.version,
      createdAt: charters.createdAt,
      authorUserId: charters.authorUserId,
      restoredFromVersion: charters.restoredFromVersion,
      chars: sql<number>`char_length(${charters.body})`,
    })
    .from(charters)
    .orderBy(desc(charters.version))
    .limit(CHARTER_HISTORY_LIMIT);
  return rows.map((row) => ({
    version: row.version,
    createdAt: row.createdAt,
    authorUserId: Number(row.authorUserId),
    restoredFromVersion: row.restoredFromVersion,
    chars: Number(row.chars),
  }));
}

export async function insertCharterVersion(row: CharterVersion): Promise<void> {
  await ensureChartersTable();
  await getDb().insert(charters).values({
    version: row.version,
    body: row.body,
    authorUserId: row.authorUserId,
    restoredFromVersion: row.restoredFromVersion,
    createdAt: row.createdAt,
  });
}
