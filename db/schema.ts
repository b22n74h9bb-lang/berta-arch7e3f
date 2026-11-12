import {
  bigint, boolean, index, int, mediumtext, mysqlEnum, mysqlTable, serial, text, timestamp,
  uniqueIndex, varchar,
} from "drizzle-orm/mysql-core";

export const members = mysqlTable(
  "members",
  {
    id: serial("id").primaryKey(),
    githubId: varchar("githubId", { length: 32 }).notNull(),
    login: varchar("login", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["pending", "approved", "rejected", "revoked"])
      .notNull()
      .default("pending"),
    role: mysqlEnum("role", ["admin", "member"]).notNull().default("member"),
    sessionGeneration: int("sessionGeneration").notNull().default(1),
    userId: bigint("userId", { mode: "number", unsigned: true }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
    decidedAt: timestamp("decidedAt"),
  },
  (table) => ({ githubIdx: uniqueIndex("members_github_idx").on(table.githubId) }),
);

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export const missions = mysqlTable(
  "missions",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    code: varchar("code", { length: 32 }).notNull().default("ARCH7E3F"),
    title: varchar("title", { length: 255 }).notNull(),
    objective: text("objective").notNull(),
    status: mysqlEnum("status", ["active", "paused"]).notNull().default("active"),
    rabbitMode: boolean("rabbitMode").notNull().default(true),
    voiceReplies: boolean("voiceReplies").notNull().default(false),
    creditBudget: int("creditBudget").notNull().default(25),
    runtimeUrl: varchar("runtimeUrl", { length: 2048 }),
    runtimeStatus: mysqlEnum("runtimeStatus", ["unconfigured", "unverified"])
      .notNull().default("unconfigured"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({ userIdx: uniqueIndex("missions_user_idx").on(table.userId) }),
);

export const tasks = mysqlTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    category: varchar("category", { length: 80 }).notNull().default("Mission"),
    status: mysqlEnum("status", ["todo", "active", "done", "blocked"])
      .notNull().default("todo"),
    progress: int("progress").notNull().default(0),
    position: int("position").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({ userIdx: index("tasks_user_idx").on(table.userId) }),
);

export const sandboxJobs = mysqlTable(
  "sandbox_jobs",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 80 }).notNull(),
    status: mysqlEnum("status", [
      "queued", "running", "paused", "completed", "failed", "cancelled",
    ]).notNull().default("queued"),
    progress: int("progress").notNull().default(0),
    budgetCredits: int("budgetCredits").notNull().default(1),
    executor: varchar("executor", { length: 80 }).notNull().default("not-connected"),
    output: text("output"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({ userIdx: index("sandbox_jobs_user_idx").on(table.userId) }),
);

export const approvals = mysqlTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    detail: text("detail").notNull(),
    risk: mysqlEnum("risk", ["low", "medium", "high"]).notNull().default("low"),
    status: mysqlEnum("status", ["pending", "approved", "rejected"])
      .notNull().default("pending"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    resolvedAt: timestamp("resolvedAt"),
  },
  (table) => ({ userIdx: index("approvals_user_idx").on(table.userId) }),
);

/** Append-only persona charter. The highest version is active. */
export const charters = mysqlTable(
  "charters",
  {
    id: serial("id").primaryKey(),
    version: int("version").notNull(),
    body: mediumtext("body").notNull(),
    authorUserId: bigint("authorUserId", { mode: "number", unsigned: true }).notNull(),
    restoredFromVersion: int("restoredFromVersion"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({ versionIdx: uniqueIndex("charters_version_idx").on(table.version) }),
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({ userIdx: index("chat_messages_user_idx").on(table.userId) }),
);

/** Append-only bridge ledger. Raw webhook bodies are not stored — only hashes and refs. */
export const bridgeEvents = mysqlTable(
  "bridge_events",
  {
    id: serial("id").primaryKey(),
    source: mysqlEnum("source", ["github"]).notNull().default("github"),
    type: varchar("type", { length: 120 }).notNull(),
    deliveryId: varchar("deliveryId", { length: 120 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    actorLogin: varchar("actorLogin", { length: 255 }),
    repo: varchar("repo", { length: 255 }),
    ref: varchar("ref", { length: 255 }),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  },
  (table) => ({
    deliveryHashIdx: uniqueIndex("bridge_events_delivery_hash_idx").on(
      table.deliveryId,
      table.payloadHash,
    ),
    sourceTypeIdx: index("bridge_events_source_type_idx").on(table.source, table.type),
  }),
);

export const missionRecords = mysqlTable(
  "mission_records",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 80 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    actorLogin: varchar("actorLogin", { length: 255 }),
    repo: varchar("repo", { length: 255 }),
    ref: varchar("ref", { length: 255 }),
    state: mysqlEnum("state", ["open", "in_review", "approved", "closed"])
      .notNull()
      .default("open"),
    sourceEventId: bigint("sourceEventId", { mode: "number", unsigned: true }),
    decidedBy: varchar("decidedBy", { length: 255 }),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    stateIdx: index("mission_records_state_idx").on(table.state),
    repoRefIdx: index("mission_records_repo_ref_idx").on(table.repo, table.ref),
  }),
);

export const plugins = mysqlTable(
  "plugins",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    version: varchar("version", { length: 64 }).notNull(),
    scopes: text("scopes").notNull(),
    status: mysqlEnum("status", ["pending", "approved", "revoked"])
      .notNull()
      .default("pending"),
    tokenGeneration: int("tokenGeneration").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
    decidedAt: timestamp("decidedAt"),
  },
  (table) => ({
    nameVersionIdx: uniqueIndex("plugins_name_version_idx").on(table.name, table.version),
  }),
);

export const pluginTokens = mysqlTable(
  "plugin_tokens",
  {
    id: serial("id").primaryKey(),
    pluginId: bigint("pluginId", { mode: "number", unsigned: true }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
    generation: int("generation").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    revokedAt: timestamp("revokedAt"),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("plugin_tokens_hash_idx").on(table.tokenHash),
    pluginIdx: index("plugin_tokens_plugin_idx").on(table.pluginId),
  }),
);

export type Member = typeof members.$inferSelect;
export type InsertMember = typeof members.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Mission = typeof missions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type SandboxJob = typeof sandboxJobs.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Charter = typeof charters.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type BridgeEvent = typeof bridgeEvents.$inferSelect;
export type MissionRecord = typeof missionRecords.$inferSelect;
export type Plugin = typeof plugins.$inferSelect;
export type PluginToken = typeof pluginTokens.$inferSelect;
