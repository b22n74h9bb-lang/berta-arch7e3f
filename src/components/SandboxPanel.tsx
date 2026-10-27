import { useState } from "react";
import { Ban, Check, Clock3, Container, Pause, Play, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import type { BertaData } from "@/types/berta";

type JobKind = "dataset-manifest" | "analysis-plan" | "reproducibility-check";
const jobLabels: Record<JobKind, string> = {
  "dataset-manifest": "Dataset manifest",
  "analysis-plan": "Analysis plan",
  "reproducibility-check": "Reproducibility check",
};
const jobKindLabel = (kind: string) => jobLabels[kind as JobKind] ?? kind;

export function SandboxPanel({ data }: { data: BertaData }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<JobKind>("dataset-manifest");
  const [budgetCredits, setBudgetCredits] = useState(1);
  const utils = trpc.useUtils();
  const refresh = () => void utils.berta.bootstrap.invalidate();
  const createJob = trpc.berta.createJob.useMutation({
    onSuccess: () => {
      setName("");
      refresh();
      toast.success("Job queued. It will not execute until an executor is connected.");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateJob = trpc.berta.updateJob.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const resolveApproval = trpc.berta.resolveApproval.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Decision recorded in the mission log.");
    },
    onError: (error) => toast.error(error.message),
  });
  const pendingApprovals = data.approvals.filter((approval) => approval.status === "pending");
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="micro-label">ISOLATED EXECUTION</span>
          <h1>Sandbox</h1>
          <p>Resource-bounded jobs with explicit approval history.</p>
        </div>
        <div className="connection-chip"><Container size={17} /> EXECUTOR OFFLINE</div>
      </header>
      <section className="executor-notice">
        <ShieldCheck size={23} />
        <div>
          <h2>No remote executor is connected</h2>
          <p>Jobs below are real persisted queue records—not running computations. Connect an isolated runtime before expecting execution or output files.</p>
        </div>
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div><span className="micro-label">NEW BOUNDED JOB</span><h2>Queue mission work</h2></div>
        </div>
        <form
          className="job-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length >= 3) createJob.mutate({ name, kind, budgetCredits });
          }}
        >
          <div className="field field--wide">
            <label htmlFor="job-name">Job name</label>
            <input id="job-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Validate pilot dataset manifest" maxLength={255} />
          </div>
          <div className="field">
            <label htmlFor="job-kind">Work type</label>
            <select id="job-kind" value={kind} onChange={(event) => setKind(event.target.value as JobKind)}>
              {Object.entries(jobLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field field--budget">
            <label htmlFor="job-budget">Credit cap</label>
            <input id="job-budget" type="number" min={1} max={100} value={budgetCredits} onChange={(event) => setBudgetCredits(Number(event.target.value))} />
          </div>
          <button type="submit" className="button button--primary job-submit" disabled={name.trim().length < 3 || createJob.isPending}>
            <Plus size={17} /> Queue job
          </button>
        </form>
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div><span className="micro-label">JOB REGISTER</span><h2>Execution queue</h2></div>
          <span className="quiet-meta">{data.jobs.length} RECORDS</span>
        </div>
        {data.jobs.length === 0 ? (
          <div className="empty-state"><Clock3 size={25} /><p>No jobs yet. Queue a small, reversible pilot above.</p></div>
        ) : (
          <div className="job-list">
            {data.jobs.map((job) => (
              <article className="job-row" key={job.id}>
                <div className="job-row__top">
                  <div>
                    <span className="micro-label">{jobKindLabel(job.kind)} · {job.budgetCredits} CREDIT CAP</span>
                    <h3>{job.name}</h3>
                  </div>
                  <span className={`job-status job-status--${job.status}`}>{job.status}</span>
                </div>
                <p>{job.output}</p>
                <div className="job-row__footer">
                  <span>{job.executor} · {job.progress}%</span>
                  <div className="job-actions">
                    {job.status !== "paused" && !["completed", "failed", "cancelled"].includes(job.status) && (
                      <button type="button" className="icon-button" onClick={() => updateJob.mutate({ id: job.id, action: "pause" })} aria-label={`Pause ${job.name}`}><Pause size={16} /></button>
                    )}
                    {job.status === "paused" && (
                      <button type="button" className="icon-button" onClick={() => updateJob.mutate({ id: job.id, action: "resume" })} aria-label={`Resume ${job.name}`}><Play size={16} /></button>
                    )}
                    {!["completed", "failed", "cancelled"].includes(job.status) && (
                      <button type="button" className="icon-button icon-button--danger" onClick={() => updateJob.mutate({ id: job.id, action: "cancel" })} aria-label={`Cancel ${job.name}`}><X size={16} /></button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div><span className="micro-label">HUMAN-IN-THE-LOOP</span><h2>Approval register</h2></div>
          <span className="quiet-meta">{pendingApprovals.length} PENDING</span>
        </div>
        <div className="approval-list">
          {data.approvals.map((approval) => (
            <article className="approval-row" key={approval.id}>
              <div className="approval-row__body">
                <span className={`risk-label risk-label--${approval.risk}`}>{approval.risk} risk</span>
                <h3>{approval.title}</h3>
                <p>{approval.detail}</p>
              </div>
              {approval.status === "pending" ? (
                <div className="approval-actions">
                  <button type="button" className="button button--primary button--small" onClick={() => resolveApproval.mutate({ id: approval.id, decision: "approved" })}><Check size={15} /> Approve</button>
                  <button type="button" className="button button--secondary button--small" onClick={() => resolveApproval.mutate({ id: approval.id, decision: "rejected" })}><Ban size={15} /> Reject</button>
                </div>
              ) : <span className={`resolution resolution--${approval.status}`}>{approval.status}</span>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
