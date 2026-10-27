import type {
  Approval,
  ChatMessage,
  Mission,
  SandboxJob,
  Task as MissionTask,
} from "@contracts/types";

export type { Approval, ChatMessage, Mission, MissionTask, SandboxJob };

export type BertaData = {
  mission: Mission;
  tasks: MissionTask[];
  jobs: SandboxJob[];
  approvals: Approval[];
  messages: ChatMessage[];
};
