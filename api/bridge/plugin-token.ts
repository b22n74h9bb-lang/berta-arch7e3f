import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pluginAllowsAction } from "./security";
import type { PluginStatus } from "@contracts/plugins";

/** One-time owner credential. Only the hash is stored. This build has no route that accepts it. */
export function issuePluginToken(): { token: string; tokenHash: string } {
  const token = `bpt_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashPluginToken(token) };
}

export function hashPluginToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function pluginTokenHashEqual(storedHash: string, presentedToken: string): boolean {
  const presented = hashPluginToken(presentedToken);
  const left = Buffer.from(storedHash);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function pluginTokenUsable(input: {
  status: PluginStatus;
  pluginGeneration: number;
  tokenGeneration: number;
  revokedAt: Date | null;
  scopes: readonly string[];
  action: string;
}): boolean {
  if (input.revokedAt) return false;
  if (input.pluginGeneration !== input.tokenGeneration) return false;
  return pluginAllowsAction({
    status: input.status,
    scopes: input.scopes,
    action: input.action,
  });
}
