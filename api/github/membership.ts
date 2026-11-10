import { timingSafeEqual } from "node:crypto";

export const MEMBER_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type MemberRole = "admin" | "member";
export type ReviewAction = "approve" | "reject" | "revoke";

export type MemberSnapshot = {
  status: MemberStatus;
  role: MemberRole;
  sessionGeneration: number;
};

export type MembershipView = MemberSnapshot & {
  login: string;
  githubId: string;
};

export function githubUnionId(githubId: string): string {
  return `github:${githubId}`;
}

export function githubIdFromUnion(unionId: string): string | null {
  if (!unionId.startsWith("github:")) return null;
  const id = unionId.slice("github:".length);
  return /^\d{1,20}$/.test(id) ? id : null;
}

export function isOwnerGithubId(githubId: string, ownerGithubId: string): boolean {
  return ownerGithubId.length > 0 && githubId === ownerGithubId;
}

export function membershipForSignIn(input: {
  githubId: string;
  ownerGithubId: string;
  existing: MemberSnapshot | null;
}): MemberSnapshot {
  if (isOwnerGithubId(input.githubId, input.ownerGithubId)) {
    return {
      status: "approved",
      role: "admin",
      sessionGeneration: input.existing?.sessionGeneration ?? 1,
    };
  }
  if (input.existing) {
    return {
      status: input.existing.status,
      role: "member",
      sessionGeneration: input.existing.sessionGeneration,
    };
  }
  return { status: "pending", role: "member", sessionGeneration: 1 };
}

export type SessionAccess = "approved" | "pending" | "denied" | "stale";

export function sessionAccess(input: {
  tokenGeneration: number | undefined;
  member: MemberSnapshot;
}): SessionAccess {
  const tokenGeneration = input.tokenGeneration ?? 1;
  if (!Number.isInteger(tokenGeneration) || tokenGeneration !== input.member.sessionGeneration) {
    return "stale";
  }
  if (input.member.status === "approved") return "approved";
  if (input.member.status === "pending") return "pending";
  return "denied";
}

export function reviewDecision(input: {
  action: ReviewAction;
  targetGithubId: string;
  target: MemberSnapshot;
  ownerGithubId: string;
}): { ok: true; next: MemberSnapshot } | { ok: false; reason: "owner" } {
  if (isOwnerGithubId(input.targetGithubId, input.ownerGithubId)) {
    return { ok: false, reason: "owner" };
  }
  if (input.action === "approve") {
    return {
      ok: true,
      next: {
        status: "approved",
        role: "member",
        sessionGeneration: input.target.sessionGeneration,
      },
    };
  }
  return {
    ok: true,
    next: {
      status: input.action === "reject" ? "rejected" : "revoked",
      role: "member",
      sessionGeneration: input.target.sessionGeneration + 1,
    },
  };
}

export function oauthStatesMatch(queryState: string | undefined, cookieState: string | undefined): boolean {
  if (!queryState || !cookieState) return false;
  if (!queryState.startsWith("gh:") || queryState.length < 8 || queryState.length > 200) return false;
  const left = Buffer.from(queryState);
  const right = Buffer.from(cookieState);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
