/**
 * Flow Insights' example: the Checkout team's last six two-week sprints,
 * held in memory only (`example-` ids) and never written to the workspace.
 * Sorting in the example edits this copy.
 *
 * The mix drifts from mostly features (about 65/15/15/5) to much more
 * repeat work (about 45/35/10/10): Eli leaves and Fay joins in sprint 4,
 * and defects rise after it. Two stories are reopened. Each sprint has its
 * own capacity plan, and the target mix is 60/15/15/10. Some items have
 * their type set, some are guessed from their titles and tags, and a few
 * are not sorted, so every section has something to show.
 */

import type { CapacityPlan, Sprint, Story, WorkflowDefinition } from "@/lib/stores/workspace-types";
import { WORKFLOW_DEFINITION_ID } from "@/lib/stores/workspace-types";
import { capacityPlanIdFor } from "@/lib/sprints/capacity";
import { addDays } from "@/lib/flow";
import { exampleId } from "@/lib/utils/example-id";
import type { FlowData } from "./model";

/** Finished per sprint: feature, defect, debt, risk. */
const MIX: readonly [number, number, number, number][] = [
  [7, 1, 2, 1],
  [6, 2, 2, 0],
  [6, 1, 1, 1],
  [5, 3, 1, 1],
  [4, 4, 1, 1],
  [5, 4, 1, 2],
];

const FEATURES = [
  "Pay with a saved card",
  "Show delivery dates at checkout",
  "Apple Pay on mobile",
  "Gift messages on orders",
  "Split payment across two cards",
  "Guest checkout without an account",
  "Order summary email",
  "Postcode lookup for addresses",
  "Save a basket for later",
  "Vouchers on the payment step",
];
const DEFECTS = [
  "Fix totals when a voucher is removed",
  "Fix double charge on a slow network",
  "Fix the address form on small screens",
  "Bug: VAT rounding on mixed baskets",
  "Fix the empty-basket crash",
  "Fix stale stock counts at checkout",
];
const DEBT = [
  "Refactor the basket service",
  "Upgrade the payments SDK",
  "Clean up the old promo code",
];
const RISK = ["Spike: fraud checks for new cards", "Security review of stored cards"];

const TEAM_BEFORE = ["Ana", "Ben", "Chris", "Dee", "Eli"];
const TEAM_AFTER = ["Ana", "Ben", "Chris", "Dee", "Fay"];

/** The UTC stamp of a local time on `day`. */
function local(day: string, hour = 15): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
}

const day = (from: string, n: number) => addDays(from, n) as string;

function storiesFor(sprint: Sprint, n: number, team: readonly string[]): Story[] {
  const [features, defects, debt, risk] = MIX[n];
  const out: Story[] = [];
  let k = 0;
  const add = (title: string, patch: Partial<Story> = {}) => {
    const doneDay = day(sprint.startDate, 2 + (k % 9));
    out.push({
      id: exampleId(`flow-${n + 1}-${k + 1}`),
      title,
      status: "done",
      sprintId: sprint.id,
      points: [1, 2, 3, 5][k % 4],
      owner: team[k % team.length],
      createdAt: local(day(sprint.startDate, -3), 10),
      startedAt: local(day(doneDay, -2), 9),
      doneAt: local(doneDay),
      ...patch,
    });
    k++;
  };
  for (let i = 0; i < features; i++) {
    const title = FEATURES[(n * 3 + i) % FEATURES.length];
    // Two features a sprint are left for the team to sort.
    add(title, i < 2 ? {} : { workType: "feature" });
  }
  for (let i = 0; i < defects; i++) {
    const title = DEFECTS[(n + i) % DEFECTS.length];
    // Most defects are guessed from a "Fix …" or "Bug" title; one a sprint is set.
    add(title, i === 0 ? { workType: "defect" } : {});
  }
  for (let i = 0; i < debt; i++) {
    add(DEBT[(n + i) % DEBT.length], { tags: ["refactor"] });
  }
  for (let i = 0; i < risk; i++) {
    add(RISK[(n + i) % RISK.length], i === 0 ? { workType: "risk" } : { tags: ["spike"] });
  }
  return out;
}

/** A story reopened once: done, back to in progress, done again. */
function reopened(story: Story): Story {
  const done = story.doneAt as string;
  const first = new Date(Date.parse(done) - 2 * 86_400_000).toISOString();
  const back = new Date(Date.parse(done) - 86_400_000).toISOString();
  return {
    ...story,
    statusHistory: [
      { status: "todo", at: story.createdAt as string },
      { status: "in_progress", from: "todo", at: story.startedAt as string },
      { status: "done", from: "in_progress", at: first },
      { status: "in_progress", from: "done", at: back },
      { status: "done", from: "in_progress", at: done },
    ],
  };
}

function planFor(sprint: Sprint, team: readonly string[]): CapacityPlan {
  return {
    id: capacityPlanIdFor(sprint.id),
    sprintId: sprint.id,
    members: team.map((name) => ({
      id: exampleId(`flow-member-${name.toLowerCase()}`),
      name,
      role: "Developer",
      availability: 100,
      daysOff: 0,
    })),
    config: {
      sprintDays: 10,
      ceremonyOverhead: 10,
      focusFactor: 0.8,
      hoursPerDay: 6,
      pointsCommitted: "",
    },
  };
}

/** The example, with dates relative to `today` ("YYYY-MM-DD"): the last sprint ended yesterday. */
export function buildExample(today: string): FlowData {
  const sprints: Sprint[] = MIX.map((_, n) => {
    const end = day(today, -1 - (MIX.length - 1 - n) * 14);
    return {
      id: exampleId(`flow-sprint-${n + 1}`),
      name: `Checkout sprint ${n + 1}`,
      startDate: day(end, -11),
      endDate: end,
      pointsPlanned: 30,
      status: "completed",
    };
  });
  const stories = sprints.flatMap((s, n) => {
    const team = n < 3 ? TEAM_BEFORE : TEAM_AFTER;
    const list = storiesFor(s, n, team);
    // One reopened story in each of the last two sprints.
    if (n >= 4) list[0] = reopened(list[0]);
    return list;
  });
  sprints.forEach((s) => {
    s.pointsCompleted = stories
      .filter((st) => st.sprintId === s.id)
      .reduce((sum, st) => sum + (st.points ?? 0), 0);
  });
  const plans = sprints.map((s, n) => planFor(s, n < 3 ? TEAM_BEFORE : TEAM_AFTER));
  const workflow: WorkflowDefinition = {
    id: WORKFLOW_DEFINITION_ID,
    workTypes: [
      { type: "feature", targetPct: 60 },
      { type: "defect", targetPct: 15 },
      { type: "debt", targetPct: 15 },
      { type: "risk", targetPct: 10 },
    ],
  };
  return { stories, sprints, board: null, plans, workflow };
}
