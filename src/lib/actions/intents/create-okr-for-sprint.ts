import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Okr, KeyResult } from "@/lib/stores/workspace-types";

/**
 * Compose-action: create an OKR aligned with a sprint.
 *
 * The OKR's `quarter` field is computed from the sprint's startDate so
 * the resulting OKR slots into the right quarterly view automatically
 * (e.g. a sprint starting 2026-04-15 produces quarter "Q2 2026").
 *
 * Each Key Result is created with target=1, current=0 — the caller is
 * expected to refine the metric afterwards via workspace.okr.update.
 */

registry.register({
  id: "intent.create_okr_for_sprint",
  toolId: "intent",
  name: "create_okr_for_sprint",
  category: "intent",
  description:
    "Create a new OKR linked to a sprint. Quarter is derived from the sprint's startDate. Accepts 1–3 key result titles which become KRs with target=1, current=0.",
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

    // Derive quarter from sprint.startDate. Use UTC parsing — startDate
    // is an ISO yyyy-mm-dd; new Date("yyyy-mm-dd") parses as UTC, and
    // getMonth() in UTC is what we want for quarter math (local-tz
    // shifts would land an early-Jan UTC date in Q4 of the prior year
    // for users in negative offsets).
    const d = new Date(sprint.startDate);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Sprint ${params.sprintId} has invalid startDate.`);
    }
    const quarter = `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;

    const krs: KeyResult[] = params.keyResults.map((title) => ({
      id: `kr_${nanoid(8)}`,
      title,
      target: 1,
      current: 0,
    }));

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
});
