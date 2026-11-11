import { createHash, randomBytes } from "node:crypto";
import { PLUGIN_ACTIONS, type PluginAction, pluginAllowsAction } from "./security";

export type PluginStatus = "pending" | "approved" | "revoked";
export type PluginDecision = "approve" | "revoke";

export function parsePluginScopes(raw: string): PluginAction[] {
  const parts = raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const allowed = new Set<PluginAction>();
  for (const part of parts) {
    if ((PLUGIN_ACTIONS as readonly string[]).includes(part)) {
      allowed.add(part as PluginAction);
    }
  }
  return PLUGIN_ACTIONS.filter((action) => allowed.has(action));
}

export function serializePluginScopes(scopes: readonly PluginAction[]): string {
  return parsePluginScopes(scopes.join(",")).join(",");
}

export function hashPluginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Opaque bearer token. Store only the hash. Never log the plaintext. */
export function mintPluginToken(): { token: string; tokenHash: string } {
  const token = `berta_plg_${randomBytes(24).toString("base64url")}`;
  return { token, tokenHash: hashPluginToken(token) };
}

export function reviewPluginDecision(input: {
  action: PluginDecision;
  status: PluginStatus;
  tokenGeneration: number;
}):
  | { ok: true; next: { status: PluginStatus; tokenGeneration: number } }
  | { ok: false; reason: "already_revoked" | "already_approved" } {
  if (input.status === "revoked") {
    return { ok: false, reason: "already_revoked" };
  }
  if (input.action === "approve") {
    if (input.status === "approved") {
      return { ok: false, reason: "already_approved" };
    }
    return {
      ok: true,
      next: { status: "approved", tokenGeneration: input.tokenGeneration },
    };
  }
  return {
    ok: true,
    next: {
      status: "revoked",
      tokenGeneration: input.tokenGeneration + 1,
    },
  };
}

export function pluginMayAct(input: {
  status: PluginStatus;
  scopesCsv: string;
  action: string;
  tokenGeneration: number;
  presentedGeneration: number;
}): boolean {
  if (input.presentedGeneration !== input.tokenGeneration) return false;
  return pluginAllowsAction({
    status: input.status,
    scopes: parsePluginScopes(input.scopesCsv),
    action: input.action,
  });
}
