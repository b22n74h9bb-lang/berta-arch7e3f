/** Local continuity ledger for one device.
 * Text records only. No encryption, no server sync, no external execution.
 */

export const LEDGER_VERSION = 1;
export const LEDGER_BYTE_CAP = 1_500_000;
export const LAST_ACCOUNT_KEY = "berta.offline.lastAccount";

export type RecordStatus = "todo" | "active" | "done" | "blocked";
export type SyncState = "pending" | "acked" | "conflict" | "held";
export type ConflictReason = "edit-vs-edit" | "edit-vs-delete" | "stale-revision" | "out-of-order" | "account";
export const SEALED_PREFIX = "enc:v1:";

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

  if (byteLength(serializeLedger(next)) > byteCap) return { ok: false, ledger, reason: "full" };
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
    return { ledger: addConflict(ledger, remote, "account"), outcome: "conflict" };
  }
  if (local && remote.revision < local.revision) return { ledger, outcome: "ignored-stale" };
  if (local && remote.revision === local.revision) return { ledger, outcome: "ignored-stale" };
  const pending = ledger.outbox.some((entry) => entry.operation.recordId === remote.id && entry.state === "pending");
  if (local && (pending || remote.revision > local.revision)) {
    const changed = local.title !== remote.title || local.body !== remote.body || local.status !== remote.status || local.deleted !== remote.deleted;
    if (changed) {
      const reason: ConflictReason = remote.deleted || local.deleted ? "edit-vs-delete" : "edit-vs-edit";
      return { ledger: addConflict(ledger, remote, reason), outcome: "conflict" };
    }
  }
  const records = local
    ? ledger.records.map((record) => record.id === remote.id ? remote : record)
    : [...ledger.records, remote];
  return { ledger: { ...ledger, records }, outcome: "adopted" };
}

export function holdAction(ledger: Ledger, action: HeldAction, byteCap = LEDGER_BYTE_CAP): { ok: true; ledger: Ledger; duplicate: boolean } | { ok: false; ledger: Ledger; reason: "full" | "invalid" } {
  if (!action.id || !action.accountId || !action.payload.trim()) return { ok: false, ledger, reason: "invalid" };
  if (ledger.held.some((held) => held.id === action.id)) return { ok: true, ledger, duplicate: true };
  const next: Ledger = { ...ledger, held: [...ledger.held, { ...action, state: "held" }] };
  if (byteLength(serializeLedger(next)) > byteCap) return { ok: false, ledger, reason: "full" };
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

export function loadAccount(store: Store, accountId: string): { ledger: Ledger; problem: null | "corrupt" | "version" | "sealed" } {
  let raw: string | null;
  try {
    raw = store.getItem(storageKey(accountId));
  } catch {
    return { ledger: emptyLedger(), problem: "corrupt" };
  }
  if (raw == null || raw === "") return { ledger: emptyLedger(), problem: null };
  if (raw.startsWith(SEALED_PREFIX)) return { ledger: emptyLedger(), problem: "sealed" };
  const restored = restoreLedger(raw);
  if (!restored.ok) return { ledger: emptyLedger(), problem: restored.reason };
  return { ledger: restored.ledger, problem: null };
}

export function commitAccount(store: Store, accountId: string, ledger: Ledger): { ok: true } | { ok: false; reason: "full" | "account" } {
  if (ledgerHasForeign(ledger, accountId)) return { ok: false, reason: "account" };
  const raw = serializeLedger(ledger);
  if (byteLength(raw) > LEDGER_BYTE_CAP) return { ok: false, reason: "full" };
  try {
    store.setItem(storageKey(accountId), raw);
  } catch {
    return { ok: false, reason: "full" };
  }
  return { ok: true };
}

export async function sealLedger(json: string, passphrase: string, iterations = 20_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json)));
  const packed = new Uint8Array(salt.length + iv.length + cipher.length);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(cipher, salt.length + iv.length);
  return `${SEALED_PREFIX}${iterations}:${bytesToB64(packed)}`;
}

export async function openLedger(payload: string, passphrase: string): Promise<string> {
  if (!payload.startsWith(SEALED_PREFIX)) throw new Error("not sealed");
  const body = payload.slice(SEALED_PREFIX.length);
  const split = body.indexOf(":");
  const iterations = Number(body.slice(0, split));
  const packed = b64ToBytes(body.slice(split + 1));
  if (!Number.isInteger(iterations) || iterations < 1 || packed.length < 29) throw new Error("corrupt");
  const salt = packed.slice(0, 16);
  const iv = packed.slice(16, 28);
  const cipher = packed.slice(28);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("passphrase");
  }
}

export async function commitSealed(store: Store, accountId: string, ledger: Ledger, passphrase: string, iterations = 20_000): Promise<{ ok: true } | { ok: false; reason: "full" | "account" | "invalid" }> {
  if (!passphrase.trim()) return { ok: false, reason: "invalid" };
  if (ledgerHasForeign(ledger, accountId)) return { ok: false, reason: "account" };
  const sealed = await sealLedger(serializeLedger(ledger), passphrase, iterations);
  if (byteLength(sealed) > LEDGER_BYTE_CAP) return { ok: false, reason: "full" };
  try {
    store.setItem(storageKey(accountId), sealed);
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function ledgerHasForeign(ledger: Ledger, accountId: string): boolean {
  return ledger.records.some((record) => record.accountId !== accountId)
    || ledger.outbox.some((entry) => entry.operation.accountId !== accountId)
    || ledger.held.some((action) => action.accountId !== accountId)
    || ledger.conflicts.some((conflict) => conflict.accountId !== accountId)
    || ledger.acked.some((ack) => ack.accountId !== accountId);
}

function addConflict(ledger: Ledger, remote: LocalRecord, reason: ConflictReason): Ledger {
  if (ledger.conflicts.some((conflict) => conflict.recordId === remote.id && conflict.reason === reason)) return ledger;
  return {
    ...ledger,
    conflicts: [...ledger.conflicts, { recordId: remote.id, operationId: remote.id, accountId: remote.accountId, reason }],
  };
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: copyBuffer(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
