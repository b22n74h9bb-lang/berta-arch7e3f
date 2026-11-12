import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CHARTER_MAX_CHARS,
  CHARTER_PROMPT_MAX_CHARS,
  CHARTER_TRUNCATION_NOTE,
  assembleChatSystemPrompt,
  charterAccess,
  isDuplicateCharterVersion,
  normalizeCharterBody,
  planCharterRollback,
  planCharterSave,
  type CharterVersion,
} from "@contracts/charter";
import { CHARTERS_TABLE_SQL } from "./table-sql";
import { BERTA_SYSTEM, readChatSystemPrompt, resolveChatSystemPrompt } from "./prompt";
import { log } from "../lib/logger";

const now = new Date("2026-03-01T00:00:00.000Z");
const later = new Date("2026-03-02T00:00:00.000Z");

function version(overrides: Partial<CharterVersion> & Pick<CharterVersion, "version" | "body">): CharterVersion {
  return {
    authorUserId: 7,
    createdAt: now,
    restoredFromVersion: null,
    ...overrides,
  };
}

describe("charter access", () => {
  it("allows only the verified owner", () => {
    expect(charterAccess(null)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(charterAccess(undefined)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(charterAccess({ verifiedOwner: false })).toEqual({ ok: false, reason: "not-member" });
    expect(charterAccess({ verifiedOwner: false, membership: null })).toEqual({ ok: false, reason: "not-member" });
    for (const status of ["pending", "rejected", "revoked"]) {
      expect(charterAccess({ verifiedOwner: false, membership: { status } })).toEqual({
        ok: false,
        reason: "not-member",
      });
    }
    expect(charterAccess({ verifiedOwner: false, membership: { status: "approved" } })).toEqual({
      ok: false,
      reason: "not-owner",
    });
    expect(charterAccess({ verifiedOwner: true })).toEqual({ ok: true });
    expect(charterAccess({ verifiedOwner: true, membership: { status: "pending" } })).toEqual({ ok: true });
    expect(charterAccess({ verifiedOwner: true, membership: { status: "rejected" } })).toEqual({ ok: true });
  });
});

describe("charter versions", () => {
  const alpha = "Neutral charter placeholder alpha.";
  const beta = "Neutral charter placeholder beta.";

  it("normalizes text and rejects empty or oversized charters", () => {
    expect(normalizeCharterBody(" \n  ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeCharterBody("\u0000\u0000")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeCharterBody("\uFEFFLine one.\r\nLine two.\r")).toEqual({
      ok: true,
      body: "Line one.\nLine two.",
    });
    expect(normalizeCharterBody("n".repeat(CHARTER_MAX_CHARS))).toEqual({
      ok: true,
      body: "n".repeat(CHARTER_MAX_CHARS),
    });
    expect(normalizeCharterBody("n".repeat(CHARTER_MAX_CHARS + 1))).toEqual({ ok: false, reason: "too-long" });
  });

  it("saves the next version and leaves an identical charter unchanged", () => {
    const first = planCharterSave(null, { body: `  ${alpha}\r\n`, authorUserId: 7, now });
    expect(first).toEqual({
      action: "insert",
      row: version({ version: 1, body: alpha, createdAt: now }),
    });
    if (first.action !== "insert") return;
    const again = planCharterSave(first.row, { body: alpha, authorUserId: 7, now: later });
    expect(again).toEqual({ action: "unchanged", active: first.row });
    const second = planCharterSave(first.row, { body: beta, authorUserId: 8, now: later });
    expect(second).toEqual({
      action: "insert",
      row: version({ version: 2, body: beta, authorUserId: 8, createdAt: later }),
    });
  });

  it("rolls back by copying an older version forward", () => {
    const v1 = version({ version: 1, body: alpha });
    const v2 = version({ version: 2, body: beta, authorUserId: 8, createdAt: later });
    const snapshot = { ...v1 };
    expect(planCharterRollback(null, v1, { authorUserId: 7, now })).toEqual({ action: "missing" });
    expect(planCharterRollback(v2, null, { authorUserId: 7, now })).toEqual({ action: "missing" });
    expect(planCharterRollback(v2, v2, { authorUserId: 7, now: later })).toEqual({
      action: "unchanged",
      active: v2,
    });
    const sameText = version({ version: 3, body: beta, createdAt: later });
    expect(planCharterRollback(sameText, v2, { authorUserId: 7, now })).toEqual({
      action: "unchanged",
      active: sameText,
    });
    const restored = planCharterRollback(v2, v1, { authorUserId: 4, now: later });
    expect(restored).toEqual({
      action: "insert",
      row: version({
        version: 3,
        body: alpha,
        authorUserId: 4,
        createdAt: later,
        restoredFromVersion: 1,
      }),
    });
    expect(v1).toEqual(snapshot);
  });

  it("recognizes a duplicate version wrapped by the driver", () => {
    expect(isDuplicateCharterVersion(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }))).toBe(true);
    expect(isDuplicateCharterVersion({ errno: 1062 })).toBe(true);
    expect(isDuplicateCharterVersion({ cause: { code: "ER_DUP_ENTRY" } })).toBe(true);
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isDuplicateCharterVersion(loop)).toBe(false);
    expect(isDuplicateCharterVersion(new Error("other"))).toBe(false);
  });
});

describe("chat system prompt", () => {
  it("uses the active charter and falls back to the built-in prompt", () => {
    expect(resolveChatSystemPrompt(null)).toBe(BERTA_SYSTEM);
    expect(resolveChatSystemPrompt(undefined)).toBe(BERTA_SYSTEM);
    expect(resolveChatSystemPrompt("  \n")).toBe(BERTA_SYSTEM);
    expect(BERTA_SYSTEM).toContain("no individual profiling");
    expect(BERTA_SYSTEM).toContain("Ask before large downloads");
    const charter = "Neutral charter placeholder.";
    expect(resolveChatSystemPrompt(charter)).toBe(charter);
    expect(resolveChatSystemPrompt(charter)).not.toContain("ARCH7E3F");
  });

  it("keeps the system prompt inside the character budget", () => {
    const exact = "n".repeat(CHARTER_PROMPT_MAX_CHARS);
    expect(assembleChatSystemPrompt({ charterBody: exact, fallback: "built-in" })).toBe(exact);
    const over = "n".repeat(CHARTER_PROMPT_MAX_CHARS + 25);
    const prompt = assembleChatSystemPrompt({ charterBody: over, fallback: "built-in" });
    expect(prompt.length).toBeLessThanOrEqual(CHARTER_PROMPT_MAX_CHARS);
    expect(prompt.endsWith(CHARTER_TRUNCATION_NOTE)).toBe(true);
    expect(prompt).not.toContain("built-in");

    const max = CHARTER_TRUNCATION_NOTE.length + 12;
    const fitted = assembleChatSystemPrompt({
      charterBody: "abcdef".repeat(max),
      fallback: "built-in",
      maxChars: max,
    });
    expect(fitted.length).toBe(max);
    expect(fitted.endsWith(CHARTER_TRUNCATION_NOTE)).toBe(true);
    expect(assembleChatSystemPrompt({
      charterBody: "abcdefghij",
      fallback: "built-in",
      maxChars: 4,
    })).toBe("abcd");
    const longFallback = "f".repeat(CHARTER_PROMPT_MAX_CHARS + 20);
    expect(assembleChatSystemPrompt({ charterBody: " ", fallback: longFallback })).toBe(longFallback);
  });

  it("keeps the built-in prompt when charter storage throws, without logging the failure text", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const marker = "neutral storage failure marker";
    await expect(readChatSystemPrompt(async () => {
      throw new Error(marker);
    })).resolves.toBe(BERTA_SYSTEM);
    expect(warn).toHaveBeenCalledWith("active charter could not be read; using built-in system prompt");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
    warn.mockRestore();

    await expect(readChatSystemPrompt(async () => "Neutral charter placeholder.")).resolves.toBe(
      "Neutral charter placeholder.",
    );
  });

  it("is what sendChat uses for the system prompt", () => {
    const source = readFileSync(new URL("../berta-router.ts", import.meta.url), "utf8");
    expect(source).toContain("readChatSystemPrompt");
    expect(source).not.toContain("system: BERTA_SYSTEM");
  });
});

describe("charter migration", () => {
  it("matches the statement the server applies", () => {
    const file = readFileSync(new URL("../../db/migrations/0001_charters.sql", import.meta.url), "utf8");
    const statement = file
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replaceAll(";", "")
      .replace(/\s+/g, " ")
      .trim();
    expect(statement).toBe(CHARTERS_TABLE_SQL.replace(/\s+/g, " ").trim());
    expect(statement).toContain("CREATE TABLE IF NOT EXISTS `charters`");
    expect(statement).toContain("`body` mediumtext NOT NULL");
    expect(statement).not.toMatch(/persona|memory|soul|identity/i);
  });
});
