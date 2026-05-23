import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Compose-action: "what's going on in the workspace?"
 *
 * Returns a compact snapshot:
 *   - counts of every collection
 *   - the currently active sprint (if any)
 *   - top 3 open risks ranked by probability * impact
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

registry.register({
  id: "intent.summarize_workspace",
  toolId: "intent",
  name: "summarize_workspace",
  category: "read",
  description:
    "Return a compact JSON snapshot of the workspace: collection counts, the active sprint, top 3 open risks, and top 3 active impediments.",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();

    const counts = {
      teamMembers: s.teamMembers.length,
      sprints: s.sprints.length,
      stories: s.stories.length,
      impediments: s.impediments.length,
      risks: s.risks.length,
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

    const topRisks = s.risks
      .filter((r) => r.status === "open" || r.status === "mitigating")
      .slice()
      .sort((a, b) => b.probability * b.impact - a.probability * a.impact)
      .slice(0, 3)
      .map((r) => ({
        id: r.id,
        title: r.title,
        probability: r.probability,
        impact: r.impact,
        score: r.probability * r.impact,
        status: r.status,
      }));

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
});
