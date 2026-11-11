import { describe, expect, it } from "vitest";
import {
  decidePlugin,
  dispatchPluginHooks,
  encodePluginManifest,
  parseStoredScopes,
  registerPluginManifest,
  selectHookRecipients,
} from "@contracts/plugins";
import {
  hashPluginToken,
  issuePluginToken,
  pluginTokenHashEqual,
  pluginTokenUsable,
} from "./plugin-token";

const extension = {
  name: "mission-notes",
  version: "0.1.0",
  kind: "first-party" as const,
  surface: "extension" as const,
  scopes: ["comment.add"],
  hooks: ["task.updated"],
  config: { display_name: "Notes" },
};

describe("plugin registration", () => {
  it("stores a pending sandbox manifest and rejects wildcards, secrets, and status smuggling", () => {
    const registered = registerPluginManifest(extension);
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.manifest.isolation).toBe("sandbox");
    expect(registered.storedScopes).not.toContain("approved");
    expect(parseStoredScopes("mission-notes", "0.1.0", registered.storedScopes).manifest.scopes).toEqual(["comment.add"]);

    expect(registerPluginManifest({ ...extension, scopes: ["*"] }).ok).toBe(false);
    expect(registerPluginManifest({ ...extension, hooks: ["*"] }).ok).toBe(false);
    expect(registerPluginManifest({
      ...extension,
      config: { api_token: "should-not-save" },
    }).ok).toBe(false);
    expect(registerPluginManifest({
      ...extension,
      config: { display_name: "https://hooks.example/secret" },
    }).ok).toBe(false);
    expect(registerPluginManifest({
      ...extension,
      kind: "third-party",
      name: "wechat-bridge",
    }).ok).toBe(false);
    expect(registerPluginManifest({
      ...extension,
      name: "wechat-official",
      surface: "wechat",
      kind: "third-party",
      config: { account_mode: "wecom", display_name: "Berta" },
    }).ok).toBe(false);
  });

  it("accepts only the first-party WeChat adapter name", () => {
    const registered = registerPluginManifest({
      name: "wechat-official",
      version: "0.1.0",
      kind: "first-party",
      surface: "wechat",
      scopes: ["approval.request"],
      hooks: ["approval.decided"],
      config: { account_mode: "wecom", display_name: "Berta" },
    });
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    const parsed = parseStoredScopes("wechat-official", "0.1.0", registered.storedScopes);
    expect(parsed.valid).toBe(true);
    expect(parsed.manifest.isolation).toBe("sandbox");
    expect(parsed.manifest.config).toEqual({ account_mode: "wecom", display_name: "Berta" });
  });

  it("keeps a legacy action list sandboxed", () => {
    const parsed = parseStoredScopes("legacy", "0.0.1", "mission.create, nope");
    expect(parsed.manifest.scopes).toEqual(["mission.create"]);
    expect(parsed.manifest.isolation).toBe("sandbox");
    expect(parsed.manifest.hooks).toEqual([]);
  });
});

describe("plugin approval", () => {
  it("issues a token only when approval changes, and revoke invalidates it", () => {
    const first = decidePlugin({ action: "approve", status: "pending", tokenGeneration: 1 });
    expect(first).toMatchObject({ changed: true, status: "approved", tokenGeneration: 2, issueToken: true });
    const again = decidePlugin({ action: "approve", status: "approved", tokenGeneration: 2 });
    expect(again).toMatchObject({ changed: false, issueToken: false });
    const revoked = decidePlugin({ action: "revoke", status: "approved", tokenGeneration: 2 });
    expect(revoked).toMatchObject({ changed: true, status: "revoked", tokenGeneration: 3, issueToken: false });

    const issued = issuePluginToken();
    expect(issued.token.startsWith("bpt_")).toBe(true);
    expect(issued.tokenHash).toBe(hashPluginToken(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(pluginTokenHashEqual(issued.tokenHash, issued.token)).toBe(true);
    expect(pluginTokenHashEqual(issued.tokenHash, `${issued.token}x`)).toBe(false);
    expect(pluginTokenUsable({
      status: "approved",
      pluginGeneration: 2,
      tokenGeneration: 2,
      revokedAt: null,
      scopes: ["comment.add"],
      action: "comment.add",
    })).toBe(true);
    expect(pluginTokenUsable({
      status: "approved",
      pluginGeneration: 3,
      tokenGeneration: 2,
      revokedAt: null,
      scopes: ["comment.add"],
      action: "comment.add",
    })).toBe(false);
    expect(pluginTokenUsable({
      status: "revoked",
      pluginGeneration: 2,
      tokenGeneration: 2,
      revokedAt: new Date(),
      scopes: ["comment.add"],
      action: "comment.add",
    })).toBe(false);
    expect(pluginTokenUsable({
      status: "pending",
      pluginGeneration: 2,
      tokenGeneration: 2,
      revokedAt: null,
      scopes: ["*"],
      action: "mission.create",
    })).toBe(false);
  });
});

describe("hook fan-out", () => {
  const plugins = [
    { id: 1, status: "approved" as const, hooks: ["approval.decided"], isolation: "sandbox" as const, manifestValid: true },
    { id: 2, status: "pending" as const, hooks: ["approval.decided"], isolation: "sandbox" as const, manifestValid: true },
    { id: 3, status: "approved" as const, hooks: ["*"], isolation: "sandbox" as const, manifestValid: true },
    { id: 4, status: "approved" as const, hooks: ["approval.decided"], isolation: "host", manifestValid: true },
    { id: 5, status: "revoked" as const, hooks: ["approval.decided"], isolation: "sandbox" as const, manifestValid: true },
  ];

  it("selects approved sandbox subscribers and never delivers", () => {
    expect(selectHookRecipients("approval.decided", plugins)).toEqual([1]);
    expect(selectHookRecipients("*", plugins)).toEqual([]);
    expect(dispatchPluginHooks({ hooksEnabled: false, event: "approval.decided", plugins })).toEqual({
      delivered: false,
      reason: "hooks_disabled",
      recipientIds: [],
    });
    expect(dispatchPluginHooks({ hooksEnabled: true, event: "approval.decided", plugins })).toEqual({
      delivered: false,
      reason: "hooks_not_shipped",
      recipientIds: [1],
    });
    expect(JSON.stringify(encodePluginManifest({
      ...extension,
      isolation: "sandbox",
      scopes: ["comment.add"],
      hooks: ["task.updated"],
    }))).not.toContain("http");
  });
});
