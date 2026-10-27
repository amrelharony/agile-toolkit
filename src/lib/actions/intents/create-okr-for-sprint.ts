import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { Okr, KeyResult, Sprint } from "@/lib/stores/workspace-types";
import { quarterLabel } from "@/lib/roadmap/quarters";

/**
 * The quarter a sprint starts in, as the OKR page and its quarter picker
 * write it ("2026 Q2"). Before Phase 8 this wrote "Q2 2026", which the
 * page's quarter filter and picker didn't read as their own form.
 *
 * UTC parsing: startDate is an ISO yyyy-mm-dd, which `new Date` parses as
 * UTC midnight, so the UTC month is the day's own (a local-tz read would
 * put an early-January start in Q4 of the year before, west of UTC).
 */
function quarterFromSprintStart(startDate: string, sprintId: string): string {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Sprint ${sprintId} has invalid startDate.`);
  }
  return quarterLabel(d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3) + 1);
}

/**
 * The key results the intent creates: each counted from 0 (its baseline,
 * so progress reads from where it starts, as every new key result does
 * since Phase 8) to a target of 1. The caller is expected to refine the
 * metric afterwards via workspace.okr.update, and check in values with
 * tool.okrs.check_in.
 */
function newKeyResults(titles: readonly string[]): KeyResult[] {
  return titles.map(
    (title): KeyResult => ({
      id: `kr_${nanoid(8)}`,
      title,
      target: 1,
      current: 0,
      baseline: 0,
      direction: "increase",
      checkIns: [],
    })
  );
}

/**
 * Compose-action: create an OKR aligned with a sprint.
 *
 * The OKR's `quarter` field is computed from the sprint's startDate so
 * the resulting OKR slots into the right quarterly view automatically
 * (e.g. a sprint starting 2026-04-15 produces quarter "2026 Q2").
 *
 * It links nothing: Sprint Goal is the one writer of a goal's OKR links
 * (tool.sprint_goal.link_okr).
 */

registry.register({
  id: "intent.create_okr_for_sprint",
  toolId: "intent",
  name: "create_okr_for_sprint",
  category: "intent",
  description:
    "Create a new OKR for a sprint's quarter. Quarter is derived from the sprint's startDate ('2026 Q2', the OKR page's form). Accepts 1–3 key result titles which become KRs counted from a baseline of 0 to target=1 (current=0). It links nothing to the sprint: link the OKR from the sprint's goal with tool.sprint_goal.link_okr.",
  paramsSchema: z.object({
    sprintId: z.string(),
    objective: z.string(),
    keyResults: z.array(z.string()).min(1).max(3),
    owner: z.string().optional(),
  }),
  handler: async (params: {
    sprintId: string;
    objective: string;
    keyResults: string[];
    owner?: string;
  }) => {
    const state = useWorkspaceStore.getState();
    const sprint = state.sprints.find((s) => s.id === params.sprintId);
    if (!sprint) throw new Error(`Sprint ${params.sprintId} not found.`);

    const quarter = quarterFromSprintStart(sprint.startDate, params.sprintId);
    const krs = newKeyResults(params.keyResults);

    const okr: Okr = {
      id: `okr_${nanoid(8)}`,
      objective: params.objective,
      keyResults: krs,
      quarter,
      owner: params.owner,
    };

    useWorkspaceStore.getState().upsertOkr(okr);

    return {
      okrId: okr.id,
      quarter,
      sprintName: sprint.name,
      keyResultIds: krs.map((k) => k.id),
    };
  },
  mcpHandler: async (params, ctx) => {
    const sprint = await serverGetEntity<Sprint>(ctx.userId, "workspace:sprint", params.sprintId);
    if (!sprint) throw new Error(`Sprint ${params.sprintId} not found.`);
    const quarter = quarterFromSprintStart(sprint.startDate, params.sprintId);
    const krs = newKeyResults(params.keyResults);
    const okr: Okr = {
      id: `okr_${nanoid(8)}`,
      objective: params.objective,
      keyResults: krs,
      quarter,
      owner: params.owner,
    };
    await serverUpsertEntity<Okr>(ctx.userId, "workspace:okr", okr);
    return {
      okrId: okr.id,
      quarter,
      sprintName: sprint.name,
      keyResultIds: krs.map((k) => k.id),
    };
  },
});
