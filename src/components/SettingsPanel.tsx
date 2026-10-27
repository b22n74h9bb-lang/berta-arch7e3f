import { useEffect, useState } from "react";
import { Download, ExternalLink, LogOut, Mic2, Save, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import type { BertaData } from "@/types/berta";

export function SettingsPanel({ data }: { data: BertaData }) {
  const { mission } = data;
  const { user, logout } = useAuth();
  const [runtimeUrl, setRuntimeUrl] = useState(mission.runtimeUrl ?? "");
  const [creditBudget, setCreditBudget] = useState(mission.creditBudget);
  const [installOpen, setInstallOpen] = useState(false);
  const utils = trpc.useUtils();
  useEffect(() => setRuntimeUrl(mission.runtimeUrl ?? ""), [mission.runtimeUrl]);
  useEffect(() => setCreditBudget(mission.creditBudget), [mission.creditBudget]);
  const refresh = () => void utils.berta.bootstrap.invalidate();
  const updateMission = trpc.berta.updateMission.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Settings saved.");
    },
    onError: (error) => toast.error(error.message),
  });
  const saveConnection = trpc.berta.saveConnection.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Runtime address saved as unverified. No connection test was performed.");
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="micro-label">CONTROL & CONNECTION</span>
          <h1>Settings</h1>
          <p>{user?.name || "Berta operator"} · {user?.email || "Authenticated session"}</p>
        </div>
      </header>
      <section className="data-section">
        <div className="section-heading">
          <div><span className="micro-label">CLAW RUNTIME</span><h2>Connection</h2></div>
          <span className="connection-chip">{mission.runtimeStatus}</span>
        </div>
        <p className="section-description">Store the HTTPS address of your existing runtime. This app does not verify or proxy it yet, and no API token is stored here.</p>
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveConnection.mutate({ runtimeUrl });
          }}
        >
          <label htmlFor="runtime-url">Runtime HTTPS URL</label>
          <div className="inline-form">
            <input id="runtime-url" type="url" value={runtimeUrl} onChange={(event) => setRuntimeUrl(event.target.value)} placeholder="https://your-runtime.example" />
            <button type="submit" className="button button--primary" disabled={saveConnection.isPending}><Save size={16} /> Save</button>
          </div>
        </form>
      </section>
      <section className="data-section settings-list">
        <div className="setting-row">
          <div className="section-icon"><Mic2 size={21} /></div>
          <div className="section-grow">
            <h2>Spoken replies</h2>
            <p>Use your device’s speech synthesizer after Berta answers. Availability and voice depend on the browser.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mission.voiceReplies}
            className={`switch-control ${mission.voiceReplies ? "is-on" : ""}`}
            onClick={() => updateMission.mutate({ voiceReplies: !mission.voiceReplies })}
          ><span /><b>{mission.voiceReplies ? "ON" : "OFF"}</b></button>
        </div>
        <div className="setting-row">
          <div className="section-icon"><ShieldCheck size={21} /></div>
          <div className="section-grow">
            <h2>Mission credit budget</h2>
            <p>A planning limit for Rabbit mode. It does not modify your actual Kimi subscription or gateway quota.</p>
          </div>
          <div className="budget-editor">
            <input aria-label="Mission credit budget" type="number" min={1} max={10000} value={creditBudget} onChange={(event) => setCreditBudget(Number(event.target.value))} />
            <button type="button" className="icon-button" onClick={() => updateMission.mutate({ creditBudget })} disabled={creditBudget < 1 || creditBudget > 10000} aria-label="Save credit budget"><Save size={16} /></button>
          </div>
        </div>
      </section>
      <section className="data-section install-section">
        <div className="section-icon"><Smartphone size={22} /></div>
        <div className="section-grow">
          <span className="micro-label">INSTALLABLE PWA</span>
          <h2>Put Berta on your Home Screen</h2>
          <p>The app includes a manifest, offline application shell, and Apple touch icon. AI and mission data still require a network connection.</p>
          <button type="button" className="button button--secondary" onClick={() => setInstallOpen(!installOpen)}>
            <Download size={16} /> {installOpen ? "Hide install steps" : "Show install steps"}
          </button>
          {installOpen && (
            <ol className="install-steps">
              <li>Open this app in Safari on your iPhone.</li>
              <li>Tap the <strong>Share</strong> button in Safari.</li>
              <li>Choose <strong>Add to Home Screen</strong>.</li>
              <li>Open Berta from the new icon and sign in if asked.</li>
            </ol>
          )}
        </div>
      </section>
      <section className="data-section">
        <span className="micro-label">ACTIVE BOUNDARIES</span>
        <h2>What Berta may not do</h2>
        <ul className="boundary-list">
          <li>No quota, paywall, authentication, or access-control bypass</li>
          <li>No restricted data, external contact, or publication without approval</li>
          <li>No individual profiling, de-anonymization, or manipulation targeting</li>
          <li>No fabricated execution, memory, tool access, or scientific evidence</li>
        </ul>
        <a className="text-link" href="https://www.kimi.ai/help/kimi-claw/overview" target="_blank" rel="noreferrer">Official Kimi Claw overview <ExternalLink size={14} /></a>
      </section>
      <button type="button" className="button button--secondary signout-button" onClick={logout}><LogOut size={16} /> Sign out</button>
    </div>
  );
}
