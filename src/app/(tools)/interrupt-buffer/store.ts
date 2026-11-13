/**
 * Interrupt Buffer's own record: where each sprint's Emergency Procedure
 * stands (when it was started and which steps are done). The buffer and the
 * interrupts themselves are workspace records, read by Sprint Planning, the
 * cockpit and Amr.
 */

import { createPersistedStore } from "@/lib/stores/create-persisted-store";
import { EMERGENCY_STEPS } from "@/lib/sprints/interrupts";

export interface EmergencyRun {
  /** ISO time it was started. */
  startedAt: string;
  /** Ids of the steps done (EMERGENCY_STEPS). */
  done: string[];
}

export interface InterruptBufferPrefs {
  /** By sprint id. */
  emergencies: Record<string, EmergencyRun>;
}

export const useInterruptBufferPrefs = createPersistedStore<InterruptBufferPrefs>(
  "interrupt-buffer",
  { emergencies: {} }
);

const STEP_IDS = new Set(EMERGENCY_STEPS.map((s) => s.id));

/** A sprint's run as read back: a known step only once; anything malformed is none. */
export function normalizeRun(value: unknown): EmergencyRun | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<EmergencyRun>;
  if (typeof v.startedAt !== "string" || !v.startedAt) return undefined;
  const done = Array.isArray(v.done)
    ? Array.from(
        new Set(v.done.filter((d): d is string => typeof d === "string" && STEP_IDS.has(d)))
      )
    : [];
  return { startedAt: v.startedAt, done };
}

export function emergencyFor(
  emergencies: InterruptBufferPrefs["emergencies"] | undefined,
  sprintId: string
): EmergencyRun | undefined {
  if (!emergencies || typeof emergencies !== "object") return undefined;
  return normalizeRun((emergencies as Record<string, unknown>)[sprintId]);
}
