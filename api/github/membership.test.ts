import { describe, expect, it } from "vitest";
import {
  githubIdFromUnion,
  membershipForSignIn,
  oauthStatesMatch,
  reviewDecision,
  sessionAccess,
} from "./membership";

const pending = { status: "pending" as const, role: "member" as const, sessionGeneration: 1 };

describe("membershipForSignIn", () => {
  it("keeps a new GitHub user pending and non-admin", () => {
    expect(membershipForSignIn({ githubId: "42", ownerGithubId: "7", existing: null })).toEqual({
      status: "pending",
      role: "member",
      sessionGeneration: 1,
    });
  });

  it("approves only the owner id and preserves their session generation", () => {
    expect(
      membershipForSignIn({
        githubId: "7",
        ownerGithubId: "7",
        existing: { status: "pending", role: "member", sessionGeneration: 3 },
      }),
    ).toEqual({ status: "approved", role: "admin", sessionGeneration: 3 });
  });

  it("does not reopen a rejected or revoked account on the next sign-in", () => {
    expect(
      membershipForSignIn({
        githubId: "42",
        ownerGithubId: "7",
        existing: { status: "revoked", role: "admin", sessionGeneration: 4 },
      }),
    ).toEqual({ status: "revoked", role: "member", sessionGeneration: 4 });
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
