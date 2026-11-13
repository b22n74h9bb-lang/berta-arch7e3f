/** Local continuity ledger for one device.
 * Text records only. No encryption, no server sync, no external execution.
 */

export const LEDGER_VERSION = 1;
export const LEDGER_BYTE_CAP = 1_500_000;
export const LAST_ACCOUNT_KEY = "berta.offline.lastAccount";

export type RecordStatus = "todo" | "active" | "done" | "blocked";
export type SyncState = "pending" | "acked" | "conflict" | "held";
export type ConflictReason = "edit-vs-edit" | "edit-vs-delete" | "stale-revision" | "out-of-order";

export type LocalRecord = {
  id: string;
  accountId: string;
  kind: "task" | "note";
  title: string;
  body: string;
  status: RecordStatus;
  revision: number;
  deleted: boolean;
  updatedAt: string;
};

export type Operation = {
  id: string;
  accountId: string;
  recordId: string;
  kind: "upsert" | "delete";
  baseRevision: number;
  title: string;
  body: string;
  status: RecordStatus;
  createdAt: string;
};

export type OutboxItem = {
  operation: Operation;
  state: "pending" | "conflict";
  attempts: number;
  reason?: ConflictReason;
};

export type HeldAction = {
  id: string;
  accountId: string;
  kind: "publish" | "permission" | "purchase" | "external";
  payload: string;
  state: "held";
  createdAt: string;
};

export type Conflict = {
  recordId: string;
  operationId: string;
  accountId: string;
  reason: ConflictReason;
};

export type Ack = { id: string; accountId: string };

export type Ledger = {
  version: typeof LEDGER_VERSION;
  records: LocalRecord[];
  outbox: OutboxItem[];
  held: HeldAction[];
  conflicts: Conflict[];
  acked: Ack[];
};

export type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function emptyLedger(): Ledger {
  return { version: LEDGER_VERSION, records: [], outbox: [], held: [], conflicts: [], acked: [] };
}

function isAcked(ledger: Ledger, operationId: string): boolean {
  return ledger.acked.some((ack) => ack.id === operationId);
}

export function storageKey(accountId: string): string {
  return `berta.offline.v1.${encodeURIComponent(accountId)}`;
}

export function serializeLedger(ledger: Ledger): string {
  return JSON.stringify(ledger);
}

export function restoreLedger(raw: string): { ok: true; ledger: Ledger } | { ok: false; reason: "corrupt" | "version" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "corrupt" };
  const version = (parsed as { version?: unknown }).version;
  if (version !== LEDGER_VERSION) return { ok: false, reason: "version" };
  const candidate = parsed as Partial<Ledger>;
  if (!Array.isArray(candidate.records) || !Array.isArray(candidate.outbox) || !Array.isArray(candidate.held) || !Array.isArray(candidate.conflicts) || !Array.isArray(candidate.acked)) {
    return { ok: false, reason: "corrupt" };
  }
  return {
    ok: true,
    ledger: {
      version: LEDGER_VERSION,
      records: candidate.records,
      outbox: candidate.outbox,
      held: candidate.held,
      conflicts: candidate.conflicts,
      acked: candidate.acked,
    },
  };
}

export function listRecords(ledger: Ledger, accountId: string): LocalRecord[] {
  return ledger.records.filter((record) => record.accountId === accountId && !record.deleted);
}

export function recordSyncState(ledger: Ledger, recordId: string): SyncState | "local" {
  const items = ledger.outbox.filter((entry) => entry.operation.recordId === recordId);
  if (items.some((entry) => entry.state === "conflict")) return "conflict";
  if (items.some((entry) => entry.state === "pending")) return "pending";
  if (ledger.conflicts.some((conflict) => conflict.recordId === recordId)) return "conflict";
  if (ledger.records.some((record) => record.id === recordId)) return "acked";
  return "local";
}

export function applyLocal(ledger: Ledger, operation: Operation, byteCap = LEDGER_BYTE_CAP): { ok: true; ledger: Ledger; duplicate: boolean } | { ok: false; ledger: Ledger; reason: "full" | "invalid" } {
  if (!operation.id || !operation.accountId || !operation.recordId) {
    return { ok: false, ledger, reason: "invalid" };
  }
  if (operation.kind === "upsert" && operation.title.trim().length < 3) {
    return { ok: false, ledger, reason: "invalid" };
  }
  if (isAcked(ledger, operation.id) || ledger.outbox.some((entry) => entry.operation.id === operation.id)) {
    return { ok: true, ledger, duplicate: true };
  }

  const current = ledger.records.find((record) => record.id === operation.recordId);
  let reason: ConflictReason | undefined;
  if (current && current.accountId !== operation.accountId) {
    reason = "stale-revision";
  } else if (current?.deleted && operation.kind === "upsert") {
    reason = "edit-vs-delete";
  } else if (current && current.revision !== operation.baseRevision) {
    reason = "stale-revision";
  } else if (!current && operation.baseRevision !== 0) {
    reason = "out-of-order";
  }

  const next = reason
    ? {
        ...ledger,
        outbox: [...ledger.outbox, { operation, state: "conflict" as const, attempts: 0, reason }],
        conflicts: [...ledger.conflicts, { recordId: operation.recordId, operationId: operation.id, accountId: operation.accountId, reason }],
      }
    : {
        ...ledger,
        records: upsertRecord(ledger.records, operation),
        outbox: [...ledger.outbox, { operation, state: "pending" as const, attempts: 0 }],
      };

  if (serializeLedger(next).length > byteCap) return { ok: false, ledger, reason: "full" };
  return { ok: true, ledger: next, duplicate: false };
}

export function acknowledge(ledger: Ledger, operationId: string): Ledger {
  const item = ledger.outbox.find((entry) => entry.operation.id === operationId);
  if (!item) return ledger;
  if (item.state === "conflict") return ledger;
  return {
    ...ledger,
    outbox: ledger.outbox.filter((entry) => entry.operation.id !== operationId),
    acked: isAcked(ledger, operationId) ? ledger.acked : [...ledger.acked, { id: operationId, accountId: item.operation.accountId }],
  };
}

export function markRetry(ledger: Ledger, operationId: string): Ledger {
  const item = ledger.outbox.find((entry) => entry.operation.id === operationId && entry.state === "pending");
  if (!item) return ledger;
  return {
    ...ledger,
    outbox: ledger.outbox.map((entry) => entry.operation.id === operationId ? { ...entry, attempts: entry.attempts + 1 } : entry),
  };
}

export function receiveRemote(ledger: Ledger, remote: LocalRecord): { ledger: Ledger; outcome: "adopted" | "ignored-stale" | "conflict" } {
  const local = ledger.records.find((record) => record.id === remote.id);
  if (local && local.accountId !== remote.accountId) {
    return { ledger, outcome: "conflict" };
  }
  const pending = ledger.outbox.some((entry) => entry.operation.recordId === remote.id && entry.state === "pending");
  if (pending && local) {
    const changed = local.title !== remote.title || local.body !== remote.body || local.deleted !== remote.deleted;
    if (!changed && remote.revision <= local.revision) return { ledger, outcome: "ignored-stale" };
    const reason: ConflictReason = remote.deleted ? "edit-vs-delete" : "edit-vs-edit";
    return {
      ledger: {
        ...ledger,
        conflicts: ledger.conflicts.some((conflict) => conflict.recordId === remote.id && conflict.reason === reason)
          ? ledger.conflicts
          : [...ledger.conflicts, { recordId: remote.id, operationId: remote.id, accountId: remote.accountId, reason }],
      },
      outcome: "conflict",
    };
  }
  if (local && remote.revision < local.revision) return { ledger, outcome: "ignored-stale" };
  if (local && remote.revision === local.revision) return { ledger, outcome: "ignored-stale" };
  const records = local
    ? ledger.records.map((record) => record.id === remote.id ? remote : record)
    : [...ledger.records, remote];
  return { ledger: { ...ledger, records }, outcome: "adopted" };
}

export function holdAction(ledger: Ledger, action: HeldAction, byteCap = LEDGER_BYTE_CAP): { ok: true; ledger: Ledger; duplicate: boolean } | { ok: false; ledger: Ledger; reason: "full" | "invalid" } {
  if (!action.id || !action.accountId || !action.payload.trim()) return { ok: false, ledger, reason: "invalid" };
  if (ledger.held.some((held) => held.id === action.id)) return { ok: true, ledger, duplicate: true };
  const next: Ledger = { ...ledger, held: [...ledger.held, { ...action, state: "held" }] };
  if (serializeLedger(next).length > byteCap) return { ok: false, ledger, reason: "full" };
  return { ok: true, ledger: next, duplicate: false };
}

export function reconnect(ledger: Ledger): { toSend: Operation[]; held: HeldAction[] } {
  return {
    toSend: ledger.outbox.filter((entry) => entry.state === "pending").map((entry) => entry.operation),
    held: ledger.held.filter((action) => action.state === "held"),
  };
}

export function exportAccount(ledger: Ledger, accountId: string): Ledger {
  return {
    version: LEDGER_VERSION,
    records: ledger.records.filter((record) => record.accountId === accountId),
    outbox: ledger.outbox.filter((entry) => entry.operation.accountId === accountId),
    held: ledger.held.filter((action) => action.accountId === accountId),
    conflicts: ledger.conflicts.filter((conflict) => conflict.accountId === accountId),
    acked: ledger.acked.filter((ack) => ack.accountId === accountId),
  };
}

export function loadAccount(store: Store, accountId: string): { ledger: Ledger; problem: null | "corrupt" | "version" } {
  let raw: string | null;
  try {
    raw = store.getItem(storageKey(accountId));
  } catch {
    return { ledger: emptyLedger(), problem: "corrupt" };
  }
  if (raw == null || raw === "") return { ledger: emptyLedger(), problem: null };
  const restored = restoreLedger(raw);
  if (!restored.ok) return { ledger: emptyLedger(), problem: restored.reason };
  return { ledger: restored.ledger, problem: null };
}

export function commitAccount(store: Store, accountId: string, ledger: Ledger): { ok: true } | { ok: false; reason: "full" } {
  const raw = serializeLedger(ledger);
  if (raw.length > LEDGER_BYTE_CAP) return { ok: false, reason: "full" };
  try {
    store.setItem(storageKey(accountId), raw);
  } catch {
    return { ok: false, reason: "full" };
  }
  return { ok: true };
}

export function readLastAccount(store: Store): string | null {
  try {
    const value = store.getItem(LAST_ACCOUNT_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function writeLastAccount(store: Store, accountId: string): void {
  if (!accountId.trim()) return;
  try {
    store.setItem(LAST_ACCOUNT_KEY, accountId);
  } catch {
    /* The notes themselves still live under their account key. */
  }
}

export function clearLastAccount(store: Store): void {
  try {
    store.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    /* Logout still proceeds. The account key remains unread without this pointer. */
  }
}

function upsertRecord(records: LocalRecord[], operation: Operation): LocalRecord[] {
  const next: LocalRecord = {
    id: operation.recordId,
    accountId: operation.accountId,
    kind: "note",
    title: operation.title,
    body: operation.body,
    status: operation.status,
    revision: operation.baseRevision + 1,
    deleted: operation.kind === "delete",
    updatedAt: operation.createdAt,
  };
  const index = records.findIndex((record) => record.id === operation.recordId);
  if (index === -1) return [...records, next];
  return records.map((record) => record.id === operation.recordId ? next : record);
}
