import { env } from "../lib/env";
import { log } from "../lib/logger";

const MEANINGFUL_PULL_REQUEST_ACTIONS = new Set([
  "opened",
  "closed",
  "reopened",
  "ready_for_review",
  "converted_to_draft",
]);

const MEANINGFUL_RELEASE_ACTIONS = new Set([
  "published",
  "released",
  "created",
  "prereleased",
]);

export type SlackDeliveryAlertInput = {
  eventType: string;
  deliveryId: string;
  repo: string | null;
  ref: string | null;
  actorLogin: string | null;
  missionRecordId?: number;
  body: unknown;
};

export function readWebhookAction(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const action = (body as { action?: unknown }).action;
  return typeof action === "string" && action.trim() ? action.trim() : undefined;
}

/** Alert only a newly stored allowlisted delivery, not redeliveries or issue/comment noise. */
export function shouldAlertSlack(input: {
  eventType: string;
  isNewMissionRecord: boolean;
  action?: string;
}): boolean {
  if (!input.isNewMissionRecord) return false;
  const type = input.eventType.trim();
  if (type === "push") return true;
  if (type === "pull_request") return MEANINGFUL_PULL_REQUEST_ACTIONS.has(input.action ?? "");
  if (type === "release") return MEANINGFUL_RELEASE_ACTIONS.has(input.action ?? "");
  return false;
}

function readPullRequestLabel(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const pr = (body as { pull_request?: unknown }).pull_request;
  if (!pr || typeof pr !== "object") return undefined;
  const record = pr as { number?: unknown; title?: unknown };
  const number = typeof record.number === "number" ? `#${record.number}` : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const label = [number, title].filter(Boolean).join(" ");
  return label || undefined;
}

export function buildSlackDeliveryAlert(input: SlackDeliveryAlertInput): { text: string } {
  const action = readWebhookAction(input.body);
  const parts = [input.eventType];
  if (action) parts.push(action);
  const pr = input.eventType === "pull_request" ? readPullRequestLabel(input.body) : undefined;
  if (pr) parts.push(pr);
  const where = input.repo ? `${input.repo}${input.ref ? ` @ ${input.ref}` : ""}` : "github";
  const actor = input.actorLogin ? ` by ${input.actorLogin}` : "";
  const mission = input.missionRecordId ? ` · mission ${input.missionRecordId}` : "";
  const text = [
    `New GitHub delivery stored: ${parts.join(" ")} on ${where}${actor}`,
    `delivery ${input.deliveryId}${mission}`,
  ].join("\n").slice(0, 1000);
  return { text };
}

function scrubWebhookMentions(value: string, webhookUrl: string): string {
  let out = value;
  if (webhookUrl) out = out.split(webhookUrl).join("<redacted>");
  return out.replace(/https:\/\/hooks\.slack\.com\/\S+/gi, "<redacted>");
}

export type SlackPoster = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Post one #seedgym incoming-webhook message for a newly stored allowlisted delivery.
 * Fail-open: Slack errors are logged without the URL and never thrown.
 */
export async function notifySlackOfNewDelivery(
  input: SlackDeliveryAlertInput & { isNewMissionRecord: boolean },
  poster: SlackPoster = fetch,
): Promise<{ notified: boolean }> {
  const webhookUrl = env.slackWebhookUrl;
  if (!webhookUrl) return { notified: false };
  if (!shouldAlertSlack({
    eventType: input.eventType,
    isNewMissionRecord: input.isNewMissionRecord,
    action: readWebhookAction(input.body),
  })) {
    return { notified: false };
  }
  try {
    const response = await poster(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSlackDeliveryAlert(input)),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      log.warn("slack delivery alert failed", {
        status: response.status,
        deliveryId: input.deliveryId,
      });
      return { notified: false };
    }
    return { notified: true };
  } catch (error) {
    log.warn("slack delivery alert failed", {
      error: scrubWebhookMentions(String(error), webhookUrl),
      deliveryId: input.deliveryId,
    });
    return { notified: false };
  }
}
