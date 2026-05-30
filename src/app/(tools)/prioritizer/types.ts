/**
 * Backlog Prioritizer — shared types.
 *
 * Backlog items are a synced workspace collection (`backlogItems`); these
 * types describe one row + the store-hook surface the UI consumes.
 */

export type MoSCoWCategory = "must" | "should" | "could" | "wont";

export const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
export type ImpactValue = (typeof IMPACT_VALUES)[number];

export interface BacklogItem {
  id: string;
  name: string;
  description?: string;
  // MoSCoW
  moscow: MoSCoWCategory;
  // WSJF inputs
  businessValue: number;
  timeCriticality: number;
  riskReduction: number;
  jobSize: number;
  // RICE inputs
  reach: number;
  impact: ImpactValue;
  confidence: number;
  effort: number;
  // Matrix
  value: number;
  matrixEffort: number;
}

export interface PrioritizerStore {
  items: BacklogItem[];
  addItem: () => void;
  updateItem: (id: string, updates: Partial<Omit<BacklogItem, "id">>) => void;
  removeItem: (id: string) => void;
  reset: () => void;
}
