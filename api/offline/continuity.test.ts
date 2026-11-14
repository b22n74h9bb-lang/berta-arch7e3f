import { describe, expect, it } from "vitest";
import {
  LEDGER_VERSION,
  acknowledge,
  applyLocal,
  commitAccount,
  commitSealed,
  emptyLedger,
  exportAccount,
  holdAction,
  listRecords,
  loadAccount,
  markRetry,
  openLedger,
  receiveRemote,
  reconnect,
  recordSyncState,
  restoreLedger,
  type HeldAction,
  type LocalRecord,
  type Operation,
  type Store,
} from "../../src/offline/continuity";

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    accountId: "account-a",
    recordId: "note-1",
    kind: "upsert",
    baseRevision: 0,
    title: "Capture the offline note",
    body: "Written on the phone",
    status: "todo",
    createdAt: "2026-11-13T02:00:00.000Z",
    ...overrides,
  };
}

function remote(overrides: Partial<LocalRecord> = {}): LocalRecord {
  return {
    id: "note-1",
    accountId: "account-a",
    kind: "note",
    title: "Server copy",
    body: "From the other side",
    status: "todo",
    revision: 1,
    deleted: false,
    updatedAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function held(overrides: Partial<HeldAction> = {}): HeldAction {
  return {
    id: "hold-1",
    accountId: "account-a",
    kind: "publish",
    payload: "publish-draft-v1",
    state: "held",
    createdAt: "2026-11-13T02:00:00.000Z",
    ...overrides,
  };
}

function memoryStore(seed: Record<string, string> = {}): Store & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("offline continuity ledger", () => {
  it("keeps a note across a reload of the same store", () => {
    const store = memoryStore();
    const applied = applyLocal(emptyLedger(), operation());
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(commitAccount(store, "account-a", applied.ledger).ok).toBe(true);
    const loaded = loadAccount(store, "account-a");
    expect(loaded.problem).toBeNull();
    expect(listRecords(loaded.ledger, "account-a").map((record) => record.title)).toEqual(["Capture the offline note"]);
    expect(loaded.ledger.records[0]?.revision).toBe(1);
  });

  it("hides one account's notes from another account", () => {
    const first = applyLocal(emptyLedger(), operation());
    if (!first.ok) throw new Error("apply failed");
    const second = applyLocal(first.ledger, operation({
      id: "op-b",
      accountId: "account-b",
      recordId: "note-b",
      title: "Berta's other account",
    }));
    if (!second.ok) throw new Error("apply failed");
    expect(listRecords(second.ledger, "account-a").map((record) => record.title)).toEqual(["Capture the offline note"]);
    expect(listRecords(second.ledger, "account-b").map((record) => record.title)).toEqual(["Berta's other account"]);
    const exported = JSON.stringify(exportAccount(second.ledger, "account-a"));
    expect(exported).not.toContain("account-b");
    expect(exported).not.toContain("Berta's other account");
  });

  it("applies one operation id only once, including after it is acknowledged", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const retried = applyLocal(created.ledger, operation({ title: "A mutated retry" }));
    expect(retried.ok && retried.duplicate).toBe(true);
    if (!retried.ok) return;
    expect(listRecords(retried.ledger, "account-a")).toHaveLength(1);
    expect(listRecords(retried.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
    const acked = acknowledge(retried.ledger, "op-1");
    expect(recordSyncState(acked, "note-1")).toBe("acked");
    const afterAck = applyLocal(acked, operation({ title: "Lost ack replay" }));
    expect(afterAck.ok && afterAck.duplicate).toBe(true);
    if (!afterAck.ok) return;
    expect(listRecords(afterAck.ledger, "account-a")).toHaveLength(1);
    expect(reconnect(afterAck.ledger).toSend).toEqual([]);
  });

  it("counts a retry without creating a second record", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const retried = markRetry(created.ledger, "op-1");
    expect(retried.outbox[0]?.attempts).toBe(1);
    expect(listRecords(retried, "account-a")).toHaveLength(1);
    expect(reconnect(retried).toSend.map((item) => item.id)).toEqual(["op-1"]);
    expect(reconnect(retried).toSend.map((item) => item.id)).toEqual(["op-1"]);
  });

  it("keeps the local note when a remote copy is older, even if its clock is ahead", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const edited = applyLocal(acknowledge(created.ledger, "op-1"), operation({
      id: "op-2",
      baseRevision: 1,
      title: "Local revision two",
      createdAt: "2026-11-13T02:05:00.000Z",
    }));
    if (!edited.ok) throw new Error("apply failed");
    const acked = acknowledge(edited.ledger, "op-2");
    const stale = receiveRemote(acked, remote({ revision: 1, updatedAt: "2099-01-01T00:00:00.000Z", title: "Stale server title" }));
    expect(stale.outcome).toBe("ignored-stale");
    expect(listRecords(stale.ledger, "account-a")[0]?.title).toBe("Local revision two");
  });

  it("surfaces an edit against a concurrent remote edit and a remote delete", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const concurrent = receiveRemote(created.ledger, remote({ revision: 2, title: "Someone else edited" }));
    expect(concurrent.outcome).toBe("conflict");
    expect(listRecords(concurrent.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
    expect(concurrent.ledger.conflicts.map((conflict) => conflict.reason)).toContain("edit-vs-edit");

    const deleted = receiveRemote(created.ledger, remote({ revision: 2, deleted: true, title: "Capture the offline note" }));
    expect(deleted.outcome).toBe("conflict");
    expect(deleted.ledger.conflicts.map((conflict) => conflict.reason)).toContain("edit-vs-delete");
    expect(listRecords(deleted.ledger, "account-a")).toHaveLength(1);
  });

  it("rejects a stale or out-of-order local revision without changing the note", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const stale = applyLocal(created.ledger, operation({ id: "op-stale", baseRevision: 0, title: "Overwrite from zero" }));
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(listRecords(stale.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
    expect(stale.ledger.conflicts.map((conflict) => conflict.reason)).toContain("stale-revision");
    expect(recordSyncState(stale.ledger, "note-1")).toBe("conflict");

    const skipped = applyLocal(emptyLedger(), operation({ id: "op-gap", baseRevision: 4 }));
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(listRecords(skipped.ledger, "account-a")).toEqual([]);
    expect(skipped.ledger.conflicts[0]?.reason).toBe("out-of-order");
  });

  it("holds a publish across reconnect and ignores a second payload with the same id", () => {
    const queued = holdAction(emptyLedger(), held());
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const changed = holdAction(queued.ledger, held({ payload: "publish-draft-v2" }));
    expect(changed.ok && changed.duplicate).toBe(true);
    if (!changed.ok) return;
    const session = reconnect(changed.ledger);
    expect(session.toSend).toEqual([]);
    expect(session.held.map((action) => action.payload)).toEqual(["publish-draft-v1"]);
    expect(session.held[0]?.state).toBe("held");
  });

  it("refuses a write that would pass the byte cap and leaves the store unchanged", () => {
    const created = applyLocal(emptyLedger(), operation(), 80);
    expect(created).toEqual({ ok: false, ledger: emptyLedger(), reason: "full" });
  });

  it("keeps a confirmed note when a later remote edit arrives", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const acked = acknowledge(created.ledger, "op-1");
    const later = receiveRemote(acked, remote({ revision: 4, title: "Someone else edited" }));
    expect(later.outcome).toBe("conflict");
    expect(listRecords(later.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
    expect(later.ledger.conflicts.map((conflict) => conflict.reason)).toContain("edit-vs-edit");
  });

  it("records an account mismatch instead of adopting the other account", () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const clash = receiveRemote(created.ledger, remote({ accountId: "account-b", title: "Other account" }));
    expect(clash.outcome).toBe("conflict");
    expect(clash.ledger.conflicts[0]?.reason).toBe("account");
    expect(listRecords(clash.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
  });

  it("refuses to save one account's ledger under another account", () => {
    const first = applyLocal(emptyLedger(), operation());
    if (!first.ok) throw new Error("apply failed");
    const second = applyLocal(first.ledger, operation({
      id: "op-b",
      accountId: "account-b",
      recordId: "note-b",
      title: "Other account note",
    }));
    if (!second.ok) throw new Error("apply failed");
    const store = memoryStore();
    expect(commitAccount(store, "account-a", second.ledger)).toEqual({ ok: false, reason: "account" });
    expect(store.data).toEqual({});
  });

  it("seals the ledger so the title is not readable without the passphrase", async () => {
    const created = applyLocal(emptyLedger(), operation());
    if (!created.ok) throw new Error("apply failed");
    const store = memoryStore();
    const sealed = await commitSealed(store, "account-a", created.ledger, "correct horse", 1_000);
    expect(sealed.ok).toBe(true);
    const raw = store.data["berta.offline.v1.account-a"] ?? "";
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect(raw).not.toContain("Capture the offline note");
    expect(loadAccount(store, "account-a").problem).toBe("sealed");
    const opened = restoreLedger(await openLedger(raw, "correct horse"));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(listRecords(opened.ledger, "account-a")[0]?.title).toBe("Capture the offline note");
    await expect(openLedger(raw, "wrong passphrase")).rejects.toThrow("passphrase");
  });

  it("rejects a corrupt import and a version mismatch without a partial ledger", () => {
    expect(restoreLedger("{")).toEqual({ ok: false, reason: "corrupt" });
    expect(restoreLedger(JSON.stringify({ version: 99, records: [{ id: "x" }] }))).toEqual({ ok: false, reason: "version" });
    const store = memoryStore();
    store.setItem("berta.offline.v1.account-a", "{not-json");
    const loaded = loadAccount(store, "account-a");
    expect(loaded.problem).toBe("corrupt");
    expect(loaded.ledger.records).toEqual([]);
    expect(store.data["berta.offline.v1.account-a"]).toBe("{not-json");
    expect(LEDGER_VERSION).toBe(1);
  });
});
