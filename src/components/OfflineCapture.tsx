import { useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import {
  applyLocal,
  commitAccount,
  holdAction,
  listRecords,
  loadAccount,
  recordSyncState,
  type Ledger,
} from "../offline/continuity";

const stateLabel: Record<ReturnType<typeof recordSyncState>, string> = {
  local: "ON DEVICE",
  pending: "PENDING SYNC",
  acked: "ACKNOWLEDGED",
  conflict: "CONFLICT",
  held: "HELD",
};

export function OfflineCapture({ accountId }: { accountId: string }) {
  const key = accountId;
  const initial = read(key);
  const [ledger, setLedger] = useState<Ledger>(initial.ledger);
  const problem = initial.problem;
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const notes = listRecords(ledger, key);
  const held = ledger.held.filter((action) => action.accountId === key);

  function save(next: Ledger) {
    const stored = commitAccount(window.localStorage, key, next);
    if (!stored.ok) {
      setNotice("This device store is full. The note was not saved.");
      return;
    }
    setLedger(next);
    setNotice(null);
  }

  return (
    <section className="data-section" aria-label="Offline notes">
      <div className="section-heading">
        <div>
          <span className="micro-label">ON THIS IPHONE</span>
          <h2>Offline notes</h2>
        </div>
        <span className="quiet-meta">{notes.length} LOCAL</span>
      </div>
      <p className="section-description">
        These notes stay on this device and survive a reload. They are not the server mission, chat, or AI. A publish stays held until a person approves it. Reconnect does not send it.
      </p>
      {problem && (
        <p className="offline-banner" role="alert">
          The local store was rejected ({problem}). Nothing was overwritten.
        </p>
      )}
      {notice && <p className="offline-banner" role="status">{notice}</p>}
      <div className="task-list">
        {notes.map((note) => {
          const state = recordSyncState(ledger, note.id);
          return (
            <article className="offline-note" key={note.id}>
              <span className={`sync-pill is-${state}`}>{stateLabel[state]}</span>
              <h3>{note.title}</h3>
            </article>
          );
        })}
        {ledger.conflicts.filter((conflict) => conflict.accountId === key).map((conflict) => (
          <p className="offline-banner" key={conflict.operationId} role="status">
            Conflict on {conflict.recordId}: {conflict.reason}. The local note was kept.
          </p>
        ))}
      </div>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (trimmed.length < 3 || problem) return;
          const result = applyLocal(ledger, {
            id: crypto.randomUUID(),
            accountId: key,
            recordId: crypto.randomUUID(),
            kind: "upsert",
            baseRevision: 0,
            title: trimmed,
            body: "",
            status: "todo",
            createdAt: new Date().toISOString(),
          });
          if (!result.ok) {
            setNotice(result.reason === "full" ? "This device store is full. The note was not saved." : "That note could not be saved.");
            return;
          }
          save(result.ledger);
          setTitle("");
        }}
      >
        <label htmlFor="offline-note" className="sr-only">New offline note</label>
        <input
          id="offline-note"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a note that stays on this iPhone"
          maxLength={500}
        />
        <button type="submit" className="button button--primary" disabled={title.trim().length < 3 || Boolean(problem)}>
          <Plus size={17} /> Save on device
        </button>
      </form>
      <button
        type="button"
        className="button button--secondary offline-hold"
        disabled={Boolean(problem)}
        onClick={() => {
          const result = holdAction(ledger, {
            id: crypto.randomUUID(),
            accountId: key,
            kind: "publish",
            payload: title.trim() || "unpublished local note",
            state: "held",
            createdAt: new Date().toISOString(),
          });
          if (!result.ok) {
            setNotice("The publish could not be held.");
            return;
          }
          save(result.ledger);
        }}
      >
        <ShieldAlert size={16} /> Hold a publish
      </button>
      {held.length > 0 && (
        <p className="quiet-meta">{held.length} publish{held.length === 1 ? "" : "es"} held. Reconnect will not send them.</p>
      )}
    </section>
  );
}

function read(accountId: string): { ledger: Ledger; problem: null | "corrupt" | "version" } {
  if (typeof window === "undefined") return { ledger: loadAccount(memoryFallback(), accountId).ledger, problem: null };
  return loadAccount(window.localStorage, accountId);
}

function memoryFallback(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}
