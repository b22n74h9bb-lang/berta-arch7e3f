import {
  bigint, boolean, index, int, mysqlEnum, mysqlTable, serial, text, timestamp,
  uniqueIndex, varchar,
} from "drizzle-orm/mysql-core";

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

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Mission = typeof missions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type SandboxJob = typeof sandboxJobs.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
