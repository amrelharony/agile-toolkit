/**
 * Incident Commander — singleton id, severity/status palettes, severity matrix.
 * IC_ID MUST match the constant in src/lib/actions/tools/incident-commander.ts.
 */

import type { IncidentState, IncidentStatus, Severity } from "./types";

export const DEFAULT_STATE: IncidentState = { incidents: [] };

export const IC_ID = "incidentCommander:current"; // MUST match IC_ID in incident-commander.ts.

export const SEVERITY_LABEL: Record<Severity, string> = {
  sev1: "SEV-1",
  sev2: "SEV-2",
  sev3: "SEV-3",
  sev4: "SEV-4",
};

export const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  sev1: "bg-danger/15 text-danger border-danger/40",
  sev2: "bg-danger/10 text-danger border-danger/30",
  sev3: "bg-warning/10 text-warning border-warning/30",
  sev4: "bg-accent/10 text-accent border-accent/30",
};

export const STATUS_BADGE_CLASS: Record<IncidentStatus, string> = {
  active: "bg-danger/10 text-danger border-danger/30",
  mitigated: "bg-warning/10 text-warning border-warning/30",
  resolved: "bg-success/10 text-success border-success/30",
};

export const SEVERITY_MATRIX: { sev: Severity; rule: string }[] = [
  { sev: "sev1", rule: "Full team paged · 24/7 response · exec comms" },
  { sev: "sev2", rule: "Oncall paged · response within 30 min" },
  { sev: "sev3", rule: "Business-hours response · comms in #incidents" },
  { sev: "sev4", rule: "Backlog · address in next sprint" },
];
