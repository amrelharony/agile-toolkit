import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverListEntities, serverGetWorkspaceBlob } from "../server-store";
import type { Sprint, Risk, Impediment } from "@/lib/stores/workspace-types";
import { isActiveRisk, riskScore } from "@/lib/risks/model";
import { isExampleId } from "@/lib/utils/example-id";
import { browserRiskStore, serverRiskStore } from "../tools/risk-register";

/**
 * Compose-action: "what's going on in the workspace?"
 *
 * Returns a compact snapshot:
 *   - counts of every collection (the risks as the Risk Register lists
 *     them: the old register page's rows still waiting for its one-time
 *     move included, as tool.risk_register.list_state counts them)
 *   - the currently active sprint (if any)
 *   - top 3 active (open or mitigating) risks ranked by the register's
 *     score, probability × impact (lib/risks), example rows left out
 *   - top 3 active impediments ranked by severity then recency
 *
 * Pure read — safe to call without confirmation.
 */

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** The 3 active risks with the highest score, example rows left out (they aren't the team's). */
function topOpenRisks(risks: readonly Risk[]) {
  return risks
    .filter((r) => isActiveRisk(r) && !isExampleId(r.id))
    .sort((a, b) => riskScore(b) - riskScore(a))
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      title: r.title,
      probability: r.probability,
      impact: r.impact,
      score: riskScore(r),
      status: r.status,
    }));
}

registry.register({
  id: "intent.summarize_workspace",
  toolId: "intent",
  name: "summarize_workspace",
  category: "read",
  description:
    "Return a compact JSON snapshot of the workspace: collection counts (risks: the risks the Risk Register lists, rows of the old register page not moved in yet included), the active sprint, the top 3 active (open or mitigating) risks by probability × impact (example rows left out), and the top 3 active impediments.",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();
    const risks = (await browserRiskStore.list()).records;

    const counts = {
      teamMembers: s.teamMembers.length,
      sprints: s.sprints.length,
      stories: s.stories.length,
      impediments: s.impediments.length,
      risks: risks.length,
      okrs: s.okrs.length,
      decisions: s.decisions.length,
      techDebt: s.techDebt.length,
      llmEvals: (s.llmEvals ?? []).length,
      prompts: (s.prompts ?? []).length,
      hallucinations: (s.hallucinations ?? []).length,
      tokenSpend: (s.tokenSpend ?? []).length,
      models: (s.models ?? []).length,
      redTeamFindings: (s.redTeamFindings ?? []).length,
      prioritizations: (s.prioritizations ?? []).length,
      daciDecisions: (s.daciDecisions ?? []).length,
      rapidDecisions: (s.rapidDecisions ?? []).length,
      weightedOptions: (s.weightedOptions ?? []).length,
      sixHatsThoughts: (s.sixHatsThoughts ?? []).length,
      oodaCycles: (s.oodaCycles ?? []).length,
      cynefinItems: (s.cynefinItems ?? []).length,
      polarities: (s.polarities ?? []).length,
      whiteboards: (s.whiteboards ?? []).length,
      whiteboardObjects: (s.whiteboardObjects ?? []).length,
    };

    const activeSprint = s.sprints.find((sp) => sp.status === "active") ?? null;

    const topRisks = topOpenRisks(risks);

    const topImpediments = s.impediments
      .filter((i) => !i.resolvedAt)
      .slice()
      .sort((a, b) => {
        const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
        if (sevDiff !== 0) return sevDiff;
        // Newer raisedAt first when severity ties.
        return b.raisedAt.localeCompare(a.raisedAt);
      })
      .slice(0, 3)
      .map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        raisedAt: i.raisedAt,
      }));

    return {
      counts,
      activeSprint: activeSprint
        ? {
            id: activeSprint.id,
            name: activeSprint.name,
            startDate: activeSprint.startDate,
            endDate: activeSprint.endDate,
            pointsPlanned: activeSprint.pointsPlanned,
            pointsCompleted: activeSprint.pointsCompleted ?? 0,
          }
        : null,
      topOpenRisks: topRisks,
      topActiveImpediments: topImpediments,
      teamName: s.teamName ?? null,
      maturityLevel: s.maturityLevel ?? null,
    };
  },
  mcpHandler: async (_params, ctx) => {
    // C1: server-side reads. Parallelise the per-kind queries since
    // the summary touches ~24 collections — sequential adds latency.
    const [
      teamMembers,
      sprints,
      stories,
      impediments,
      risks,
      okrs,
      decisions,
      techDebt,
      llmEvals,
      prompts,
      hallucinations,
      tokenSpend,
      models,
      redTeamFindings,
      prioritizations,
      daciDecisions,
      rapidDecisions,
      weightedOptions,
      sixHatsThoughts,
      oodaCycles,
      cynefinItems,
      polarities,
      whiteboards,
      whiteboardObjects,
      blob,
    ] = await Promise.all([
      serverListEntities(ctx.userId, "workspace:teamMember"),
      serverListEntities<Sprint>(ctx.userId, "workspace:sprint"),
      serverListEntities(ctx.userId, "workspace:story"),
      serverListEntities<Impediment>(ctx.userId, "workspace:impediment"),
      serverRiskStore(ctx.userId)
        .list()
        .then((r) => r.records),
      serverListEntities(ctx.userId, "workspace:okr"),
      serverListEntities(ctx.userId, "workspace:decision"),
      serverListEntities(ctx.userId, "workspace:techDebt"),
      serverListEntities(ctx.userId, "workspace:llmEval"),
      serverListEntities(ctx.userId, "workspace:prompt"),
      serverListEntities(ctx.userId, "workspace:hallucination"),
      serverListEntities(ctx.userId, "workspace:tokenSpend"),
      serverListEntities(ctx.userId, "workspace:model"),
      serverListEntities(ctx.userId, "workspace:redTeamFinding"),
      serverListEntities(ctx.userId, "workspace:prioritization"),
      serverListEntities(ctx.userId, "workspace:daciDecision"),
      serverListEntities(ctx.userId, "workspace:rapidDecision"),
      serverListEntities(ctx.userId, "workspace:weightedOption"),
      serverListEntities(ctx.userId, "workspace:sixHatsThought"),
      serverListEntities(ctx.userId, "workspace:oodaCycle"),
      serverListEntities(ctx.userId, "workspace:cynefinItem"),
      serverListEntities(ctx.userId, "workspace:polarity"),
      serverListEntities(ctx.userId, "workspace:whiteboard"),
      serverListEntities(ctx.userId, "workspace:whiteboardObject"),
      serverGetWorkspaceBlob(ctx.userId),
    ]);

    const counts = {
      teamMembers: teamMembers.length,
      sprints: sprints.length,
      stories: stories.length,
      impediments: impediments.length,
      risks: risks.length,
      okrs: okrs.length,
      decisions: decisions.length,
      techDebt: techDebt.length,
      llmEvals: llmEvals.length,
      prompts: prompts.length,
      hallucinations: hallucinations.length,
      tokenSpend: tokenSpend.length,
      models: models.length,
      redTeamFindings: redTeamFindings.length,
      prioritizations: prioritizations.length,
      daciDecisions: daciDecisions.length,
      rapidDecisions: rapidDecisions.length,
      weightedOptions: weightedOptions.length,
      sixHatsThoughts: sixHatsThoughts.length,
      oodaCycles: oodaCycles.length,
      cynefinItems: cynefinItems.length,
      polarities: polarities.length,
      whiteboards: whiteboards.length,
      whiteboardObjects: whiteboardObjects.length,
    };

    const activeSprint = sprints.find((sp) => sp.status === "active") ?? null;

    const topRisks = topOpenRisks(risks);

    const topImpediments = impediments
      .filter((i) => !i.resolvedAt)
      .slice()
      .sort((a, b) => {
        const sevDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
        if (sevDiff !== 0) return sevDiff;
        return b.raisedAt.localeCompare(a.raisedAt);
      })
      .slice(0, 3)
      .map((i) => ({
        id: i.id,
        title: i.title,
        severity: i.severity,
        raisedAt: i.raisedAt,
      }));

    return {
      counts,
      activeSprint: activeSprint
        ? {
            id: activeSprint.id,
            name: activeSprint.name,
            startDate: activeSprint.startDate,
            endDate: activeSprint.endDate,
            pointsPlanned: activeSprint.pointsPlanned,
            pointsCompleted: activeSprint.pointsCompleted ?? 0,
          }
        : null,
      topOpenRisks: topRisks,
      topActiveImpediments: topImpediments,
      teamName: (blob.teamName as string | undefined) ?? null,
      maturityLevel: (blob.maturityLevel as number | undefined) ?? null,
    };
  },
});
