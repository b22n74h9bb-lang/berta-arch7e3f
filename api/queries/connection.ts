import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@db/schema";
import { env } from "../lib/env";

let pool: mysql.Pool | undefined;
type Database = MySql2Database<typeof schema> & { $client: mysql.Pool };
let db: Database | undefined;

export async function pingDb(): Promise<boolean> {
  if (!env.databaseUrl) return false;
  const connection = await mysql.createConnection({ uri: env.databaseUrl, connectTimeout: 2000 });
  try {
    await connection.query("SELECT 1");
    return true;
  } finally {
    await connection.end();
  }
}

export function getDb() {
  if (!db) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      supportBigNumbers: true,
      bigNumberStrings: false,
      connectionLimit: 5,
    });
    db = drizzle(pool, { schema, mode: "default" });
  }
  return db;
}
