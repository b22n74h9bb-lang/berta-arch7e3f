import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@db/schema";
import { env } from "../lib/env";

let pool: mysql.Pool | undefined;
type Database = MySql2Database<typeof schema> & { $client: mysql.Pool };
let db: Database | undefined;

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
