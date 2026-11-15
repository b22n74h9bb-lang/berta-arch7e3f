import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSlackDeliveryAlert,
  notifySlackOfNewDelivery,
  shouldAlertSlack,
} from "./slack-delivery-alert";

const PUSH_INPUT = {
  eventType: "push",
  deliveryId: "d-1",
  repo: "org/repo",
  ref: "refs/heads/main",
  actorLogin: "ada",
  missionRecordId: 42,
  body: { ref: "refs/heads/main", sender: { login: "ada" }, repository: { full_name: "org/repo" } },
};

describe("shouldAlertSlack", () => {
  it("alerts a newly stored push and skips a redelivery", () => {
    expect(shouldAlertSlack({ eventType: "push", isNewMissionRecord: true })).toBe(true);
    expect(shouldAlertSlack({ eventType: "push", isNewMissionRecord: false })).toBe(false);
  });

  it("alerts meaningful pull_request and release actions only", () => {
    expect(shouldAlertSlack({ eventType: "pull_request", isNewMissionRecord: true, action: "opened" })).toBe(true);
    expect(shouldAlertSlack({ eventType: "pull_request", isNewMissionRecord: true, action: "closed" })).toBe(true);
    expect(shouldAlertSlack({ eventType: "pull_request", isNewMissionRecord: true, action: "synchronize" })).toBe(false);
    expect(shouldAlertSlack({ eventType: "pull_request", isNewMissionRecord: true, action: "labeled" })).toBe(false);
    expect(shouldAlertSlack({ eventType: "release", isNewMissionRecord: true, action: "published" })).toBe(true);
    expect(shouldAlertSlack({ eventType: "release", isNewMissionRecord: true, action: "edited" })).toBe(false);
  });

  it("skips issues, comments, and pings", () => {
    expect(shouldAlertSlack({ eventType: "issues", isNewMissionRecord: true, action: "opened" })).toBe(false);
    expect(shouldAlertSlack({ eventType: "issue_comment", isNewMissionRecord: true, action: "created" })).toBe(false);
    expect(shouldAlertSlack({ eventType: "ping", isNewMissionRecord: true })).toBe(false);
  });
});

describe("buildSlackDeliveryAlert", () => {
  it("summarizes a delivery without dumping the payload", () => {
    const payload = buildSlackDeliveryAlert({
      ...PUSH_INPUT,
      eventType: "pull_request",
      body: {
        action: "opened",
        pull_request: { number: 17, title: "Add offline conflict rules" },
        sender: { login: "ada" },
        repository: { full_name: "org/repo" },
      },
    });
    expect(payload.text).toContain("pull_request opened #17 Add offline conflict rules");
    expect(payload.text).toContain("on org/repo");
    expect(payload.text).toContain("by ada");
    expect(payload.text).toContain("delivery d-1 · mission 42");
    expect(payload.text).not.toContain("secret");
  });
});

describe("notifySlackOfNewDelivery", () => {
  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    vi.unstubAllGlobals();
  });

  it("does not post when the webhook URL is unset", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const poster = vi.fn();
    await expect(notifySlackOfNewDelivery({ ...PUSH_INPUT, isNewMissionRecord: true }, poster)).resolves.toEqual({
      notified: false,
    });
    expect(poster).not.toHaveBeenCalled();
  });

  it("posts one message for a new allowlisted delivery", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/WEBHOOK/secret-token";
    const poster = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(notifySlackOfNewDelivery({ ...PUSH_INPUT, isNewMissionRecord: true }, poster)).resolves.toEqual({
      notified: true,
    });
    expect(poster).toHaveBeenCalledTimes(1);
    const [url, init] = poster.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/TEST/WEBHOOK/secret-token");
    expect(init).toMatchObject({ method: "POST" });
    const body = JSON.parse(String(init?.body));
    expect(body.text).toContain("New GitHub delivery stored: push on org/repo @ refs/heads/main by ada");
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });

  it("skips issues and redeliveries even when a webhook URL is set", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/WEBHOOK/secret-token";
    const poster = vi.fn();
    await expect(notifySlackOfNewDelivery({
      ...PUSH_INPUT,
      eventType: "issues",
      isNewMissionRecord: true,
      body: { action: "opened" },
    }, poster)).resolves.toEqual({ notified: false });
    await expect(notifySlackOfNewDelivery({ ...PUSH_INPUT, isNewMissionRecord: false }, poster)).resolves.toEqual({
      notified: false,
    });
    expect(poster).not.toHaveBeenCalled();
  });

  it("fails open and does not include the webhook URL in the error", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/TEST/WEBHOOK/secret-token";
    const poster = vi.fn(async () => {
      throw new Error("fetch failed: https://hooks.slack.com/services/TEST/WEBHOOK/secret-token");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(notifySlackOfNewDelivery({ ...PUSH_INPUT, isNewMissionRecord: true }, poster)).resolves.toEqual({
      notified: false,
    });
    const logged = warn.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(logged).toContain("slack delivery alert failed");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("hooks.slack.com/services/TEST/WEBHOOK/secret-token");
    warn.mockRestore();
  });
});
