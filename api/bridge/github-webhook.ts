import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { bridgeEvents, missionRecords } from "@db/schema";
import { env } from "../lib/env";
import { log } from "../lib/logger";
import { getDb } from "../queries/connection";
import { githubSignatureValid, normalizeGithubDelivery } from "./security";

function readSummary(body: unknown, eventType: string, repo: string | null, ref: string | null): string {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const head = record.head_commit as { message?: unknown } | undefined;
  const message = head && typeof head.message === "string" ? head.message : "";
  const base = repo ? `${repo}${ref ? ` @ ${ref}` : ""}` : eventType;
  return (message ? `${eventType}: ${message}` : `${eventType} on ${base}`).slice(0, 500);
}

/**
 * Persist the accepted delivery and create an in-app mission record.
 * Idempotent on (deliveryId, payloadHash): redeliveries refresh lastSeenAt
 * without duplicating the mission record. Never throws — the ingress must
 * stay honest-but-available: acceptance is acked, persistence is reported.
 */
async function persistDelivery(event: {
  type: string; deliveryId: string; payloadHash: string;
  actorLogin: string | null; repo: string | null; ref: string | null;
}, body: unknown): Promise<{ persisted: boolean; missionRecordId?: number }> {
  try {
    const db = getDb();
    await db.insert(bridgeEvents).values({
      source: "github", type: event.type, deliveryId: event.deliveryId,
      payloadHash: event.payloadHash, actorLogin: event.actorLogin,
      repo: event.repo, ref: event.ref,
    }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
    const rows = await db.select().from(bridgeEvents).where(
      and(eq(bridgeEvents.deliveryId, event.deliveryId), eq(bridgeEvents.payloadHash, event.payloadHash)),
    ).limit(1);
    const bridgeRow = rows[0];
    if (!bridgeRow) return { persisted: false };
    const existing = await db.select().from(missionRecords)
      .where(eq(missionRecords.sourceEventId, bridgeRow.id)).limit(1);
    if (existing.length > 0) return { persisted: true, missionRecordId: existing[0].id };
    const inserted = await db.insert(missionRecords).values({
      kind: `github.${event.type}`.slice(0, 80),
      summary: readSummary(body, event.type, event.repo, event.ref),
      actorLogin: event.actorLogin, repo: event.repo, ref: event.ref,
      state: "open", sourceEventId: bridgeRow.id,
    });
    const missionRecordId = Number(inserted[0]?.insertId ?? 0) || undefined;
    return { persisted: true, missionRecordId };
  } catch (error) {
    log.error("github webhook persistence failed", { error: String(error), deliveryId: event.deliveryId });
    return { persisted: false };
  }
}

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
 * Persistence of bridge_events and the in-app mission record is wired below;
 * dedup on (deliveryId, payloadHash), ledger failures never block acceptance.
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
    const persisted = await persistDelivery(event, parsed);
    return c.json({
      ok: true,
      accepted: true,
      persisted: persisted.persisted,
      missionRecordId: persisted.missionRecordId,
      deliveryId: event.deliveryId,
      type: event.type,
      payloadHash: event.payloadHash,
    }, 202);
  };
}
