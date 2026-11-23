/**
 * Product Canvas's data-aware next steps (lib/tools/next-steps.ts calls
 * `productCanvasSteps` with the workspace's canvases, goals and the
 * Hypothesis Tracker's document). Example canvases are left out.
 *
 *   1. product-canvas-goal:  canvases, but no active Product Goal to serve
 *   2. product-canvas-tests: lines the canvases sent that are still drafted
 *                            or running in the Hypothesis Tracker
 *   3. product-canvas-inbox: new ideas logged more than INBOX_WAIT_DAYS days
 *                            ago and still not looked at
 *   4. product-canvas-cycle: a bet still running after its cycle ended
 *
 * The rule passes no day: `today` defaults to the local one. Pure: no
 * store, no React, no "use client" module.
 */

import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import { activeGoal } from "@/lib/product-goal/model";
import { addDays } from "@/lib/flow/days";
import { localDay, todayIso } from "@/lib/sprints/series";
import type { HypothesisTracker, ProductCanvas, ProductGoal } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { outOfTime } from "./bets";
import { cycleEnd, cycleName } from "./fields";
import { ideasOf } from "./intake";
import { readCanvases } from "./model";

/** A new idea waits this many days before the step asks for its triage. */
export const INBOX_WAIT_DAYS = 14;

/** What the rule reads from the workspace. */
export interface ProductCanvasStepsInput {
  canvases: readonly ProductCanvas[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
  /** YYYY-MM-DD; the local day when left out (the rule leaves it out). */
  today?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (text: string, max = 40) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** Product Canvas's next steps. */
export function productCanvasSteps(s: ProductCanvasStepsInput): NextStep[] {
  const today = s.today ?? todayIso();
  const canvases = readCanvases(s.canvases).filter((c) => !isExampleId(c.id));
  if (canvases.length === 0) return [];
  const steps: NextStep[] = [];
  if (!activeGoal(s.goals)) {
    steps.push({
      id: "product-canvas-goal",
      label: "Write the Product Goal these canvases serve",
      detail: `${plural(canvases.length, "canvas", "canvases")}, and no active Product Goal to draft from or check against.`,
      href: "/product-goal",
    });
  }
  const hypotheses = (s.trackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses;
  let testing = 0;
  for (const c of canvases) {
    for (const items of Object.values(c.sections)) {
      for (const item of items) {
        if (linkedTest(item.sentTo, hypotheses).state === "testing") testing++;
      }
    }
  }
  if (testing > 0) {
    steps.push({
      id: "product-canvas-tests",
      label: `Run the ${plural(testing, "test")} your canvases sent`,
      detail: `${testing === 1 ? "It is" : "They are"} still drafted or running in the Hypothesis Tracker.`,
      href: "/hypothesis-tracker",
    });
  }
  const cutoff = addDays(today, -INBOX_WAIT_DAYS);
  const waiting = cutoff
    ? ideasOf(canvases).filter((c) => {
        const day = localDay(c.createdAt);
        return c.intake?.status === "new" && day !== null && day < cutoff;
      }).length
    : 0;
  if (waiting > 0) {
    steps.push({
      id: "product-canvas-inbox",
      label: `Triage ${plural(waiting, "waiting idea")}`,
      detail: `${waiting === 1 ? "It has" : "They have"} been new in the inbox for over ${INBOX_WAIT_DAYS} days. Assess, accept, decline or merge ${waiting === 1 ? "it" : "each one"}.`,
      href: "/product-canvas?format=idea",
    });
  }
  const late = outOfTime(canvases, today);
  if (late.length > 0) {
    const first = late[0];
    const end = cycleEnd(first.bet?.start, first.bet?.weeks);
    const others = late.length - 1;
    steps.push({
      id: "product-canvas-cycle",
      label: `Decide on “${short(first.title)}”: its cycle ended`,
      detail: `${first.bet?.cycle !== undefined ? cycleName(first.bet.cycle) : "Its cycle"} ended on ${end}. Ship what's done, cut it or reshape it: bets don't roll over.${others > 0 ? ` ${plural(others, "other bet")} ${others === 1 ? "is" : "are"} out of time too.` : ""}`,
      href: `/product-canvas?canvas=${encodeURIComponent(first.id)}`,
    });
  }
  return steps;
}
