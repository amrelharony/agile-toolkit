/**
 * Backlog Prioritizer — seed data + MoSCoW presentation config.
 *
 * `defaultItems` uses deterministic ids so SSR HTML matches the client on
 * first paint; `createDefaultItem` mints real UUIDs for user-added rows.
 */

import type { BacklogItem, MoSCoWCategory } from "./types";

export function createDefaultItem(): BacklogItem {
  return {
    id: crypto.randomUUID(),
    name: "New Item",
    moscow: "should",
    businessValue: 5,
    timeCriticality: 5,
    riskReduction: 5,
    jobSize: 5,
    reach: 100,
    impact: 1,
    confidence: 80,
    effort: 1,
    value: 5,
    matrixEffort: 5,
  };
}

// Deterministic IDs in module-level defaults so SSR HTML matches client HTML
// on first paint. User-added items get real UUIDs via `createDefaultItem`.
export const defaultItems: BacklogItem[] = [
  {
    id: "default:item-auth",
    name: "User authentication",
    moscow: "must",
    businessValue: 9,
    timeCriticality: 8,
    riskReduction: 7,
    jobSize: 3,
    reach: 500,
    impact: 2,
    confidence: 90,
    effort: 2,
    value: 9,
    matrixEffort: 3,
  },
  {
    id: "default:item-dashboard",
    name: "Dashboard redesign",
    moscow: "should",
    businessValue: 7,
    timeCriticality: 4,
    riskReduction: 2,
    jobSize: 5,
    reach: 300,
    impact: 1,
    confidence: 70,
    effort: 4,
    value: 7,
    matrixEffort: 5,
  },
  {
    id: "default:item-pdf",
    name: "Export to PDF",
    moscow: "could",
    businessValue: 4,
    timeCriticality: 2,
    riskReduction: 1,
    jobSize: 2,
    reach: 150,
    impact: 0.5,
    confidence: 60,
    effort: 1,
    value: 4,
    matrixEffort: 2,
  },
  {
    id: "default:item-darkmode",
    name: "Dark mode toggle",
    moscow: "could",
    businessValue: 3,
    timeCriticality: 1,
    riskReduction: 1,
    jobSize: 1,
    reach: 400,
    impact: 0.5,
    confidence: 80,
    effort: 1,
    value: 3,
    matrixEffort: 1,
  },
  {
    id: "default:item-legacy",
    name: "Legacy API migration",
    moscow: "wont",
    businessValue: 2,
    timeCriticality: 3,
    riskReduction: 8,
    jobSize: 9,
    reach: 50,
    impact: 1,
    confidence: 50,
    effort: 8,
    value: 5,
    matrixEffort: 9,
  },
];

export const MOSCOW_CONFIG: Record<
  MoSCoWCategory,
  { label: string; color: string; bg: string; borderColor: string }
> = {
  must: {
    label: "Must Have",
    color: "#ef4444",
    bg: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  should: {
    label: "Should Have",
    color: "#00f0ff",
    bg: "bg-cyan-400/10",
    borderColor: "border-cyan-400/30",
  },
  could: {
    label: "Could Have",
    color: "#ffaa00",
    bg: "bg-amber-400/10",
    borderColor: "border-amber-400/30",
  },
  wont: {
    label: "Won't Have",
    color: "#94a3b8",
    bg: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
};
