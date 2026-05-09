import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface SloRow {
  name: string;
  target: number; // 0-1
  windowDays: number;
  errorBudgetMinutes: number;
  consumedMinutes: number;
  remainingPct: number; // 0-100
  sliDescription: string;
  description?: string;
}

/**
 * AI prompts for the SLO & Error Budget Builder.
 *
 * The two prompts cover:
 *   1. Posture — how is the budget doing right now?
 *   2. Target review — are the SLO targets right for the team's reality?
 */
export function generateSloPrompts(data: {
  slos: SloRow[];
}): PromptDefinition[] {
  if (data.slos.length === 0) return [];
  const sloTable = formatTable(
    [
      "SLO",
      "Target",
      "Window (d)",
      "Budget (min)",
      "Consumed",
      "Remaining",
      "Description",
    ],
    data.slos.map((s) => [
      s.name,
      `${(s.target * 100).toFixed(2)}%`,
      s.windowDays,
      s.errorBudgetMinutes.toFixed(1),
      s.consumedMinutes.toFixed(1),
      `${s.remainingPct.toFixed(1)}%`,
      (s.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "slo-posture",
      title: "Error Budget Posture",
      description:
        "Assess current burn-rate posture and recommend response (freeze, slow rollouts, etc.).",
      prompt:
        buildPreamble(
          "SLO & Error Budget Builder",
          `${data.slos.length} SLO(s) defined. Snapshot of remaining error budget below.`
        ) +
        `## SLOs\n\n${sloTable}\n\n## Questions\n\n1. Which SLOs are on track, which are at risk (>50% consumed), and which have already burned through?\n2. For at-risk SLOs, what response is appropriate (slow rollouts, freeze, postmortem, etc.)?\n3. Are there any signals of correlated failure across multiple SLOs?`,
    },
    {
      id: "slo-target-review",
      title: "SLO Target Review",
      description:
        "Critique each SLO target — is it achievable, meaningful, and tied to user experience?",
      prompt:
        buildPreamble(
          "SLO & Error Budget Builder",
          `Targets cover ${data.slos.length} SLI(s).`
        ) +
        `## SLOs\n\n${sloTable}\n\n## Questions\n\n1. Critique each SLO target — too tight (constant alerts), too loose (gives false comfort), or just right?\n2. Are the SLI descriptions tied to a user-perceivable outcome, or are they vanity uptime numbers?\n3. Suggest a small revision for any SLO whose target/window combination feels misaligned with the team's actual operational tempo.`,
    },
  ];
}
