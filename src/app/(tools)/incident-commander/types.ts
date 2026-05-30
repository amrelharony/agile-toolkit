/**
 * Incident Commander — shared types.
 *
 * Persisted as a synced workspace singleton (`IncidentCommander`);
 * `IncidentState` is the structurally-equal local shape the UI consumes
 * (see use-incident-commander.ts).
 */

export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus = "active" | "mitigated" | "resolved";

export interface TimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  commander?: string;
  scribe?: string;
  description?: string;
  timeline: TimelineEntry[];
}

export interface IncidentState {
  incidents: Incident[];
}
