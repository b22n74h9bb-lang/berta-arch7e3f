import { and, asc, desc, eq } from "drizzle-orm";
import { approvals, chatMessages, missions, sandboxJobs, tasks } from "@db/schema";
import { getDb } from "./connection";

const DEFAULT_OBJECTIVE =
  "Build a reproducible Human CRISPR Atlas from lawful public human-derived datasets, alongside a separate aggregate study of public reactions to CRISPR. No mouse-derived core data, human experimentation, individual targeting, or causal claims linking molecular findings to social behaviour.";

export async function ensureMission(userId: number) {
  const db = getDb();
  const existing = await db.query.missions.findFirst({ where: eq(missions.userId, userId) });
  if (existing) return existing;
  await db.insert(missions).values({
    userId,
    title: "Human CRISPR Atlas + Public Reaction",
    objective: DEFAULT_OBJECTIVE,
  });
  await db.insert(tasks).values([
    {
      userId,
      title: "Inventory accessible Claw data and mission artifacts",
      category: "01 · Provenance",
      status: "active",
      progress: 20,
      position: 1,
    },
    {
      userId,
      title: "Catalogue public human datasets with licences",
      category: "02 · Atlas",
      position: 2,
    },
    {
      userId,
      title: "Define aggregate social-listening analysis plan",
      category: "03 · Discourse",
      position: 3,
    },
    {
      userId,
      title: "Verify bioRxiv scope before manuscript preparation",
      category: "04 · Publication",
      position: 4,
    },
  ]);
  await db.insert(approvals).values({
    userId,
    title: "Approve the first dataset-manifest review",
    detail:
      "Bounded, read-only review of public dataset metadata. No large downloads, restricted data, external contact, or submission.",
    risk: "low",
  });
  await db.insert(chatMessages).values({
    userId,
    role: "assistant",
    content:
      "Berta online. ARCH7E3F is initialized with bounded autonomy and Rabbit mode. I’ll keep molecular evidence separate from social-media evidence, work within your resource limits, and ask before high-impact actions. What should we inspect first?",
  });
  const created = await db.query.missions.findFirst({ where: eq(missions.userId, userId) });
  if (!created) throw new Error("Mission initialization failed");
  return created;
}

export async function getMissionState(userId: number) {
  const db = getDb();
  const mission = await ensureMission(userId);
  const [taskRows, jobRows, approvalRows, messageRows] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.position), asc(tasks.id)),
    db.select().from(sandboxJobs).where(eq(sandboxJobs.userId, userId))
      .orderBy(desc(sandboxJobs.createdAt)).limit(50),
    db.select().from(approvals).where(eq(approvals.userId, userId))
      .orderBy(desc(approvals.createdAt)).limit(30),
    db.select().from(chatMessages).where(eq(chatMessages.userId, userId))
      .orderBy(asc(chatMessages.createdAt)).limit(100),
  ]);
  return { mission, tasks: taskRows, jobs: jobRows, approvals: approvalRows, messages: messageRows };
}

export async function ownedTask(userId: number, id: number) {
  return getDb().query.tasks.findFirst({
    where: and(eq(tasks.id, id), eq(tasks.userId, userId)),
  });
}

export async function ownedJob(userId: number, id: number) {
  return getDb().query.sandboxJobs.findFirst({
    where: and(eq(sandboxJobs.id, id), eq(sandboxJobs.userId, userId)),
  });
}

export async function ownedApproval(userId: number, id: number) {
  return getDb().query.approvals.findFirst({
    where: and(eq(approvals.id, id), eq(approvals.userId, userId)),
  });
}
