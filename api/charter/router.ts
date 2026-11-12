import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CHARTER_MAX_CHARS,
  isDuplicateCharterVersion,
  planCharterRollback,
  planCharterSave,
  type CharterVersion,
  type CharterWritePlan,
} from "@contracts/charter";
import { CharterStorageError } from "./errors";
import { log } from "../lib/logger";
import { createRouter, ownerCharterQuery } from "../middleware";
import { charterByVersion, insertCharterVersion, latestCharter, listCharterHistory } from "../queries/charter";

const charterBodyInput = z.object({
  body: z.string().max(CHARTER_MAX_CHARS * 2, "Charter text is too long."),
});

function present(row: CharterVersion, unchanged: boolean) {
  return {
    unchanged,
    version: row.version,
    body: row.body,
    createdAt: row.createdAt,
    authorUserId: row.authorUserId,
    restoredFromVersion: row.restoredFromVersion,
  };
}

function rejectPlan(plan: Exclude<CharterWritePlan, { action: "insert" | "unchanged" }>): never {
  if (plan.action === "missing") {
    throw new TRPCError({ code: "NOT_FOUND", message: "That charter version does not exist." });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: plan.reason === "empty"
      ? "Charter text is empty."
      : "Charter text must be 40,000 characters or fewer.",
  });
}

async function commitCharter(
  planFromLatest: (latest: CharterVersion | null) => CharterWritePlan | Promise<CharterWritePlan>,
) {
  let stored: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let latest: CharterVersion | null;
    let plan: CharterWritePlan;
    try {
      latest = await latestCharter();
      plan = await planFromLatest(latest);
    } catch (error) {
      throw storageFailure(error, "The charter could not be loaded.");
    }
    if (plan.action === "invalid" || plan.action === "missing") rejectPlan(plan);
    if (plan.action === "unchanged") return present(plan.active, true);
    try {
      await insertCharterVersion(plan.row);
      return present(plan.row, false);
    } catch (error) {
      stored = error;
      if (!isDuplicateCharterVersion(error) || attempt === 1) break;
    }
  }
  throw storageFailure(stored, "The charter could not be saved.");
}

function storageFailure(error: unknown, fallback: string): TRPCError {
  log.error("charter storage failed");
  if (error instanceof CharterStorageError) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: fallback });
}

export const charterRouter = createRouter({
  state: ownerCharterQuery.query(async () => {
    try {
      const [active, history] = await Promise.all([latestCharter(), listCharterHistory()]);
      return { active, history };
    } catch (error) {
      throw storageFailure(error, "The charter could not be loaded.");
    }
  }),

  version: ownerCharterQuery
    .input(z.object({ version: z.number().int().positive().max(1_000_000) }))
    .query(async ({ input }) => {
      try {
        const row = await charterByVersion(input.version);
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That charter version does not exist." });
        }
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw storageFailure(error, "The charter could not be loaded.");
      }
    }),

  save: ownerCharterQuery.input(charterBodyInput).mutation(async ({ ctx, input }) => {
    const authorUserId = ctx.user.id;
    return commitCharter((latest) => planCharterSave(latest, {
      body: input.body,
      authorUserId,
      now: new Date(),
    }));
  }),

  rollback: ownerCharterQuery
    .input(z.object({ version: z.number().int().positive().max(1_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const authorUserId = ctx.user.id;
      return commitCharter(async (latest) => {
        const target = await charterByVersion(input.version);
        return planCharterRollback(latest, target, { authorUserId, now: new Date() });
      });
    }),
});
