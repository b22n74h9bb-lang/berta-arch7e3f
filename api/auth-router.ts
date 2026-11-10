import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "./lib/env";
import { clearedSessionCookie } from "./lib/cookies";
import { adminQuery, authedQuery, createRouter } from "./middleware";
import type { SessionUser } from "./kimi/auth";
import { applyMemberDecision, findMemberByGithubId, listMembers } from "./queries/members";
import { setUserRole } from "./queries/users";
import { reviewDecision, type MembershipView } from "./github/membership";

function membershipOf(user: SessionUser): Omit<MembershipView, "sessionGeneration"> {
  if (user.membership) {
    return {
      status: user.membership.status,
      role: user.membership.role,
      login: user.membership.login,
      githubId: user.membership.githubId,
    };
  }
  return {
    status: "approved",
    role: user.role === "admin" ? "admin" : "member",
    login: user.name ?? "",
    githubId: "",
  };
}

function presentUser(user: SessionUser) {
  return { ...user, membership: membershipOf(user) };
}

function assertOwner(user: SessionUser) {
  if (!env.ownerGithubId) return;
  if (user.membership?.githubId !== env.ownerGithubId || user.membership.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can review members." });
  }
}

const decisionInput = z.object({
  githubId: z.string().regex(/^\d{1,20}$/),
  action: z.enum(["approve", "reject", "revoke"]),
});

export const authRouter = createRouter({
  me: authedQuery.query(({ ctx }) => presentUser(ctx.user)),
  logout: authedQuery.mutation(({ ctx }) => {
    ctx.resHeaders.append("set-cookie", clearedSessionCookie(ctx.req.headers));
    return { success: true };
  }),
  listMembers: adminQuery.query(async ({ ctx }) => {
    assertOwner(ctx.user);
    return listMembers();
  }),
  decideMember: adminQuery.input(decisionInput).mutation(async ({ ctx, input }) => {
    assertOwner(ctx.user);
    const target = await findMemberByGithubId(input.githubId);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That sign-in request was not found." });
    }
    const decision = reviewDecision({
      action: input.action,
      targetGithubId: target.githubId,
      ownerGithubId: env.ownerGithubId,
      target: {
        status: target.status,
        role: target.role,
        sessionGeneration: target.sessionGeneration,
      },
    });
    if (!decision.ok) {
      throw new TRPCError({ code: "FORBIDDEN", message: "The owner account cannot be changed here." });
    }
    await applyMemberDecision(target.githubId, decision.next);
    if (target.userId) await setUserRole(target.userId, "user");
    return { ok: true as const, status: decision.next.status };
  }),
});
