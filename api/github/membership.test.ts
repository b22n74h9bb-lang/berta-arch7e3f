import { describe, expect, it } from "vitest";
import {
  githubIdFromUnion,
  isVerifiedOwner,
  mayAccessProtectedData,
  NEW_MEMBER_SNAPSHOT,
  oauthStatesMatch,
  presentedMembership,
  reviewDecision,
  sessionAccess,
  signInIdentityPatch,
} from "./membership";

const pending = { status: "pending" as const, role: "member" as const, sessionGeneration: 1 };

describe("sign-in identity", () => {
  it("opens a missing account as pending, including the owner id", () => {
    expect(NEW_MEMBER_SNAPSHOT).toEqual({
      status: "pending",
      role: "member",
      sessionGeneration: 1,
    });
  });

  it("patches login and user id only", () => {
    expect(Object.keys(signInIdentityPatch({ login: "ada", userId: 9 })).sort()).toEqual([
      "login",
      "userId",
    ]);
  });

  it("cannot resurrect a revoke that landed while sign-in was in flight", () => {
    const read = { status: "approved" as const, role: "member" as const, sessionGeneration: 2 };
    const decision = reviewDecision({
      action: "revoke",
      targetGithubId: "42",
      ownerGithubId: "7",
      target: read,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    const patch = signInIdentityPatch({ login: "ada", userId: 9 });
    const stored = { ...decision.next, login: patch.login, userId: patch.userId };
    expect(stored.status).toBe("revoked");
    expect(stored.role).toBe("member");
    expect(stored.sessionGeneration).toBe(3);
    expect(mayAccessProtectedData({ verifiedOwner: false, membership: stored })).toBe(false);
    expect(sessionAccess({ tokenGeneration: read.sessionGeneration, member: stored })).toBe("stale");
    expect(sessionAccess({ tokenGeneration: stored.sessionGeneration, member: stored })).toBe("denied");
  });
});

describe("protected access", () => {
  it("fails closed unless the caller is approved or the verified owner", () => {
    expect(mayAccessProtectedData({ verifiedOwner: false, membership: undefined })).toBe(false);
    expect(mayAccessProtectedData({ verifiedOwner: false, membership: null })).toBe(false);
    expect(mayAccessProtectedData({ verifiedOwner: false, membership: pending })).toBe(false);
    expect(mayAccessProtectedData({
      verifiedOwner: false,
      membership: { status: "revoked" },
    })).toBe(false);
    expect(mayAccessProtectedData({
      verifiedOwner: false,
      membership: { status: "approved" },
    })).toBe(true);
    expect(mayAccessProtectedData({ verifiedOwner: true, membership: undefined })).toBe(true);
    expect(mayAccessProtectedData({ verifiedOwner: true, membership: pending })).toBe(true);
  });

  it("recognizes only the configured owner union id or GitHub id", () => {
    expect(isVerifiedOwner({
      unionId: "union-1",
      ownerUnionId: "union-1",
      githubId: null,
      ownerGithubId: "7",
    })).toBe(true);
    expect(isVerifiedOwner({
      unionId: "github:7",
      ownerUnionId: "",
      githubId: "7",
      ownerGithubId: "7",
    })).toBe(true);
    expect(isVerifiedOwner({
      unionId: "kimi-user",
      ownerUnionId: "union-1",
      githubId: null,
      ownerGithubId: "",
    })).toBe(false);
    expect(isVerifiedOwner({
      unionId: "github:42",
      ownerUnionId: "",
      githubId: "42",
      ownerGithubId: "7",
    })).toBe(false);
  });

  it("reports a missing membership as pending and keeps a stored denial", () => {
    expect(presentedMembership({ membership: null, fallbackLogin: "kimi" })).toEqual({
      status: "pending",
      role: "member",
      login: "kimi",
      githubId: "",
    });
    expect(presentedMembership({
      membership: {
        status: "rejected",
        role: "member",
        login: "ada",
        githubId: "42",
        sessionGeneration: 2,
      },
      fallbackLogin: "other",
    }).status).toBe("rejected");
  });
});

describe("sessionAccess", () => {
  it("treats a pre-generation cookie as generation 1", () => {
    expect(sessionAccess({ tokenGeneration: undefined, member: pending })).toBe("pending");
  });

  it("rejects a cookie after the server generation moves", () => {
    expect(
      sessionAccess({
        tokenGeneration: 1,
        member: { status: "approved", role: "member", sessionGeneration: 2 },
      }),
    ).toBe("stale");
  });

  it("allows approved members and withholds everyone else", () => {
    expect(
      sessionAccess({
        tokenGeneration: 2,
        member: { status: "approved", role: "member", sessionGeneration: 2 },
      }),
    ).toBe("approved");
    expect(
      sessionAccess({
        tokenGeneration: 2,
        member: { status: "rejected", role: "member", sessionGeneration: 2 },
      }),
    ).toBe("denied");
  });
});

describe("reviewDecision", () => {
  it("approves without killing the current pending session", () => {
    expect(
      reviewDecision({
        action: "approve",
        targetGithubId: "42",
        ownerGithubId: "7",
        target: pending,
      }),
    ).toEqual({ ok: true, next: { status: "approved", role: "member", sessionGeneration: 1 } });
  });

  it("bumps the session generation on revoke and reject", () => {
    const revoked = reviewDecision({
      action: "revoke",
      targetGithubId: "42",
      ownerGithubId: "7",
      target: { status: "approved", role: "member", sessionGeneration: 2 },
    });
    expect(revoked).toEqual({
      ok: true,
      next: { status: "revoked", role: "member", sessionGeneration: 3 },
    });
    const rejected = reviewDecision({
      action: "reject",
      targetGithubId: "42",
      ownerGithubId: "7",
      target: pending,
    });
    expect(rejected).toEqual({
      ok: true,
      next: { status: "rejected", role: "member", sessionGeneration: 2 },
    });
  });

  it("refuses to change the owner", () => {
    expect(
      reviewDecision({
        action: "revoke",
        targetGithubId: "7",
        ownerGithubId: "7",
        target: { status: "approved", role: "admin", sessionGeneration: 1 },
      }),
    ).toEqual({ ok: false, reason: "owner" });
  });
});

describe("oauth state", () => {
  it("accepts only the matching browser state", () => {
    expect(oauthStatesMatch("gh:abc-12345", "gh:abc-12345")).toBe(true);
    expect(oauthStatesMatch("gh:abc-12345", "gh:abc-12346")).toBe(false);
    expect(oauthStatesMatch("static", "static")).toBe(false);
    expect(oauthStatesMatch(undefined, "gh:abc-12345")).toBe(false);
  });

  it("reads a github id only from the github union form", () => {
    expect(githubIdFromUnion("github:42")).toBe("42");
    expect(githubIdFromUnion("kimi-user")).toBeNull();
    expect(githubIdFromUnion("github:nope")).toBeNull();
  });
});
