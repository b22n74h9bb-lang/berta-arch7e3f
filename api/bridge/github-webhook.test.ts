import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("github webhook route", () => {
  beforeEach(() => {
    process.env.APP_ID = "app";
    process.env.APP_SECRET = "app-secret";
    process.env.DATABASE_URL = "mysql://berta:berta@127.0.0.1:3306/berta";
    process.env.KIMI_AUTH_URL = "https://auth.example";
    process.env.KIMI_OPEN_URL = "https://open.example";
    process.env.GITHUB_CLIENT_ID = "Iv1.test";
    process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("fails closed when the webhook secret is missing", async () => {
    const { default: app } = await import("../boot");
    const response = await app.request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "webhook_disabled" });
  });

  it("rejects a bad signature and accepts a valid one without persisting yet", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "whsec-test";
    const { default: app } = await import("../boot");
    const rawBody = '{"action":"opened","sender":{"login":"ada"},"repository":{"full_name":"org/repo"},"ref":"refs/heads/main"}';
    const bad = await app.request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-delivery": "d-1",
        "x-github-event": "push",
      },
    });
    expect(bad.status).toBe(401);

    const signature = `sha256=${createHmac("sha256", "whsec-test").update(rawBody).digest("hex")}`;
    const ok = await app.request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": "d-1",
        "x-github-event": "push",
      },
    });
    expect(ok.status).toBe(202);
    const body = await ok.json() as {
      ok: boolean;
      accepted: boolean;
      persisted: boolean;
      type: string;
      deliveryId: string;
    };
    expect(body).toMatchObject({
      ok: true,
      accepted: true,
      persisted: false,
      type: "push",
      deliveryId: "d-1",
    });
    expect(JSON.stringify(body)).not.toContain("whsec-test");
  });

  it("still accepts when Slack is configured but persistence is unavailable", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "whsec-test";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/WEBHOOK/secret-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { default: app } = await import("../boot");
    const rawBody = '{"action":"opened","sender":{"login":"ada"},"repository":{"full_name":"org/repo"},"ref":"refs/heads/main"}';
    const signature = `sha256=${createHmac("sha256", "whsec-test").update(rawBody).digest("hex")}`;
    const ok = await app.request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-delivery": "d-2",
        "x-github-event": "push",
      },
    });
    expect(ok.status).toBe(202);
    const body = await ok.json() as { accepted: boolean; persisted: boolean };
    expect(body).toMatchObject({ accepted: true, persisted: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });
});
