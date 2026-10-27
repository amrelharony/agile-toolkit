import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Assumption, Hypothesis, Workspace } from "../stores/workspace-types";
import { quadrantOf, ratingOf } from "../assumptions/model";
import { linkedTest, type LinkedTest } from "../hypotheses/model";
import {
  QUADRANTS,
  assumptionsVerdict,
  canvasView,
  resultText,
  statusLabel,
} from "@/app/(tools)/riskiest-assumption/view";

/**
 * The canvas as the Riskiest Assumption page ranks it: the rows it counts
 * (the team's own, or the example's while it holds nothing else) and the
 * Hypothesis Tracker's list, whose results take a tested assumption out
 * of the ranking.
 */
interface AssumptionData {
  assumptions: readonly Assumption[];
  hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
}

/** The table ranks this many; the not-rated and tested lists name this many each. */
const MAX_ROWS = 20;

/** A statement for a sentence: sanitised, cut at 80. */
const quote = (a: Assumption) => `“${sanitizePromptCell(a.statement || "Untitled", 80)}”`;

/** Where its hypothesis stands; an inconclusive result keeps it ranked, to test again. */
function testText(t: LinkedTest): string {
  if (t.state === "none") return "—";
  if (t.state === "testing") return `testing (${t.status})`;
  return t.result === "inconclusive" ? "tested: inconclusive (test again)" : `tested: ${t.result}`;
}

/** "“A”; “B” and 3 more", for the lists beside the ranking. */
function named(list: readonly string[]): string {
  const shown = list.slice(0, MAX_ROWS);
  const more = list.length > shown.length ? ` and ${list.length - shown.length} more` : "";
  return `${shown.join("; ")}${more}`;
}

/**
 * The assumption prompts with the page's ranking (lib/assumptions
 * rankAssumptions, the order tool.riskiest_assumption gives): risk ×
 * (6 − evidence), ties to the higher risk, then the lower evidence, then
 * the order added. An assumption that is tested (its status, or its
 * hypothesis's validated or invalidated result) leaves the ranking and is
 * listed apart; an unrated one is never scored and is named as such. An
 * inconclusive test keeps it ranked.
 */
export function generateRiskiestAssumptionPrompts(
  data: AssumptionData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { assumptions } = data;
  if (assumptions.length === 0) return [];
  const hypotheses = data.hypotheses ?? [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const view = canvasView(assumptions, hypotheses);

  const table =
    view.ranked.length === 0
      ? "Nothing is ranked yet."
      : formatTable(
          [
            "#",
            "Assumption",
            "Risk",
            "Evidence",
            "Score",
            "Quadrant",
            "Status",
            "Test",
            "Test idea",
          ],
          view.ranked.slice(0, MAX_ROWS).map((r) => {
            const a = r.assumption;
            return [
              r.rank,
              a.statement.slice(0, 80) || "Untitled",
              ratingOf(a.riskLevel) as number,
              ratingOf(a.evidenceLevel) as number,
              r.score,
              QUADRANTS.find((q) => q.id === quadrantOf(a))?.label ?? "—",
              statusLabel(a.status),
              testText(linkedTest(a.sentTo, hypotheses)),
              (a.testIdea ?? "").slice(0, 60) || "—",
            ];
          })
        );
  const more =
    view.ranked.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${view.ranked.length} ranked)` : "";
  const unrated =
    view.unrated.length === 0
      ? ""
      : `\n\nNot rated yet, so not ranked: ${named(
          view.unrated.map((a) => {
            const needs = [
              ratingOf(a.riskLevel) === null ? "risk" : "",
              ratingOf(a.evidenceLevel) === null ? "evidence" : "",
            ].filter(Boolean);
            return `${quote(a)} (needs ${needs.join(" and ")})`;
          })
        )}.`;
  const tested =
    view.tested.length === 0
      ? ""
      : `\n\nTested, so out of the ranking: ${named(
          view.tested.map((a) => `${quote(a)} (${resultText(a, hypotheses).toLowerCase()})`)
        )}.`;
  const verdict = `Verdict: ${sanitizePromptCell(assumptionsVerdict(view), 400)}\n\n`;
  // Statements, test ideas and the verdict that names them are user-typed.
  const body = wrapUserContent(`${verdict}${table}${more}${unrated}${tested}`);
  const counts = `${assumptions.length} assumptions logged: ${view.ranked.length} ranked, ${view.unrated.length} not rated, ${view.tested.length} tested. ${view.untestedRisky} ranked with risk 4 or 5 and no test yet.`;

  return [
    {
      id: "ra-ranking",
      title: "Riskiest assumption ranking critique",
      description: "Critique whether the team has correctly ranked assumption risk × evidence.",
      prompt:
        buildPreamble(
          "Riskiest Assumption Canvas",
          `${counts} Ranked by risk × (6 − evidence), each rated 1–5; ties go to the higher risk, then the lower evidence.`
        ) +
        `## Assumptions, riskiest first\n\n${body}${context}\n\n## Questions\n\n1. Are the top-3 ranked assumptions truly the riskiest, or has the team over-/under-rated specific items?\n2. Which assumptions look conflated (multiple risks bundled into one statement) and should be split?\n3. Are there obvious assumptions the team has missed (e.g. willingness to pay, channel viability, regulatory)?\n4. Recommend the next assumption to test and explain why it dominates the others.`,
    },
    {
      id: "ra-testdesign",
      title: "Test-design coaching",
      description: "Coach the team on designing the cheapest test for each top assumption.",
      prompt:
        buildPreamble(
          "Riskiest Assumption Canvas",
          `${counts} Coaching focus: turn the top untested assumptions into the smallest credible experiment.`
        ) +
        `## Top assumptions\n\n${body}${context}\n\n## Questions\n\n1. For each of the top-3 assumptions, propose a test that is ≤ 1 week of effort and produces a clear signal.\n2. Specify the metric, the success threshold, and what an "invalidated" outcome looks like for each.\n3. Where existing test ideas are weak (vague, unmeasurable, or disguised opinion-gathering), say so and rewrite them.\n4. Which assumptions cannot be tested cheaply and therefore require betting (and what would derisk the bet)?`,
    },
  ];
}
