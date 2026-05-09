export type ISODateString = string;

export interface TeamMember {
  id: string;
  name: string;
  role?: string;
  capacityPct?: number;
  skills?: string[];
}

export interface Sprint {
  id: string;
  name: string;
  startDate: ISODateString;
  endDate: ISODateString;
  goal?: string;
  pointsPlanned: number;
  pointsCompleted?: number;
  status: "planned" | "active" | "completed" | "cancelled";
}

export interface Story {
  id: string;
  title: string;
  points?: number;
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  sprintId?: string;
  tags?: string[];
  priorityScore?: number;
  owner?: string;
}

export type ImpedimentSeverity = "low" | "medium" | "high" | "critical";

export interface Impediment {
  id: string;
  title: string;
  severity: ImpedimentSeverity;
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
  owner?: string;
  source?: "standup" | "retro" | "manual";
}

export interface Risk {
  id: string;
  title: string;
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  mitigation?: string;
  /** Target date by which mitigation should complete (ISO yyyy-mm-dd). */
  mitigationDueAt?: ISODateString;
  status: "open" | "mitigating" | "closed" | "accepted";
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
}

export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  target: number;
  current: number;
  unit?: string;
  confidence?: number;
}

export interface Okr {
  id: string;
  objective: string;
  description?: string;
  keyResults: KeyResult[];
  quarter: string;
  owner?: string;
}

export interface Decision {
  id: string;
  title: string;
  context?: string;
  decision: string;
  consequences?: string;
  alternatives?: string[];
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  date: ISODateString;
}

export interface TechDebtItem {
  id: string;
  title: string;
  description?: string;
  area?: string;
  impact: 1 | 2 | 3 | 4 | 5;
  effort: 1 | 2 | 3 | 4 | 5;
  interestRate?: number;
  raisedAt: ISODateString;
  resolvedAt?: ISODateString;
  tags?: string[];
}

export type MaturityLevel = 1 | 2 | 3 | 4 | 5;

export interface Workspace {
  teamMembers: TeamMember[];
  sprints: Sprint[];
  stories: Story[];
  impediments: Impediment[];
  risks: Risk[];
  okrs: Okr[];
  decisions: Decision[];
  techDebt: TechDebtItem[];
  maturityLevel?: MaturityLevel;
  teamName?: string;
}

export const emptyWorkspace: Workspace = {
  teamMembers: [],
  sprints: [],
  stories: [],
  impediments: [],
  risks: [],
  okrs: [],
  decisions: [],
  techDebt: [],
};
