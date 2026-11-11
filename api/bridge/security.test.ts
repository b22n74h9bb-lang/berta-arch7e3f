import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  githubSignatureValid,
  idempotencyKey,
  normalizeGithubDelivery,
  outboundHookFresh,
  outboundHookSignature,
  pluginAllowsAction,
  payloadHash,
} from "./security";

describe("plugin permissions", () => {
  it("defaults to deny and never accepts wildcards", () => {
    expect(pluginAllowsAction({
      status: "approved",
      scopes: ["*"],
      action: "mission.create",
    })).toBe(false);
    expect(pluginAllowsAction({
      status: "pending",
      scopes: ["mission.create"],
      action: "mission.create",
    })).toBe(false);
    expect(pluginAllowsAction({
      status: "revoked",
      scopes: ["mission.create"],
      action: "mission.create",
    })).toBe(false);
    expect(pluginAllowsAction({
      status: "approved",
      scopes: ["mission.create"],
      action: "mission.create",
    })).toBe(true);
    expect(pluginAllowsAction({
      status: "approved",
      scopes: ["mission.create"],
      action: "task.assign",
    })).toBe(false);
  });
});

describe("github webhook signature", () => {
  it("accepts a valid sha256 signature and rejects tampering", () => {
    const secret = "test-webhook-secret";
    const rawBody = '{"action":"opened"}';
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    expect(githubSignatureValid({ rawBody, secret, signatureHeader: signature })).toBe(true);
    expect(githubSignatureValid({
      rawBody: '{"action":"closed"}',
      secret,
      signatureHeader: signature,
    })).toBe(false);
    expect(githubSignatureValid({ rawBody, secret, signatureHeader: undefined })).toBe(false);
    expect(githubSignatureValid({ rawBody, secret: "", signatureHeader: signature })).toBe(false);
  });
});

describe("event normalization", () => {
  it("hashes the raw body and builds a stable idempotency key", () => {
    const event = normalizeGithubDelivery({
      deliveryId: "d-1",
      eventType: "pull_request",
      rawBody: '{"x":1}',
      actorLogin: "ada",
      repo: "b22n74h9bb-lang/berta-arch7e3f",
      ref: "refs/heads/main",
    });
    expect(event.source).toBe("github");
    expect(event.payloadHash).toBe(payloadHash('{"x":1}'));
    expect(idempotencyKey(event.deliveryId, event.payloadHash)).toBe(
      `d-1:${event.payloadHash}`,
    );
  });
});

describe("outbound hooks", () => {
  it("signs with timestamp and enforces the replay window", () => {
    const secret = "hook-secret";
    const timestampMs = 1_700_000_000_000;
    const body = '{"kind":"approval.requested"}';
    const signature = outboundHookSignature({ secret, timestampMs, body });
    expect(signature).toHaveLength(64);
    expect(outboundHookFresh({ timestampMs, nowMs: timestampMs + 60_000 })).toBe(true);
    expect(outboundHookFresh({ timestampMs, nowMs: timestampMs + 6 * 60_000 })).toBe(false);
  });
});
