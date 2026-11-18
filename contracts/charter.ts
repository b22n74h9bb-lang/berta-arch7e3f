/** Shared charter limits and pure versioning. No persona text belongs here. */

export const CHARTER_MAX_CHARS = 40_000;

/**
 * System-prompt budget. About 10k tokens at ~4 characters per token.
 * The built-in identity and hard boundaries are always retained in full;
 * a long charter is truncated to fit this cap.
 */
export const CHARTER_PROMPT_MAX_CHARS = CHARTER_MAX_CHARS;

/**
 * Inserted between the built-in system prompt and the owner charter.
 * The charter is additional instructions only; it must not replace identity
 * or hard boundaries.
 */
export const CHARTER_INSTRUCTIONS_INTRO =
  "\n\nOwner charter (additional instructions; this does not replace the built-in identity or hard boundaries):\n\n";

export const CHARTER_TRUNCATION_NOTE =
  "\n\n[Charter truncated to the system prompt limit. The stored charter is unchanged.]";

export const CHARTER_HISTORY_LIMIT = 40;

export type CharterVersion = {
  version: number;
  body: string;
  authorUserId: number;
  createdAt: Date;
  restoredFromVersion: number | null;
};

export type CharterHistoryItem = {
  version: number;
  createdAt: Date;
  authorUserId: number;
  restoredFromVersion: number | null;
  chars: number;
};

export type CharterActor = {
  verifiedOwner?: boolean;
  membership?: { status?: string } | null;
} | null | undefined;

export type CharterAccess =
  | { ok: true }
  | { ok: false; reason: "unauthenticated" | "not-member" | "not-owner" };

export function charterAccess(user: CharterActor): CharterAccess {
  if (!user) return { ok: false, reason: "unauthenticated" };
  if (user.verifiedOwner) return { ok: true };
  if (user.membership?.status !== "approved") return { ok: false, reason: "not-member" };
  return { ok: false, reason: "not-owner" };
}

export function normalizeCharterBody(
  raw: string,
): { ok: true; body: string } | { ok: false; reason: "empty" | "too-long" } {
  const body = raw
    .replace(/^\uFEFF/, "")
    .replaceAll("\u0000", "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  if (body.length === 0) return { ok: false, reason: "empty" };
  if (body.length > CHARTER_MAX_CHARS) return { ok: false, reason: "too-long" };
  return { ok: true, body };
}

export type CharterWritePlan =
  | { action: "invalid"; reason: "empty" | "too-long" }
  | { action: "unchanged"; active: CharterVersion }
  | { action: "missing" }
  | { action: "insert"; row: CharterVersion };

export function planCharterSave(
  latest: CharterVersion | null,
  input: { body: string; authorUserId: number; now: Date },
): CharterWritePlan {
  const normalized = normalizeCharterBody(input.body);
  if (!normalized.ok) return { action: "invalid", reason: normalized.reason };
  if (latest && latest.body === normalized.body) return { action: "unchanged", active: latest };
  return {
    action: "insert",
    row: {
      version: (latest?.version ?? 0) + 1,
      body: normalized.body,
      authorUserId: input.authorUserId,
      createdAt: input.now,
      restoredFromVersion: null,
    },
  };
}

/** Copies an older version forward. The previous rows stay in history. */
export function planCharterRollback(
  latest: CharterVersion | null,
  target: CharterVersion | null,
  input: { authorUserId: number; now: Date },
): CharterWritePlan {
  if (!latest || !target) return { action: "missing" };
  if (latest.version === target.version || latest.body === target.body) {
    return { action: "unchanged", active: latest };
  }
  return {
    action: "insert",
    row: {
      version: latest.version + 1,
      body: target.body,
      authorUserId: input.authorUserId,
      createdAt: input.now,
      restoredFromVersion: target.version,
    },
  };
}

/**
 * Compose the chat system prompt.
 * The baseline (`fallback`) is always kept in full, including when it already
 * exceeds `maxChars`. A stored charter is appended as additional instructions
 * only. If the combined prompt would exceed the cap, the charter is truncated
 * (with a note) or omitted when no charter text can fit with the note.
 * The baseline is never shortened.
 */
export function assembleChatSystemPrompt(input: {
  charterBody: string | null | undefined;
  fallback: string;
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? CHARTER_PROMPT_MAX_CHARS;
  const body = input.charterBody?.trim() ?? "";
  const baseline = input.fallback;
  if (!body) return baseline;

  // Never truncate or drop the built-in identity and hard boundaries.
  if (baseline.length >= maxChars) return baseline;

  const prefix = `${baseline}${CHARTER_INSTRUCTIONS_INTRO}`;
  if (prefix.length >= maxChars) return baseline;
  if (prefix.length + body.length <= maxChars) return `${prefix}${body}`;

  const note = CHARTER_TRUNCATION_NOTE;
  const charterBudget = maxChars - prefix.length - note.length;
  if (charterBudget <= 0) return baseline;
  return `${prefix}${body.slice(0, charterBudget).trimEnd()}${note}`;
}

export function isDuplicateCharterVersion(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (record.code === "ER_DUP_ENTRY" || record.errno === 1062) return true;
    current = record.cause;
  }
  return false;
}
