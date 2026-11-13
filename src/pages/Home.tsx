import { useEffect, useState } from "react";
import { Container, ListTodo, MessageCircle, Rabbit, RefreshCw, Settings } from "lucide-react";
import { LOGIN_PATH } from "@/const";
import { useAuth } from "@/hooks/useAuth";
import { clearLastAccount, readLastAccount, writeLastAccount } from "@/offline/continuity";
import { trpc } from "@/providers/trpc";
import type { BertaData } from "@/types/berta";
import { AccessHold } from "@/components/AccessHold";
import { BertaMark } from "@/components/BertaMark";
import { ChatPanel } from "@/components/ChatPanel";
import { MissionPanel } from "@/components/MissionPanel";
import { OfflineCapture } from "@/components/OfflineCapture";
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
  const { user, isLoading: authLoading, error: authError, refresh } = useAuth();
  const approved = Boolean(user && (user.verifiedOwner || user.membership.status === "approved"));
  const query = trpc.berta.bootstrap.useQuery(undefined, {
    enabled: Boolean(approved),
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const memberQueue = trpc.auth.listMembers.useQuery(undefined, {
    enabled: Boolean(approved && user?.role === "admin"),
    refetchInterval: 20000,
    retry: false,
  });
  const accessRequests = memberQueue.data?.filter((member) => member.status === "pending").length ?? 0;
  useEffect(() => {
    if (user?.id == null) return;
    if (approved) writeLastAccount(window.localStorage, String(user.id));
    else clearLastAccount(window.localStorage);
  }, [approved, user?.id]);
  useEffect(() => {
    if (isUnauthorized(authError) || isUnauthorized(query.error)) clearLastAccount(window.localStorage);
  }, [authError, query.error]);
  const navigate = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (authLoading) return <LoadingShell label="AUTHENTICATING OPERATOR" />;
  const remembered = readLastAccount(window.localStorage);
  const offlineAccount = approved && user?.id != null
    ? String(user.id)
    : !user && !isUnauthorized(authError) && authError && remembered
      ? remembered
      : null;
  if (!user && !offlineAccount) return <Welcome />;
  if (user && !user.verifiedOwner && user.membership.status !== "approved") {
    const status = user.membership.status === "rejected" || user.membership.status === "revoked"
      ? user.membership.status
      : "pending";
    return <AccessHold login={user.membership.login} status={status} />;
  }
  if (query.isLoading) return <LoadingShell label="LOADING ARCH7E3F MISSION STATE" />;
  if (query.isError && isUnauthorized(query.error)) return <Welcome />;
  if ((query.isError || !query.data) && offlineAccount) {
    return (
      <OfflineShell
        accountId={offlineAccount}
        detail={query.error?.message || authError?.message || "The server could not be reached."}
        onRetry={() => {
          void refresh();
          void query.refetch();
        }}
      />
    );
  }
  if (query.isError || !query.data || !user) return <Welcome />;
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
              {id === "settings" && accessRequests > 0 && <b>{accessRequests}</b>}
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
        {view === "mission" && <MissionPanel data={data} accountId={String(user.id)} />}
        {view === "sandbox" && <SandboxPanel data={data} />}
        {view === "settings" && <SettingsPanel data={data} />}
      </main>
      <nav className="mobile-nav" aria-label="Primary navigation">
        {views.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => navigate(id)}>
            <span className="mobile-nav__icon">
              <Icon size={20} />
              {id === "sandbox" && pending > 0 && <b>{pending}</b>}
              {id === "settings" && accessRequests > 0 && <b>{accessRequests}</b>}
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

function OfflineShell({ accountId, detail, onRetry }: { accountId: string; detail: string; onRetry: () => void }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-button">
          <BertaMark size={37} active={false} />
          <span><strong>BERTA</strong><small>OFFLINE</small></span>
        </div>
      </header>
      <main className="main-content">
        <div className="page-stack">
          <section className="data-section">
            <span className="micro-label">CONNECTION INTERRUPTED</span>
            <h2>Server mission state is unavailable</h2>
            <p className="offline-banner">{detail.replace(/[.!?]$/, "")}. Notes on this device are still here. AI, chat, and server tasks stay unavailable. Revocation cannot be checked until the server answers.</p>
            <button type="button" className="button button--primary" onClick={onRetry}>
              <RefreshCw size={16} /> Retry
            </button>
          </section>
          <OfflineCapture accountId={accountId} />
        </div>
      </main>
    </div>
  );
}

function isUnauthorized(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "data" in error && (error as { data?: { code?: string } }).data?.code === "UNAUTHORIZED");
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
