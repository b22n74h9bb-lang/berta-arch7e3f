import { useEffect, useState } from "react";
import { Check, ChevronRight, Plus, Rabbit, Save } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import type { BertaData, MissionTask } from "@/types/berta";

const statusLabels: Record<MissionTask["status"], string> = {
  todo: "Queued",
  active: "Active",
  done: "Complete",
  blocked: "Blocked",
};

export function MissionPanel({ data }: { data: BertaData }) {
  const { mission, tasks } = data;
  const [objective, setObjective] = useState(mission.objective);
  const [newTask, setNewTask] = useState("");
  const utils = trpc.useUtils();
  useEffect(() => setObjective(mission.objective), [mission.objective]);
  const refresh = () => void utils.berta.bootstrap.invalidate();
  const updateMission = trpc.berta.updateMission.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Mission settings saved.");
    },
    onError: (error) => toast.error(error.message),
  });
  const addTask = trpc.berta.addTask.useMutation({
    onSuccess: () => {
      setNewTask("");
      refresh();
      toast.success("Mission task added.");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateTask = trpc.berta.updateTask.useMutation({
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const completed = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length)
    : 0;
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="micro-label">LONG-TERM MISSION</span>
          <h1>ARCH7E3F</h1>
          <p>{mission.title}</p>
        </div>
        <div className="mission-score" aria-label={`${progress}% average task progress`}>
          <strong>{progress}%</strong>
          <span>{completed}/{tasks.length} COMPLETE</span>
        </div>
      </header>
      <section className="data-section rabbit-section">
        <div className="section-icon"><Rabbit size={22} /></div>
        <div className="section-grow">
          <h2>Rabbit mode</h2>
          <p>Run authorized, reversible work when a legitimate resource window appears. Never bypass quotas or access controls.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={mission.rabbitMode}
          className={`switch-control ${mission.rabbitMode ? "is-on" : ""}`}
          onClick={() => updateMission.mutate({ rabbitMode: !mission.rabbitMode })}
          disabled={updateMission.isPending}
        >
          <span /><b>{mission.rabbitMode ? "ON" : "OFF"}</b>
        </button>
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="micro-label">MISSION DIRECTIVE</span>
            <h2>Target and scientific boundaries</h2>
          </div>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => updateMission.mutate({ objective })}
            disabled={objective.trim().length < 20 || objective === mission.objective || updateMission.isPending}
          >
            <Save size={15} /> Save
          </button>
        </div>
        <textarea
          className="objective-editor"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          rows={7}
          maxLength={8000}
        />
      </section>
      <section className="data-section">
        <div className="section-heading">
          <div>
            <span className="micro-label">EXECUTION SEQUENCE</span>
            <h2>Mission tasks</h2>
          </div>
          <span className="quiet-meta">{tasks.filter((task) => task.status === "active").length} ACTIVE</span>
        </div>
        <div className="task-list">
          {tasks.map((task) => (
            <article className="task-row" key={task.id}>
              <button
                type="button"
                className={`task-check ${task.status === "done" ? "is-done" : ""}`}
                aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
                onClick={() => updateTask.mutate({
                  id: task.id,
                  status: task.status === "done" ? "todo" : "done",
                })}
              >
                {task.status === "done" ? <Check size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="task-body">
                <span className="micro-label">{task.category}</span>
                <h3 className={task.status === "done" ? "is-complete" : ""}>{task.title}</h3>
                <div className="progress-track" aria-label={`${task.progress}% complete`}>
                  <span style={{ width: `${task.progress}%` }} />
                </div>
              </div>
              <select
                aria-label={`Status for ${task.title}`}
                value={task.status}
                onChange={(event) => updateTask.mutate({
                  id: task.id,
                  status: event.target.value as MissionTask["status"],
                })}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </article>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newTask.trim().length >= 3) addTask.mutate({ title: newTask });
          }}
        >
          <label htmlFor="new-task" className="sr-only">New mission task</label>
          <input
            id="new-task"
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder="Add a concrete next action…"
            maxLength={500}
          />
          <button type="submit" className="button button--primary" disabled={newTask.trim().length < 3 || addTask.isPending}>
            <Plus size={17} /> Add task
          </button>
        </form>
      </section>
    </div>
  );
}
