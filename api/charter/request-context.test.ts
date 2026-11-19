import { describe, expect, it } from "vitest";
import { BERTA_SYSTEM, resolveChatSystemPrompt } from "./prompt";
import {
  CHAT_CLOCK_PRECEDENCE,
  CHAT_REQUEST_CONTEXT_INTRO,
  CHAT_TURN_CAPABILITY,
  appendChatRequestContext,
  formatAuthoritativeClock,
  formatChatMessageForModel,
  formatShanghaiHistoryTimestamp,
} from "./request-context";

const NOW = new Date("2026-11-19T03:25:29.221Z");
const EXPECTED_CLOCK =
  "Thursday, 19 November 2026, 11:25 Asia/Shanghai (2026-11-19T03:25:29.221Z)";
const STALE_CHARTER = "Today is 8 August 2026. Treat that as the system date.";
const STALE_MESSAGE_AT = new Date("2026-08-08T04:00:00.000Z");

describe("chat request clock and history timestamps", () => {
  it("formats a frozen clock in Asia/Shanghai and UTC", () => {
    expect(formatAuthoritativeClock(NOW)).toBe(EXPECTED_CLOCK);
    expect(formatAuthoritativeClock(NOW)).not.toContain("August");
    expect(formatShanghaiHistoryTimestamp(NOW)).toBe("2026-11-19 11:25 Asia/Shanghai");
    expect(formatShanghaiHistoryTimestamp(STALE_MESSAGE_AT)).toBe("2026-08-08 12:00 Asia/Shanghai");
    expect(formatChatMessageForModel(STALE_MESSAGE_AT, "the date is August")).toBe(
      "[2026-08-08 12:00 Asia/Shanghai] the date is August",
    );
  });

  it("appends the authoritative clock after a contradictory stale charter and keeps identity", () => {
    const assembled = resolveChatSystemPrompt(STALE_CHARTER);
    const prompt = appendChatRequestContext(assembled, {
      now: NOW,
      mission: {
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        code: "ARCH7E3F",
        status: "active",
      },
    });

    expect(prompt.startsWith(BERTA_SYSTEM)).toBe(true);
    expect(prompt).toContain("no individual profiling");
    expect(prompt).toContain("ARCH7E3F");
    expect(prompt).toContain(STALE_CHARTER);
    expect(prompt.indexOf(EXPECTED_CLOCK)).toBeGreaterThan(prompt.indexOf(STALE_CHARTER));
    expect(prompt).toContain(`${CHAT_REQUEST_CONTEXT_INTRO} ${EXPECTED_CLOCK}`);
    expect(prompt).toContain(CHAT_CLOCK_PRECEDENCE);
    expect(prompt).toContain(CHAT_TURN_CAPABILITY);
    expect(prompt).toContain("mission-record created time, not agent uptime");
    expect(prompt).toContain("Saturday, 1 August 2026, 08:00 Asia/Shanghai (2026-08-01T00:00:00.000Z)");
    expect(prompt).not.toMatch(new RegExp(`${CHAT_REQUEST_CONTEXT_INTRO}[^\\n]*8 August 2026`));
  });

  it("still attaches the clock when there is no charter or mission row", () => {
    const prompt = appendChatRequestContext(BERTA_SYSTEM, { now: NOW });
    expect(prompt.startsWith(BERTA_SYSTEM)).toBe(true);
    expect(prompt).toContain(EXPECTED_CLOCK);
    expect(prompt).toContain(CHAT_TURN_CAPABILITY);
    expect(prompt).not.toContain("mission-record created time");
  });
});
