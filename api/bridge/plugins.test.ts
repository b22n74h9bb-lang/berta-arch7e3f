import { describe, expect, it } from "vitest";
import {
  hashPluginToken,
  mintPluginToken,
  parsePluginScopes,
  pluginMayAct,
  reviewPluginDecision,
  serializePluginScopes,
} from "./plugins";

describe("plugin scopes", () => {
  it("keeps only explicit allowlisted actions and drops wildcards", () => {
    expect(parsePluginScopes("mission.create, *, task.assign,bogus")).toEqual([
      "mission.create",
      "task.assign",
    ]);
    expect(serializePluginScopes(["task.assign", "mission.create"])).toBe(
      "mission.create,task.assign",
    );
  });
});

describe("plugin decisions", () => {
  it("approves pending plugins without bumping generation", () => {
    expect(
      reviewPluginDecision({ action: "approve", status: "pending", tokenGeneration: 1 }),
    ).toEqual({ ok: true, next: { status: "approved", tokenGeneration: 1 } });
  });

  it("revokes approved plugins and bumps token generation", () => {
    expect(
      reviewPluginDecision({ action: "revoke", status: "approved", tokenGeneration: 2 }),
    ).toEqual({ ok: true, next: { status: "revoked", tokenGeneration: 3 } });
  });

  it("refuses double-approve and already-revoked rows", () => {
    expect(
      reviewPluginDecision({ action: "approve", status: "approved", tokenGeneration: 1 }),
    ).toEqual({ ok: false, reason: "already_approved" });
    expect(
      reviewPluginDecision({ action: "revoke", status: "revoked", tokenGeneration: 4 }),
    ).toEqual({ ok: false, reason: "already_revoked" });
  });
});

describe("plugin tokens", () => {
  it("hashes minted tokens and denies stale generations", () => {
    const minted = mintPluginToken();
    expect(minted.token.startsWith("berta_plg_")).toBe(true);
    expect(hashPluginToken(minted.token)).toBe(minted.tokenHash);
    expect(
      pluginMayAct({
        status: "approved",
        scopesCsv: "mission.create",
        action: "mission.create",
        tokenGeneration: 2,
        presentedGeneration: 1,
      }),
    ).toBe(false);
    expect(
      pluginMayAct({
        status: "approved",
        scopesCsv: "mission.create",
        action: "mission.create",
        tokenGeneration: 2,
        presentedGeneration: 2,
      }),
    ).toBe(true);
  });
});
