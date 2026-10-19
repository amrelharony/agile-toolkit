/**
 * Hand-off target: a risk.
 *
 * The Risk Register edits its own cloud blob (`agile-toolkit:risk-register`)
 * and exchanges rows with workspace.risks through Import / Push. A hand-off
 * writes both with the same id: the blob, so the register lists it, and the
 * workspace row, so dashboards and agents see it. The register's Import
 * skips ids it already has, so the two never double up.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { setCloudPersistedValue } from "@/lib/sync/use-cloud-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { HandoffRoute, HandoffSource } from "../types";

/** MUST match the key the Risk Register passes to usePersisted. */
export const RISK_REGISTER_KEY = "agile-toolkit:risk-register";

/** The Risk Register's blob as stored, or [] when absent or unreadable.
 *  Rows are kept as they are; a write only adds or drops one by id. */
export function readRiskRegister(): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RISK_REGISTER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasId(row: unknown, id: string): boolean {
  return Boolean(row) && typeof row === "object" && (row as { id?: unknown }).id === id;
}

/** A 1–5 score; anything else falls back to the register's default, 3. */
function score(n: number | undefined): Risk["probability"] {
  if (typeof n !== "number" || !Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n))) as Risk["probability"];
}

export function buildRisk(src: HandoffSource, id = crypto.randomUUID()): Risk {
  const mitigation = (src.mitigation ?? "").trim();
  return {
    id,
    title: src.title.trim().slice(0, 500),
    probability: score(src.likelihood),
    impact: score(src.impact),
    ...(mitigation ? { mitigation } : {}),
    status: "open",
    raisedAt: todayLocalISO(),
    sourceRef: src.sourceRef,
  };
}

export const riskRoute: HandoffRoute = {
  id: "risk",
  label: "Risk",
  doneLabel: "Added to the Risk Register",
  targetToolId: "risk-register",
  targetHref: () => "/risk-register",
  send: (src) => {
    const risk = buildRisk(src);
    // Newest first, the way the register adds its own.
    setCloudPersistedValue(RISK_REGISTER_KEY, [risk, ...readRiskRegister()]);
    useWorkspaceStore.getState().upsertRisk(risk);
    return risk.id;
  },
  remove: (id) => {
    const blob = readRiskRegister();
    if (blob.some((r) => hasId(r, id))) {
      setCloudPersistedValue(
        RISK_REGISTER_KEY,
        blob.filter((r) => !hasId(r, id))
      );
    }
    if ((useWorkspaceStore.getState().risks ?? []).some((r) => r.id === id)) {
      useWorkspaceStore.getState().removeRisk(id);
    }
  },
  exists: (id) =>
    readRiskRegister().some((r) => hasId(r, id)) ||
    (useWorkspaceStore.getState().risks ?? []).some((r) => r.id === id),
};
