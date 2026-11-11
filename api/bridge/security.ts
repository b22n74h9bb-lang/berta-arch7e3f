import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PLUGIN_ACTIONS = [
  "mission.create",
  "task.assign",
  "comment.add",
  "approval.request",
] as const;

export type PluginAction = (typeof PLUGIN_ACTIONS)[number];

/** Default deny. Only explicitly listed actions pass. No wildcards. */
export function pluginAllowsAction(input: {
  status: "pending" | "approved" | "revoked";
  scopes: readonly string[];
  action: string;
}): boolean {
  if (input.status !== "approved") return false;
  if (!(PLUGIN_ACTIONS as readonly string[]).includes(input.action)) return false;
  return input.scopes.includes(input.action);
}

/** Content hash for idempotency. Not a secret; never log the raw body. */
export function payloadHash(rawBody: string | Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function githubSignatureValid(input: {
  rawBody: string | Buffer;
  secret: string;
  signatureHeader: string | undefined;
}): boolean {
  if (!input.secret || !input.signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", input.secret).update(input.rawBody).digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signatureHeader.trim());
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function idempotencyKey(deliveryId: string, hash: string): string {
  return `${deliveryId}:${hash}`;
}

export type BridgeEventSource = "github";

export function normalizeGithubDelivery(input: {
  deliveryId: string;
  eventType: string;
  rawBody: string;
  actorLogin?: string;
  repo?: string;
  ref?: string;
}): {
  source: BridgeEventSource;
  type: string;
  deliveryId: string;
  payloadHash: string;
  actorLogin: string | null;
  repo: string | null;
  ref: string | null;
} {
  return {
    source: "github",
    type: input.eventType.slice(0, 120),
    deliveryId: input.deliveryId.slice(0, 120),
    payloadHash: payloadHash(input.rawBody),
    actorLogin: input.actorLogin?.trim().slice(0, 255) || null,
    repo: input.repo?.trim().slice(0, 255) || null,
    ref: input.ref?.trim().slice(0, 255) || null,
  };
}

/** Replay window for outbound signed hooks (ms). */
export const HOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function outboundHookSignature(input: {
  secret: string;
  timestampMs: number;
  body: string;
}): string {
  const signed = `${input.timestampMs}.${input.body}`;
  return createHmac("sha256", input.secret).update(signed).digest("hex");
}

export function outboundHookFresh(input: {
  timestampMs: number;
  nowMs: number;
  windowMs?: number;
}): boolean {
  const windowMs = input.windowMs ?? HOOK_REPLAY_WINDOW_MS;
  if (!Number.isFinite(input.timestampMs)) return false;
  return Math.abs(input.nowMs - input.timestampMs) <= windowMs;
}
