import { eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { log } from "../lib/logger";
import { getDb } from "./connection";
import {
  NEW_MEMBER_SNAPSHOT,
  signInIdentityPatch,
  type MemberSnapshot,
  type MemberStatus,
} from "../github/membership";

const STATUS_RANK: Record<MemberStatus, number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
  revoked: 3,
};

let membersTableReady: Promise<void> | null = null;

function ensureMembersTable(): Promise<void> {
  if (!membersTableReady) {
    membersTableReady = getDb()
      .execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`members\` (
        \`id\` serial AUTO_INCREMENT NOT NULL,
        \`githubId\` varchar(32) NOT NULL,
        \`login\` varchar(255) NOT NULL,
        \`status\` enum('pending','approved','rejected','revoked') NOT NULL DEFAULT 'pending',
        \`role\` enum('admin','member') NOT NULL DEFAULT 'member',
        \`sessionGeneration\` int NOT NULL DEFAULT 1,
        \`userId\` bigint unsigned,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()),
        \`decidedAt\` timestamp NULL,
        CONSTRAINT \`members_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`members_github_idx\` UNIQUE(\`githubId\`)
      )`))
      .then(() => undefined)
      .catch((error: unknown) => {
        membersTableReady = null;
        log.error("members table is unavailable");
        throw error;
      });
  }
  return membersTableReady;
}

export async function findMemberByGithubId(githubId: string) {
  await ensureMembersTable();
  const rows = await getDb()
    .select()
    .from(schema.members)
    .where(eq(schema.members.githubId, githubId))
    .limit(1);
  return rows.at(0);
}

async function insertMember(input: {
  githubId: string;
  login: string;
  userId: number;
  next: MemberSnapshot;
}) {
  await getDb().insert(schema.members).values({
    githubId: input.githubId,
    login: input.login,
    status: input.next.status,
    role: input.next.role,
    sessionGeneration: input.next.sessionGeneration,
    userId: input.userId,
    decidedAt: input.next.status === "approved" ? new Date() : null,
  });
}

export async function touchMemberIdentity(input: {
  githubId: string;
  login: string;
  userId: number;
}) {
  const login = input.login.trim().slice(0, 255) || `id-${input.githubId}`;
  const existing = await findMemberByGithubId(input.githubId);
  if (!existing) {
    try {
      await insertMember({
        githubId: input.githubId,
        login,
        userId: input.userId,
        next: NEW_MEMBER_SNAPSHOT,
      });
    } catch {
      // A concurrent sign-in may have inserted the same github id.
    }
  } else {
    const patch = signInIdentityPatch({ login, userId: input.userId });
    if (existing.login !== patch.login || existing.userId !== patch.userId) {
      await getDb()
        .update(schema.members)
        .set(patch)
        .where(eq(schema.members.githubId, input.githubId));
    }
  }
  const saved = await findMemberByGithubId(input.githubId);
  if (!saved) throw new Error("Member record was not stored.");
  return saved;
}

export async function listMembers() {
  await ensureMembersTable();
  const rows = await getDb().select().from(schema.members);
  return rows
    .slice()
    .sort((a, b) => {
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (byStatus !== 0) return byStatus;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .map((row) => ({
      githubId: row.githubId,
      login: row.login,
      status: row.status,
      role: row.role,
      createdAt: row.createdAt,
    }));
}

export async function applyMemberDecision(githubId: string, next: MemberSnapshot) {
  await ensureMembersTable();
  await getDb()
    .update(schema.members)
    .set({
      status: next.status,
      role: next.role,
      sessionGeneration: next.sessionGeneration,
      decidedAt: new Date(),
    })
    .where(eq(schema.members.githubId, githubId));
}
