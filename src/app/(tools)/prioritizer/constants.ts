/**
 * Backlog Prioritizer — new-item defaults + MoSCoW presentation config.
 *
 * There is no seed: a new backlog starts empty and offers "Load an example"
 * (see ./example.ts).
 */

import { createBacklogItem } from "@/lib/prioritization/frameworks";
import type { BacklogItem, MoSCoWCategory } from "./types";

export function createDefaultItem(): BacklogItem {
  return createBacklogItem("New Item");
}

export const MOSCOW_CONFIG: Record<
  MoSCoWCategory,
  { label: string; color: string; bg: string; borderColor: string }
> = {
  must: {
    label: "Must Have",
    color: "#ef4444",
    bg: "bg-danger/10",
    borderColor: "border-danger/30",
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
    bg: "bg-warning/10",
    borderColor: "border-warning/30",
  },
  wont: {
    label: "Won't Have",
    color: "#94a3b8",
    bg: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
};
