"use client";

import { useMemo } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DesignSprint, DesignSprintPlan } from "@/lib/stores/workspace-types";
import { cadenceCalendar, normalizeCadence } from "@/lib/sprints/cadence";
import { selectCadenceDoc } from "@/lib/sprints/use-ceremony-cadence";
import type { WorkingCalendar } from "@/lib/sprints/calendar";
import { withShownDesignSprintDay } from "@/lib/design-sprint/day";
import { todayLocalISO } from "@/lib/utils/formatters";
import { DS_ID } from "./doc";

/**
 * The design sprint lives in one synced workspace document (`DS_ID`), so an
 * agent's writes (tool.design_sprint.*) show here and the page's reach the
 * agent. Every write reads the stored plan at that moment and changes only
 * what it means to, so a concurrent edit elsewhere in the plan survives.
 */

const ws = () => useWorkspaceStore.getState();

function storedDoc(): DesignSprint | undefined {
  return (ws().designSprints ?? []).find((d) => d.id === DS_ID);
}

export function readPlan(): DesignSprintPlan | null {
  return storedDoc()?.sprint ?? null;
}

/** The team's working days and holidays (the ceremony cadence), which place the five days. */
export function teamCalendar(state = ws()): WorkingCalendar {
  return cadenceCalendar(normalizeCadence(selectCadenceDoc(state)));
}

/**
 * `currentDay` is no longer where the page reads the day from (it is
 * derived from the start date), but older readers still read it, so each
 * write keeps it at the day the page shows today. Looking at another day
 * never changes it.
 */
export function withShownDay(
  plan: DesignSprintPlan,
  today: string = todayLocalISO(),
  calendar: WorkingCalendar = teamCalendar()
): DesignSprintPlan {
  return withShownDesignSprintDay(plan, today, calendar);
}

/** Store `plan` exactly as given: Undo puts back the copy it took. */
export function writePlanRaw(plan: DesignSprintPlan | null): void {
  ws().upsertDesignSprint({ ...storedDoc(), id: DS_ID, sprint: plan });
}

/** Store a new or changed plan. */
export function savePlan(plan: DesignSprintPlan): void {
  writePlanRaw(withShownDay(plan));
}

/** Change the stored plan; false when there is none. */
export function updatePlan(fn: (plan: DesignSprintPlan) => DesignSprintPlan): boolean {
  const current = readPlan();
  if (!current) return false;
  savePlan(fn(current));
  return true;
}

export function useDesignSprintPlan(): DesignSprintPlan | null {
  return useWorkspaceStore(
    (s) => (s.designSprints ?? []).find((d) => d.id === DS_ID)?.sprint ?? null
  );
}

export function useTeamCalendar(): WorkingCalendar {
  const doc = useWorkspaceStore(selectCadenceDoc);
  return useMemo(() => cadenceCalendar(normalizeCadence(doc)), [doc]);
}
