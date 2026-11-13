import { useRef, useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import { applyLocal, commitAccount, commitSealed, holdAction, listRecords, loadAccount, openLedger, recordSyncState, restoreLedger, type Ledger } from "../offline/continuity";

const stateLabel: Record<ReturnType<typeof recordSyncState>, string> = {
  local: "ON DEVICE", pending: "ON DEVICE", acked: "ACKNOWLEDGED", conflict: "CONFLICT", held: "HELD",
};

export function OfflineCapture({ accountId }: { accountId: string }) {
  const key = accountId;
  const [initial] = useState(() => read(key));
  const [ledger, setLedger] = useState<Ledger>(initial.ledger);
  const ledgerRef = useRef(initial.ledger);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(initial.problem);
  const [title, setTitle] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const notes = listRecords(ledger, key);
  const held = ledger.held.filter((action) => action.accountId === key);

  async function save(next: Ledger): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const secret = passphrase.trim();
      const store = window.localStorage;
      const stored = secret
        ? await commitSealed(store, key, next, secret)
        : commitAccount(store, key, next);
      if (!stored.ok) {
        setNotice(stored.reason === "account"
          ? "That note belongs to another account and was not saved."
          : stored.reason === "full"
            ? "This device store is full. The note was not saved."
            : "Set a passphrase before sealing this store.");
        return false;
      }
      ledgerRef.current = next;
      setLedger(next);
      setProblem(null);
      setNotice(secret ? null : "Saved on this device without encryption.");
      return true;
    } catch {
      setNotice("The note could not be saved. Your draft has been kept. Please retry.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function submitNote(): Promise<void> {
    if (savingRef.current || problem) return;
    const submittedTitle = title;
    const trimmed = submittedTitle.trim();
    if (trimmed.length < 3) return;
    const result = applyLocal(ledgerRef.current, {
      id: crypto.randomUUID(), accountId: key, recordId: crypto.randomUUID(),
      kind: "upsert", baseRevision: 0, title: trimmed, body: "",
      status: "todo", createdAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setNotice(result.reason === "full" ? "This device store is full. The note was not saved." : "That note could not be saved.");
      return;
    }
    if (await save(result.ledger)) {
      setTitle((current) => current === submittedTitle ? "" : current);
    }
  }

  async function unlock(): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const raw = window.localStorage.getItem(`berta.offline.v1.${encodeURIComponent(key)}`);
      if (!raw || !passphrase.trim()) {
        setNotice("Enter the passphrase for this device.");
        return;
      }
      const restored = restoreLedger(await openLedger(raw, passphrase.trim()));
      if (!restored.ok) {
        setNotice("The decrypted store could not be read.");
        return;
      }
      ledgerRef.current = restored.ledger;
      setLedger(restored.ledger);
      setProblem(null);
      setNotice(null);
    } catch {
      setNotice("The store could not be opened. Check the passphrase and storage access.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="data-section" aria-label="Offline notes">
      <div className="section-heading">
        <div><span className="micro-label">ON THIS IPHONE</span><h2>Offline notes</h2></div>
        <span className="quiet-meta">{notes.length} LOCAL</span>
      </div>
      <p className="section-description">These notes stay on this device and survive a reload. They are not the server mission, chat, or AI. Without a passphrase they are not encrypted. A publish stays held until a person approves it. Reconnect does not send it.</p>
      {problem && <p className="offline-banner" role="alert">{problem === "sealed" ? "These notes are encrypted. Enter the passphrase to open them. Nothing was overwritten." : `The local store was rejected (${problem}). Nothing was overwritten.`}</p>}
      {problem === "sealed" && <button type="button" className="button button--secondary" disabled={saving} onClick={() => void unlock()}>Open encrypted notes</button>}
      {notice && <p className="offline-banner" role="status">{notice}</p>}
      <div className="task-list">
        {notes.map((note) => {
          const state = recordSyncState(ledger, note.id);
          return <article className="offline-note" key={note.id}><span className={`sync-pill is-${state}`}>{stateLabel[state]}</span><h3>{note.title}</h3></article>;
        })}
        {ledger.conflicts.filter((conflict) => conflict.accountId === key).map((conflict) => <p className="offline-banner" key={conflict.operationId} role="status">Conflict on {conflict.recordId}: {conflict.reason}. The local note was kept.</p>)}
      </div>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void submitNote(); }}>
        <label htmlFor="offline-passphrase" className="sr-only">Device passphrase</label>
        <input id="offline-passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="Passphrase to encrypt notes on this device" autoComplete="new-password" disabled={saving} />
        <label htmlFor="offline-note" className="sr-only">New offline note</label>
        <input id="offline-note" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a note that stays on this iPhone" maxLength={500} />
        <button type="submit" className="button button--primary" disabled={saving || title.trim().length < 3 || Boolean(problem)}><Plus size={17} />{saving ? "Saving…" : "Save on device"}</button>
      </form>
      <button type="button" className="button button--secondary offline-hold" disabled={saving || Boolean(problem)} onClick={() => {
        if (savingRef.current || problem) return;
        const result = holdAction(ledgerRef.current, { id: crypto.randomUUID(), accountId: key, kind: "publish", payload: title.trim() || "unpublished local note", state: "held", createdAt: new Date().toISOString() });
        if (!result.ok) { setNotice("The publish could not be held."); return; }
        void save(result.ledger);
      }}><ShieldAlert size={16} />Hold a publish</button>
      {held.length > 0 && <p className="quiet-meta">{held.length} publish{held.length === 1 ? "" : "es"} held. Reconnect will not send them.</p>}
    </section>
  );
}

function read(accountId: string): { ledger: Ledger; problem: null | "corrupt" | "version" | "sealed" } {
  if (typeof window === "undefined") return { ledger: loadAccount(memoryFallback(), accountId).ledger, problem: null };
  try { return loadAccount(window.localStorage, accountId); }
  catch { return { ledger: loadAccount(memoryFallback(), accountId).ledger, problem: "corrupt" }; }
}

function memoryFallback(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}
