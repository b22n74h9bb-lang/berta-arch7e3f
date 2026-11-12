import { useEffect, useRef, useState } from "react";
import { RotateCcw, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { CHARTER_MAX_CHARS, normalizeCharterBody } from "@contracts/charter";
import { trpc } from "@/providers/trpc";

function formatWhen(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function CharterPanel() {
  const utils = trpc.useUtils();
  const state = trpc.berta.charter.state.useQuery(undefined, { refetchOnWindowFocus: false });
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const seenVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = trpc.berta.charter.version.useQuery(
    { version: previewVersion ?? 1 },
    { enabled: previewVersion !== null, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (!state.data || dirty || previewVersion !== null) return;
    const version = state.data.active?.version ?? 0;
    if (version < seenVersion.current) return;
    seenVersion.current = version;
    setDraft(state.data.active?.body ?? "");
  }, [dirty, previewVersion, state.data]);

  useEffect(() => {
    if (previewVersion === null || dirty || !preview.data) return;
    if (preview.data.version !== previewVersion) return;
    setDraft(preview.data.body);
  }, [dirty, preview.data, previewVersion]);

  const save = trpc.berta.charter.save.useMutation({
    onSuccess: async (saved) => {
      seenVersion.current = saved.version;
      setPreviewVersion(null);
      setDirty(false);
      setDraft(saved.body);
      await utils.berta.charter.state.invalidate();
      await utils.berta.charter.version.invalidate();
      toast.success(saved.unchanged
        ? "Active charter already matches this text."
        : `Saved charter v${saved.version}.`);
    },
    onError: (error) => toast.error(error.message),
  });
  const rollback = trpc.berta.charter.rollback.useMutation({
    onSuccess: async (saved) => {
      seenVersion.current = saved.version;
      setPreviewVersion(null);
      setDirty(false);
      setDraft(saved.body);
      await utils.berta.charter.state.invalidate();
      await utils.berta.charter.version.invalidate();
      toast.success(saved.unchanged
        ? "That version is already active."
        : `Restored as charter v${saved.version}.`);
    },
    onError: (error) => toast.error(error.message),
  });

  const normalized = normalizeCharterBody(draft);
  const activeBody = state.data?.active?.body ?? null;
  const canSave = normalized.ok && normalized.body !== activeBody && !save.isPending && !rollback.isPending;
  const activeVersion = state.data?.active?.version ?? null;

  async function loadFile(file: File) {
    if (file.size > CHARTER_MAX_CHARS * 4) {
      toast.error("That file is larger than the 40,000 character charter limit.");
      return;
    }
    const text = await file.text();
    if (text.includes("\u0000")) {
      toast.error("Upload a plain markdown or text file.");
      return;
    }
    const loaded = normalizeCharterBody(text);
    if (!loaded.ok) {
      toast.error(loaded.reason === "empty"
        ? "That file has no charter text."
        : "Charter text must be 40,000 characters or fewer.");
      return;
    }
    setPreviewVersion(null);
    setDirty(true);
    setDraft(loaded.body);
    toast.success(loaded.body === activeBody
      ? "Loaded. This already matches the active charter."
      : "Loaded into the editor. Save to store a new version.");
  }

  return (
    <section className="data-section">
      <div className="section-heading">
        <div>
          <span className="micro-label">PERSONA</span>
          <h2>Charter</h2>
        </div>
        {activeVersion !== null && <span className="quiet-meta">ACTIVE V{activeVersion}</span>}
      </div>
      <p className="section-description">
        Paste or upload markdown. Each save stores a new version. Every later chat, including chats from approved members, uses the active version as its system prompt. Until the first save, chats keep the built-in prompt. Keep private notes out of this text.
      </p>
      {state.isLoading && <p className="charter-note">Loading charter…</p>}
      {state.isError && (
        <div className="charter-banner">
          <p>{state.error.message}</p>
          <button type="button" className="button button--secondary button--small" onClick={() => void state.refetch()}>
            Retry
          </button>
        </div>
      )}
      {previewVersion !== null && (
        <div className="charter-banner">
          <p>
            {preview.isError
              ? preview.error.message
              : `Previewing v${previewVersion}. Save stores the editor as a new version. Restore keeps an exact copy of v${previewVersion}.`}
          </p>
          <div className="charter-version__actions">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                setPreviewVersion(null);
                setDirty(false);
                setDraft(activeBody ?? "");
              }}
            >
              Show active
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={rollback.isPending || save.isPending || preview.isError}
              onClick={() => rollback.mutate({ version: previewVersion })}
            >
              <RotateCcw size={15} /> Restore v{previewVersion}
            </button>
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="charter-body">Charter markdown</label>
      <textarea
        id="charter-body"
        className="objective-editor charter-editor"
        value={draft}
        maxLength={CHARTER_MAX_CHARS}
        rows={12}
        spellCheck
        placeholder="Paste charter markdown here."
        onChange={(event) => {
          setDirty(true);
          setDraft(event.target.value);
        }}
        disabled={state.isLoading || save.isPending}
      />
      <p className="charter-note" aria-live="polite">
        {draft.length.toLocaleString()} / {CHARTER_MAX_CHARS.toLocaleString()} characters
        {activeVersion === null ? " · built-in prompt is active" : ""}
      </p>
      <div className="charter-toolbar">
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={15} /> Upload markdown
        </button>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          aria-label="Upload charter markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void loadFile(file);
          }}
        />
        <button
          type="button"
          className="button button--primary button--small"
          disabled={!canSave}
          onClick={() => save.mutate({ body: draft })}
        >
          <Save size={15} /> Save charter
        </button>
      </div>
      <ul className="charter-history">
        {state.data && state.data.history.length === 0 && (
          <li className="charter-note">No saved versions yet.</li>
        )}
        {state.data?.history.map((item) => {
          const active = item.version === activeVersion;
          return (
            <li className="charter-version" key={item.version}>
              <p>
                v{item.version}
                {" · "}
                {formatWhen(item.createdAt)}
                {" · "}
                {item.chars.toLocaleString()} chars
                {" · "}
                author {item.authorUserId}
                {item.restoredFromVersion !== null ? ` · restored from v${item.restoredFromVersion}` : ""}
              </p>
              <div className="charter-version__actions">
                {active ? <span className="quiet-meta">ACTIVE</span> : (
                  <>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => {
                        setDirty(false);
                        setPreviewVersion(item.version);
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      disabled={rollback.isPending || save.isPending}
                      onClick={() => rollback.mutate({ version: item.version })}
                    >
                      <RotateCcw size={15} /> Restore
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
