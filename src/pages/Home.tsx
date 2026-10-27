import { useState } from "react";
import { Container, ListTodo, MessageCircle, Rabbit, RefreshCw, Settings } from "lucide-react";
import { LOGIN_PATH } from "@/const";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import type { BertaData } from "@/types/berta";
import { BertaMark } from "@/components/BertaMark";
import { ChatPanel } from "@/components/ChatPanel";
import { MissionPanel } from "@/components/MissionPanel";
import { SandboxPanel } from "@/components/SandboxPanel";
import { SettingsPanel } from "@/components/SettingsPanel";

const views = [
  { id: "console", label: "Console", icon: MessageCircle },
  { id: "mission", label: "Mission", icon: ListTodo },
  { id: "sandbox", label: "Sandbox", icon: Container },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
type View = (typeof views)[number]["id"];

export default function Home() {
  const [view, setView] = useState<View>("console");
  const { user, isLoading: authLoading } = useAuth();
  const query = trpc.berta.bootstrap.useQuery(undefined, {
    enabled: Boolean(user),
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (authLoading) return <LoadingShell label="AUTHENTICATING OPERATOR" />;
  if (!user) return <Welcome />;
  if (query.isLoading) return <LoadingShell label="LOADING ARCH7E3F MISSION STATE" />;
  if (query.isError || !query.data) {
    return (
      <div className="centered-state">
        <BertaMark size={62} active={false} />
        <span className="micro-label">CONNECTION INTERRUPTED</span>
        <h1>Mission state could not load</h1>
        <p>{query.error?.message || "The backend returned no mission data."}</p>
        <button type="button" className="button button--primary" onClick={() => void query.refetch()}>
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }
  const data = query.data;
  const pending = data.approvals.filter((approval) => approval.status === "pending").length;
  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand-button" onClick={() => navigate("console")} aria-label="Open Berta console">
          <BertaMark size={37} active={data.mission.status === "active"} />
          <span><strong>BERTA</strong><small>ARCH7E3F</small></span>
        </button>
        <div className="topbar__status">
          <span className="runtime-pill"><span className="status-dot" />{data.mission.runtimeStatus === "unverified" ? "RUNTIME UNVERIFIED" : "LOCAL AI"}</span>
          <span className={`rabbit-pill ${data.mission.rabbitMode ? "is-active" : ""}`}>
            <Rabbit size={14} />{data.mission.rabbitMode ? "RABBIT ON" : "RABBIT OFF"}
          </span>
        </div>
      </header>
      <aside className="desktop-rail" aria-label="Primary navigation">
        <div className="rail-mission">
          <span className="micro-label">MISSION CONTROL</span>
          <p>Human atlas<br />+ public reaction</p>
        </div>
        <nav>
          {views.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => navigate(id)}>
              <Icon size={19} /><span>{label}</span>
              {id === "sandbox" && pending > 0 && <b>{pending}</b>}
            </button>
          ))}
        </nav>
        <div className="rail-boundary">
          <span className="status-dot" />
          <p>Bounded autonomy.<br />No quota bypass.</p>
        </div>
      </aside>
      <div className="ticker" aria-label="Mission status">
        <span>ARCH7E3F</span>
        <p>PUBLIC HUMAN DATA ONLY</p><i />
        <p>NO INDIVIDUAL TARGETING</p><i />
        <p>EXECUTOR NOT CONNECTED</p>
      </div>
      <main className="main-content">
        {view === "console" && (
          <div className="console-layout">
            <ChatPanel messages={data.messages} voiceReplies={data.mission.voiceReplies} />
            <ContextRail data={data} onNavigate={navigate} />
          </div>
        )}
        {view === "mission" && <MissionPanel data={data} />}
        {view === "sandbox" && <SandboxPanel data={data} />}
        {view === "settings" && <SettingsPanel data={data} />}
      </main>
      <nav className="mobile-nav" aria-label="Primary navigation">
        {views.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => navigate(id)}>
            <span className="mobile-nav__icon">
              <Icon size={20} />{id === "sandbox" && pending > 0 && <b>{pending}</b>}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ContextRail({ data, onNavigate }: { data: BertaData; onNavigate: (view: View) => void }) {
  const activeTasks = data.tasks.filter((task) => task.status === "active");
  const pending = data.approvals.filter((approval) => approval.status === "pending").length;
  return (
    <aside className="context-rail">
      <div className="context-block">
        <span className="micro-label">CURRENT OBJECTIVE</span>
        <p>{data.mission.title}</p>
        <button type="button" className="text-button" onClick={() => onNavigate("mission")}>
          Open mission <span>→</span>
        </button>
      </div>
      <div className="context-block">
        <span className="micro-label">ACTIVE WORK</span>
        {activeTasks.length
          ? activeTasks.map((task) => <p key={task.id} className="context-task">{task.title}</p>)
          : <p>No active task. Choose the next bounded action.</p>}
      </div>
      <div className="context-block context-metrics">
        <div><strong>{pending}</strong><span>APPROVALS</span></div>
        <div><strong>{data.jobs.length}</strong><span>JOB RECORDS</span></div>
        <div><strong>{data.mission.creditBudget}</strong><span>MISSION CAP</span></div>
      </div>
      <button type="button" className="button button--secondary" onClick={() => onNavigate("sandbox")}>Inspect sandbox</button>
      <p className="context-note">Execution remains paused until a real isolated executor is connected.</p>
    </aside>
  );
}

function LoadingShell({ label }: { label: string }) {
  return (
    <div className="centered-state">
      <BertaMark size={72} />
      <span className="micro-label">{label}</span>
      <div className="loading-lines"><span /><span /><span /></div>
    </div>
  );
}

function Welcome() {
  return (
    <main className="welcome-shell">
      <div className="scanlines" aria-hidden="true" />
      <div className="welcome-content">
        <BertaMark size={82} />
        <span className="micro-label">ARCH7E3F / PRIVATE MISSION CONTROL</span>
        <h1>Berta, within<br />your boundaries.</h1>
        <p>Voice interaction, persistent mission state, explicit approvals, and a resource-aware sandbox register—designed for your iPhone.</p>
        <button type="button" className="button button--primary button--large" onClick={() => {
          window.location.href = LOGIN_PATH;
        }}>
          Enter mission control <span>→</span>
        </button>
        <div className="welcome-boundaries">
          <span>NO QUOTA BYPASS</span><span>HUMAN DATA ONLY</span><span>YOU APPROVE HIGH IMPACT</span>
        </div>
      </div>
    </main>
  );
}
