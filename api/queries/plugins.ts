import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  decidePlugin,
  parseStoredScopes,
  type PluginDecisionAction,
  type PluginManifest,
} from "@contracts/plugins";
import { log } from "../lib/logger";
import { issuePluginToken } from "../bridge/plugin-token";
import { getDb } from "./connection";

let pluginsReady: Promise<void> | null = null;

function ensurePluginTables(): Promise<void> {
  if (!pluginsReady) {
    pluginsReady = (async () => {
      const db = getDb();
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`plugins\` (
        \`id\` serial AUTO_INCREMENT NOT NULL,
        \`name\` varchar(120) NOT NULL,
        \`version\` varchar(64) NOT NULL,
        \`scopes\` text NOT NULL,
        \`status\` enum('pending','approved','revoked') NOT NULL DEFAULT 'pending',
        \`tokenGeneration\` int NOT NULL DEFAULT 1,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()),
        \`decidedAt\` timestamp NULL,
        CONSTRAINT \`plugins_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`plugins_name_version_idx\` UNIQUE(\`name\`,\`version\`)
      )`));
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`plugin_tokens\` (
        \`id\` serial AUTO_INCREMENT NOT NULL,
        \`pluginId\` bigint unsigned NOT NULL,
        \`tokenHash\` varchar(64) NOT NULL,
        \`generation\` int NOT NULL DEFAULT 1,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`revokedAt\` timestamp NULL,
        CONSTRAINT \`plugin_tokens_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`plugin_tokens_hash_idx\` UNIQUE(\`tokenHash\`),
        INDEX \`plugin_tokens_plugin_idx\` (\`pluginId\`)
      )`));
    })().catch((error: unknown) => {
      pluginsReady = null;
      log.error("plugin tables are unavailable");
      throw error;
    });
  }
  return pluginsReady;
}

export type PublicPlugin = {
  id: number;
  name: string;
  version: string;
  status: schema.Plugin["status"];
  kind: PluginManifest["kind"];
  surface: PluginManifest["surface"];
  isolation: "sandbox";
  scopes: string[];
  hooks: string[];
  config: Record<string, string>;
  manifestValid: boolean;
  tokenGeneration: number;
  createdAt: Date;
};

function present(row: schema.Plugin): PublicPlugin {
  const parsed = parseStoredScopes(row.name, row.version, row.scopes);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    kind: parsed.manifest.kind,
    surface: parsed.manifest.surface,
    isolation: "sandbox",
    scopes: parsed.manifest.scopes,
    hooks: parsed.manifest.hooks,
    config: parsed.manifest.config,
    manifestValid: parsed.valid,
    tokenGeneration: row.tokenGeneration,
    createdAt: row.createdAt,
  };
}

export async function listPlugins(): Promise<PublicPlugin[]> {
  await ensurePluginTables();
  const rows = await getDb().select().from(schema.plugins);
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(present);
}

export async function findPluginByName(name: string, version: string) {
  await ensurePluginTables();
  const rows = await getDb()
    .select()
    .from(schema.plugins)
    .where(and(eq(schema.plugins.name, name), eq(schema.plugins.version, version)))
    .limit(1);
  return rows.at(0);
}

export function isDuplicatePlugin(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY");
}

export async function insertPendingPlugin(input: { name: string; version: string; storedScopes: string }) {
  await ensurePluginTables();
  await getDb().insert(schema.plugins).values({
    name: input.name,
    version: input.version,
    scopes: input.storedScopes,
    status: "pending",
    tokenGeneration: 1,
  });
}

export async function applyPluginDecision(input: {
  id: number;
  action: PluginDecisionAction;
}): Promise<
  | { found: false }
  | { found: true; changed: boolean; status: schema.Plugin["status"]; token: string | null }
> {
  await ensurePluginTables();
  const db = getDb();
  const rows = await db.select().from(schema.plugins).where(eq(schema.plugins.id, input.id)).limit(1);
  const row = rows.at(0);
  if (!row) return { found: false };
  const decision = decidePlugin({
    action: input.action,
    status: row.status,
    tokenGeneration: row.tokenGeneration,
  });
  if (!decision.changed) return { found: true, changed: false, status: decision.status, token: null };

  await db
    .update(schema.plugins)
    .set({
      status: decision.status,
      tokenGeneration: decision.tokenGeneration,
      decidedAt: new Date(),
    })
    .where(eq(schema.plugins.id, row.id));

  await db
    .update(schema.pluginTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.pluginTokens.pluginId, row.id), isNull(schema.pluginTokens.revokedAt)));

  if (!decision.issueToken) return { found: true, changed: true, status: decision.status, token: null };
  const issued = issuePluginToken();
  await db.insert(schema.pluginTokens).values({
    pluginId: row.id,
    tokenHash: issued.tokenHash,
    generation: decision.tokenGeneration,
  });
  return { found: true, changed: true, status: decision.status, token: issued.token };
}

export async function findWechatPluginStatus(): Promise<schema.Plugin["status"] | "absent"> {
  await ensurePluginTables();
  const rows = await getDb()
    .select({ status: schema.plugins.status })
    .from(schema.plugins)
    .where(eq(schema.plugins.name, "wechat-official"));
  if (rows.length === 0) return "absent";
  if (rows.some((row) => row.status === "approved")) return "approved";
  if (rows.some((row) => row.status === "pending")) return "pending";
  return "revoked";
}
