import type { Context } from "hono";
import { env } from "../lib/env";
import { log } from "../lib/logger";
import { githubSignatureValid, normalizeGithubDelivery } from "./security";

function readActorAndRefs(body: unknown): {
  actorLogin?: string;
  repo?: string;
  ref?: string;
} {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const sender = record.sender;
  const repository = record.repository;
  const actorLogin =
    sender && typeof sender === "object" && typeof (sender as { login?: unknown }).login === "string"
      ? (sender as { login: string }).login
      : undefined;
  const repo =
    repository && typeof repository === "object"
    && typeof (repository as { full_name?: unknown }).full_name === "string"
      ? (repository as { full_name: string }).full_name
      : undefined;
  const ref = typeof record.ref === "string" ? record.ref : undefined;
  return { actorLogin, repo, ref };
}

/**
 * GitHub → Berta bridge ingress.
 * Fail closed without a configured secret. Verify HMAC before parsing for projection.
 * Persistence of bridge_events is additive and wired after owner review of this scaffold.
 */
export function createGithubWebhookHandler() {
  return async (c: Context) => {
    const secret = env.githubWebhookSecret;
    if (!secret) {
      log.warn("github webhook rejected: secret not configured");
      return c.json({ error: "webhook_disabled" }, 503);
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("x-hub-signature-256");
    if (!githubSignatureValid({ rawBody, secret, signatureHeader: signature })) {
      log.warn("github webhook rejected: bad signature");
      return c.json({ error: "invalid_signature" }, 401);
    }
    const deliveryId = c.req.header("x-github-delivery")?.trim() || "";
    const eventType = c.req.header("x-github-event")?.trim() || "";
    if (!deliveryId || !eventType) {
      return c.json({ error: "missing_delivery_headers" }, 400);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const refs = readActorAndRefs(parsed);
    const event = normalizeGithubDelivery({
      deliveryId,
      eventType,
      rawBody,
      actorLogin: refs.actorLogin,
      repo: refs.repo,
      ref: refs.ref,
    });
    log.info("github webhook accepted", {
      type: event.type,
      deliveryId: event.deliveryId,
      payloadHash: event.payloadHash,
      repo: event.repo,
    });
    return c.json({
      ok: true,
      accepted: true,
      persisted: false,
      deliveryId: event.deliveryId,
      type: event.type,
      payloadHash: event.payloadHash,
    }, 202);
  };
}
