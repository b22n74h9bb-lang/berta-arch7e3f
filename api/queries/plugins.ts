import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { log } from "../lib/logger";
import { getDb } from "./connection";
import {
  hashPluginToken,
  mintPluginToken,
  parsePluginScopes,
  reviewPluginDecision,
  serializePluginScopes,
  type PluginDecision,
  type PluginStatus,
} from "../bridge/plugins";
import type { PluginAction } from "../bridge/security";

let pluginsTablesReady: Promise<void> | null = null;

function ensurePluginTables(): Promise<void> {
  if (!pluginsTablesReady) {
    pluginsTablesReady = (async () => {
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
        CONSTRAINT \`plugins_name_version_idx\` UNIQUE(\`name\`, \`version\`)
      )`));
      await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`plugin_tokens\` (
        \`id\` serial AUTO_INCREMENT NOT NULL,
        \`pluginId\` bigint unsigned NOT NULL,
        \`tokenHash\` varchar(64) NOT NULL,
        \`generation\` int NOT NULL DEFAULT 1,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`revokedAt\` timestamp NULL,
        CONSTRAINT \`plugin_tokens_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`plugin_tokens_hash_idx\` UNIQUE(\`tokenHash\`)
      )`));
    })()
      .then(() => undefined)
      .catch((error: unknown) => {
        pluginsTablesReady = null;
        log.error("plugin tables are unavailable");
        throw error;
      });
  }
  return pluginsTablesReady;
}

export async function listPlugins() {
  await ensurePluginTables();
  const rows = await getDb().select().from(schema.plugins);
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      scopes: parsePluginScopes(row.scopes),
      status: row.status as PluginStatus,
      tokenGeneration: row.tokenGeneration,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    }));
}

export async function findPluginById(id: number) {
  await ensurePluginTables();
  const rows = await getDb()
    .select()
    .from(schema.plugins)
    .where(eq(schema.plugins.id, id))
    .limit(1);
  return rows.at(0);
}

export async function registerPlugin(input: {
  name: string;
  version: string;
  scopes: readonly PluginAction[];
}) {
  await ensurePluginTables();
  const name = input.name.trim().slice(0, 120);
  const version = input.version.trim().slice(0, 64);
  if (!name || !version) {
    throw new Error("Plugin name and version are required.");
  }
  const scopes = serializePluginScopes(input.scopes);
  if (!scopes) {
    throw new Error("At least one explicit plugin action scope is required.");
  }
  const [inserted] = await getDb()
    .insert(schema.plugins)
    .values({
      name,
      version,
      scopes,
      status: "pending",
      tokenGeneration: 1,
    })
    .$returningId();
  const saved = await findPluginById(inserted.id);
  if (!saved) throw new Error("Plugin record was not stored.");
  return {
    id: saved.id,
    name: saved.name,
    version: saved.version,
    scopes: parsePluginScopes(saved.scopes),
    status: saved.status as PluginStatus,
  };
}

export async function applyPluginDecision(input: {
  pluginId: number;
  action: PluginDecision;
}): Promise<
  | { ok: true; status: PluginStatus; token: string | null }
  | { ok: false; reason: "not_found" | "already_revoked" | "already_approved" }
> {
  await ensurePluginTables();
  const existing = await findPluginById(input.pluginId);
  if (!existing) return { ok: false, reason: "not_found" };

  const decision = reviewPluginDecision({
    action: input.action,
    status: existing.status as PluginStatus,
    tokenGeneration: existing.tokenGeneration,
  });
  if (!decision.ok) return decision;

  let token: string | null = null;
  if (input.action === "approve") {
    const minted = mintPluginToken();
    token = minted.token;
    await getDb().insert(schema.pluginTokens).values({
      pluginId: existing.id,
      tokenHash: minted.tokenHash,
      generation: decision.next.tokenGeneration,
    });
  } else {
    await getDb()
      .update(schema.pluginTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.pluginTokens.pluginId, existing.id));
  }

  await getDb()
    .update(schema.plugins)
    .set({
      status: decision.next.status,
      tokenGeneration: decision.next.tokenGeneration,
      decidedAt: new Date(),
    })
    .where(eq(schema.plugins.id, existing.id));

  return { ok: true, status: decision.next.status, token };
}

export async function findPluginByToken(token: string) {
  await ensurePluginTables();
  const tokenHash = hashPluginToken(token);
  const rows = await getDb()
    .select({
      plugin: schema.plugins,
      tokenRow: schema.pluginTokens,
    })
    .from(schema.pluginTokens)
    .innerJoin(schema.plugins, eq(schema.pluginTokens.pluginId, schema.plugins.id))
    .where(eq(schema.pluginTokens.tokenHash, tokenHash))
    .limit(1);
  const hit = rows.at(0);
  if (!hit) return null;
  if (hit.tokenRow.revokedAt) return null;
  if (hit.tokenRow.generation !== hit.plugin.tokenGeneration) return null;
  return hit.plugin;
}
