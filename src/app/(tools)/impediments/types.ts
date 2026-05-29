/**
 * Impediment Tracker — shared types.
 *
 * The tool persists to its own isolated zustand store (see
 * use-impediment-store.ts) and bridges a normalized projection into
 * workspace.impediments; these types describe the local store shape.
 */

export type Category = "Technical" | "Organizational" | "External" | "Process";
export type Severity = "Low" | "Medium" | "High" | "Critical";
export type Status = "Open" | "Escalated" | "Resolved";

export interface Impediment {
  id: string;
  title: string;
  description: string;
  category: Category;
  severity: Severity;
  raisedBy: string;
  assignedTo: string;
  status: Status;
  raisedDate: string; // ISO date
  resolvedDate?: string; // ISO date
  /** Expected resolution lead-time in days, captured at logging time. */
  expectedResolutionDays?: number;
}

export interface ImpedimentStore {
  impediments: Impediment[];
  addImpediment: (imp: Omit<Impediment, "id" | "raisedDate" | "status">) => void;
  updateStatus: (id: string, status: Status, resolvedDate?: string) => void;
  remove: (id: string) => void;
  reset: () => void;
}
