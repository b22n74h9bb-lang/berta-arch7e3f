import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../context";
import type { SessionUser } from "../kimi/auth";
import { createCallerFactory } from "../middleware";
import { charterRouter } from "./router";

type Row = {
  version: number;
  body: string;
  authorUserId: number;
  createdAt: Date;
  restoredFromVersion: number | null;
};

const harness = vi.hoisted(() => {
  const rows: Row[] = [];
  let failNextInsert = false;
  const latestCharter = vi.fn(async (): Promise<Row | null> => {
    return rows.reduce<Row | null>((best, row) => (!best || row.version > best.version ? row : best), null);
  });
  const charterByVersion = vi.fn(async (version: number) => rows.find((row) => row.version === version) ?? null);
  const listCharterHistory = vi.fn(async () =>
    [...rows]
      .sort((left, right) => right.version - left.version)
      .map((row) => ({
        version: row.version,
        createdAt: row.createdAt,
        authorUserId: row.authorUserId,
        restoredFromVersion: row.restoredFromVersion,
        chars: row.body.length,
      })),
  );
  const insertCharterVersion = vi.fn(async (row: Row) => {
    if (failNextInsert) {
      failNextInsert = false;
      rows.push({
        version: row.version,
        body: "Concurrent placeholder.",
        authorUserId: 9,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        restoredFromVersion: null,
      });
      throw Object.assign(new Error("duplicate version"), { code: "ER_DUP_ENTRY", errno: 1062 });
    }
    if (rows.some((existing) => existing.version === row.version)) {
      throw Object.assign(new Error("duplicate version"), { code: "ER_DUP_ENTRY", errno: 1062 });
    }
    rows.push(row);
  });
  return {
    rows,
    latestCharter,
    charterByVersion,
    listCharterHistory,
    insertCharterVersion,
    armConflict() {
      failNextInsert = true;
    },
    reset() {
      rows.length = 0;
      failNextInsert = false;
      latestCharter.mockClear();
      charterByVersion.mockClear();
      listCharterHistory.mockClear();
      insertCharterVersion.mockClear();
    },
  };
});

vi.mock("../queries/charter", () => ({
  latestCharter: harness.latestCharter,
  charterByVersion: harness.charterByVersion,
  listCharterHistory: harness.listCharterHistory,
  insertCharterVersion: harness.insertCharterVersion,
}));

const createCaller = createCallerFactory(charterRouter);
const alpha = "Neutral charter placeholder alpha.";
const beta = "Neutral charter placeholder beta.";

function actor(input: {
  id: number;
  verifiedOwner: boolean;
  status?: "pending" | "approved" | "rejected" | "revoked";
}): SessionUser {
  return {
    id: input.id,
    unionId: input.verifiedOwner ? "owner-union" : "member-union",
    name: input.verifiedOwner ? "Owner" : "Member",
    email: null,
    avatar: null,
    role: input.verifiedOwner ? "admin" : "user",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSignInAt: new Date("2026-01-01T00:00:00.000Z"),
    verifiedOwner: input.verifiedOwner,
    membership: input.status
      ? {
          status: input.status,
          role: "member",
          login: input.verifiedOwner ? "owner" : "member",
          githubId: String(input.id),
          sessionGeneration: 1,
        }
      : undefined,
  };
}

function callerFor(user?: SessionUser) {
  const ctx: TrpcContext = {
    req: new Request("http://localhost/"),
    resHeaders: new Headers(),
    user,
  };
  return createCaller(ctx);
}

const owner = () => callerFor(actor({ id: 7, verifiedOwner: true, status: "approved" }));

const procedures = ["state", "version", "save", "rollback"] as const;

async function invoke(caller: ReturnType<typeof createCaller>, name: (typeof procedures)[number]) {
  if (name === "state") return caller.state();
  if (name === "version") return caller.version({ version: 1 });
  if (name === "save") return caller.save({ body: alpha });
  return caller.rollback({ version: 1 });
}

describe("charter authorization", () => {
  beforeEach(() => harness.reset());

  const denied: Array<{
    name: string;
    user?: SessionUser;
    code: "UNAUTHORIZED" | "FORBIDDEN";
    message: string;
  }> = [
    { name: "signed-out caller", code: "UNAUTHORIZED", message: "Authentication required" },
    {
      name: "pending non-member",
      user: actor({ id: 42, verifiedOwner: false, status: "pending" }),
      code: "FORBIDDEN",
      message: "Access is not approved yet.",
    },
    {
      name: "rejected non-member",
      user: actor({ id: 42, verifiedOwner: false, status: "rejected" }),
      code: "FORBIDDEN",
      message: "Access is not approved yet.",
    },
    {
      name: "revoked non-member",
      user: actor({ id: 42, verifiedOwner: false, status: "revoked" }),
      code: "FORBIDDEN",
      message: "Access is not approved yet.",
    },
    {
      name: "caller with no membership",
      user: actor({ id: 42, verifiedOwner: false }),
      code: "FORBIDDEN",
      message: "Access is not approved yet.",
    },
    {
      name: "approved non-owner",
      user: actor({ id: 42, verifiedOwner: false, status: "approved" }),
      code: "FORBIDDEN",
      message: "Only the owner can view or change the charter.",
    },
  ];

  for (const entry of denied) {
    for (const procedure of procedures) {
      it(`rejects a ${entry.name} calling ${procedure}`, async () => {
        await expect(invoke(callerFor(entry.user), procedure)).rejects.toMatchObject({
          code: entry.code,
          message: entry.message,
        });
        expect(harness.insertCharterVersion).not.toHaveBeenCalled();
        expect(harness.rows).toHaveLength(0);
      });
    }
  }

  it("lets the owner save while membership is still pending", async () => {
    const saved = await callerFor(actor({ id: 7, verifiedOwner: true, status: "pending" })).save({ body: alpha });
    expect(saved.version).toBe(1);
    expect(saved.authorUserId).toBe(7);
    expect(saved.body).toBe(alpha);
  });
});

describe("charter save and rollback", () => {
  beforeEach(() => harness.reset());

  it("versions saves, ignores an identical save, and rolls back by copying forward", async () => {
    const caller = owner();
    const first = await caller.save({ body: `  ${alpha}\r\n` });
    expect(first).toMatchObject({
      unchanged: false,
      version: 1,
      body: alpha,
      authorUserId: 7,
      restoredFromVersion: null,
    });
    const duplicate = await caller.save({ body: alpha });
    expect(duplicate).toMatchObject({ unchanged: true, version: 1, body: alpha });
    expect(harness.rows).toHaveLength(1);

    const second = await caller.save({ body: beta });
    expect(second).toMatchObject({ unchanged: false, version: 2, body: beta, restoredFromVersion: null });

    const restored = await caller.rollback({ version: 1 });
    expect(restored).toMatchObject({
      unchanged: false,
      version: 3,
      body: alpha,
      authorUserId: 7,
      restoredFromVersion: 1,
    });
    const already = await caller.rollback({ version: 3 });
    expect(already).toMatchObject({ unchanged: true, version: 3, body: alpha });
    expect(harness.rows).toHaveLength(3);

    const state = await caller.state();
    expect(state.active?.version).toBe(3);
    expect(state.active?.body).toBe(alpha);
    expect(state.history.map((item) => item.version)).toEqual([3, 2, 1]);
    expect(state.history[0]?.chars).toBe(alpha.length);
    expect(state.history[0]?.restoredFromVersion).toBe(1);

    const viewed = await caller.version({ version: 2 });
    expect(viewed.body).toBe(beta);
    await expect(caller.rollback({ version: 9 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "That charter version does not exist.",
    });
    await expect(caller.save({ body: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Charter text is empty.",
    });
    await expect(caller.save({ body: "n".repeat(40_001) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Charter text must be 40,000 characters or fewer.",
    });
    expect(harness.rows).toHaveLength(3);
  });

  it("retries once when a version number is taken", async () => {
    const caller = owner();
    await caller.save({ body: alpha });
    harness.armConflict();
    const saved = await caller.save({ body: beta });
    expect(saved).toMatchObject({ unchanged: false, version: 3, body: beta });
    expect(harness.rows.map((row) => [row.version, row.body])).toEqual([
      [1, alpha],
      [2, "Concurrent placeholder."],
      [3, beta],
    ]);
  });
});
