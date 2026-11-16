/**
 * Sprint Cockpit — tool-local actions.
 *
 * Category: Run the sprint (tools plan, phase 1)
 * Agent surface: tool.sprint.*
 *
 *   1. risk — read: is the sprint goal at risk, and why? The cockpit's goal
 *      check (lib/sprints/risk `sprintRisk`) over the same reads as the
 *      page: the burn off the sprint board (else the typed log) on the
 *      team's working days, the stories blocked in the sprint, the
 *      impediments in its way, and the interrupt buffer
 *      (lib/sprints/interrupts). Returns the level, the reasons, a thing
 *      to try for each, and the plain note the page shows without AI.
 *
 * Backing CRUD: workspace.sprint.*, workspace.sprint_series.*,
 * workspace.story.*, workspace.impediment.*, workspace.interrupt_item.*.
 * Example rows (`example-` ids) never count.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverListEntities } from "../server-store";
import { browserBurnStore, serverBurnStore, type BurnStore } from "./burndown";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  INTERRUPT_ITEM_KIND,
  type Impediment,
  type InterruptItem,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { burnSeries, burnStatus } from "@/lib/sprints/burn";
import { interruptBufferStatus } from "@/lib/sprints/interrupts";
import { impedimentCounts, riskNote, sprintRisk } from "@/lib/sprints/risk";
import { hasSyntheticDates, pickDefaultSprint } from "@/lib/sprints/series";
import { dayOf, isResolved, openDuring } from "@/lib/impediments/model";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";

const KIND_IMPEDIMENT = "workspace:impediment";

interface RiskStore extends BurnStore {
  impediments(): Promise<Impediment[]>;
  interrupts(): Promise<InterruptItem[]>;
}

const browserStore: RiskStore = {
  ...browserBurnStore,
  impediments: async () => useWorkspaceStore.getState().impediments ?? [],
  interrupts: async () => useWorkspaceStore.getState().interruptItems ?? [],
};

const serverStore = (userId: string): RiskStore => ({
  ...serverBurnStore(userId),
  impediments: () => serverListEntities<Impediment>(userId, KIND_IMPEDIMENT),
  interrupts: () => serverListEntities<InterruptItem>(userId, INTERRUPT_ITEM_KIND),
});

const real = <T extends { id: string }>(xs: readonly T[]) => xs.filter((x) => !isExampleId(x.id));

/**
 * The impediments in the sprint's way, unresolved: raised by its last day
 * and not resolved before its first, as the cockpit reads them. A sprint
 * without real dates gets every unresolved one.
 */
function openInWindow(all: readonly Impediment[], sprint: Sprint): Impediment[] {
  const open = all.filter((i) => !isResolved(i));
  if (hasSyntheticDates(sprint)) return open;
  const start = dayOf(sprint.startDate) as string;
  const end = dayOf(sprint.endDate) as string;
  return open.filter((i) => openDuring(i, start, end));
}

const ISO_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const RiskParams = z.object({
  sprintId: z
    .string()
    .max(128)
    .optional()
    .describe("The sprint; defaults to the active sprint, else the newest (as the cockpit opens)."),
  today: ISO_DATE.optional().describe(
    "Read the sprint as of this day; defaults to today (the server's day through MCP: pass the user's)."
  ),
});

export async function readRisk(store: RiskStore, params: z.infer<typeof RiskParams>) {
  const sprints = real(await store.sprints());
  if (sprints.length === 0) return { found: false as const, reason: "no_sprints" as const };
  const sprint = params.sprintId
    ? sprints.find((s) => s.id === params.sprintId)
    : pickDefaultSprint(sprints, null);
  if (!sprint) return { found: false as const, reason: "sprint_not_found" as const };
  const today = params.today ?? todayLocalISO();
  const [series, allStories, calendar, impediments, items] = await Promise.all([
    store.series(sprint.id),
    store.stories(),
    store.calendar(),
    store.impediments(),
    store.interrupts(),
  ]);
  const stories = real(allStories);
  // The cockpit's burn: the board while it has pointed stories, a closed sprint's log.
  const burn = burnSeries({ sprint, series, stories, calendar, today, recordedOnly: true });
  const status = burnStatus(burn, sprint);
  const blocked = stories.filter(
    (s) => s.sprintId === sprint.id && s.blocked && s.status !== "done"
  );
  const open = openInWindow(real(impediments), sprint);
  const buffer = interruptBufferStatus(sprint, real(items));
  const interrupts = buffer.set || buffer.total > 0 ? buffer : null;
  const counts = impedimentCounts(open, today);
  const risk = sprintRisk({
    sprint,
    burn,
    status,
    blockedStories: blocked.length,
    impediments: counts,
    interrupts,
  });
  return {
    found: true as const,
    sprint: {
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      ...(sprint.goal?.trim() ? { goal: sprint.goal.trim() } : {}),
    },
    today,
    day: burn.todayDay,
    lengthDays: burn.lengthDays,
    applies: risk.applies,
    notApplicable: risk.notApplicable,
    level: risk.level,
    headline: risk.headline,
    reasons: risk.reasons,
    note: riskNote(risk),
    facts: {
      source: burn.source,
      done: burn.done,
      remaining: burn.remaining,
      scopeNow: burn.scopeNow,
      gap: status.gap,
      projectedFinishDay: status.projectedFinishDay,
      willFinishOnTime: status.willFinishOnTime,
      blockedStories: blocked.map((s) => ({ id: s.id, title: s.title })),
      impediments: counts,
      interrupts: interrupts
        ? {
            state: interrupts.state,
            bufferPoints: interrupts.bufferPoints,
            usedPoints: interrupts.usedPoints,
            summary: interrupts.summary,
          }
        : null,
    },
  };
}

// ──────── tool.sprint.risk ────────
registry.register({
  id: "tool.sprint.risk",
  toolId: "tool.sprint",
  name: "risk",
  category: "read",
  description:
    "Is the sprint goal at risk, and why? The Sprint Cockpit's goal check, from the same reads as the page: the burn off the sprint board's pointed stories (else the typed daily log) on the team's working days, stories blocked in the sprint, the impediments in its way (open, high or critical, escalated, overdue) and the interrupt buffer. Params: sprintId? (default: the active sprint, else the newest), today? YYYY-MM-DD. Returns {found: false, reason: 'no_sprints' | 'sprint_not_found'} or {found: true, sprint {id, name, status, goal?}, today, day (today's sprint day, null outside it), lengthDays, applies (false before the start, after the last day, closed, or without dates), notApplicable ('closed' | 'undated' | 'before' | 'over' | null), level ('none' | 'watch' | 'at_risk': the worst reason's), headline, reasons: {id ('finish-late' | 'behind' | 'no-progress' | 'no-data' | 'cant-tell' | 'scope-grew' | 'blocked' | 'impediments' | 'interrupts'), level ('watch' | 'at_risk'), text, tryThis}[] (worst first), note (the page's plain 2–3 sentences without AI), facts {source, done, remaining, scopeNow, gap (positive = behind the ideal), projectedFinishDay, willFinishOnTime, blockedStories {id, title}[], impediments {open, severe, critical, escalated, overdue}, interrupts {state, bufferPoints, usedPoints, summary} | null}}. Read only; example rows never count.",
  paramsSchema: RiskParams,
  handler: async (params) => readRisk(browserStore, params),
  mcpHandler: async (params, ctx) => readRisk(serverStore(ctx.userId), params),
});
