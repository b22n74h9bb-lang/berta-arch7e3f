import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { InsertUser } from "@db/schema";
import { githubIdFromUnion, isOwnerGithubId } from "../github/membership";
import { getDb } from "./connection";
import { env } from "../lib/env";

function isOwnerUnion(unionId: string | undefined): boolean {
  if (!unionId) return false;
  if (env.ownerUnionId && unionId === env.ownerUnionId) return true;
  const githubId = githubIdFromUnion(unionId);
  return githubId !== null && isOwnerGithubId(githubId, env.ownerGithubId);
}

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

export async function upsertUser(data: InsertUser) {
  const values = { ...data };
  const updateSet: Partial<InsertUser> = { lastSignInAt: new Date(), ...data };
  if (values.role === undefined && isOwnerUnion(values.unionId)) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await getDb().insert(schema.users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function setUserRole(userId: number, role: "user" | "admin") {
  await getDb().update(schema.users).set({ role }).where(eq(schema.users.id, userId));
}
