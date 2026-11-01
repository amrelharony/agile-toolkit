import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { RICE } from "../prioritization/methods";
import { formatNumber, toChoice, toNumber } from "../prioritization/methods/fields";
import {
  LEGACY_REACH_PERIOD,
  REACH_PERIODS,
  REACH_PERIOD_LABEL,
  RICE_EFFORT_MIN,
  RICE_MOONSHOT_TEXT,
} from "../prioritization/methods/rice";
import type { RankedRow } from "../prioritization/rank";

/**
 * The initiatives as the RICE page reads them: its rows, scored by the
 * registry and read through to their backlog items (rankMethodRows), the
 * score outliers it flags (by row id; null below enough scores), and its
 * verdict.
 */
interface RiceData {
  rows: readonly RankedRow[];
  outliers?: ReadonlySet<string> | null;
  verdict?: string;
}

/** The table lists this many scored initiatives, in rank order. */
const MAX_ROWS = 20;

const inputLabel = (key: string) =>
  (RICE.inputs.find((i) => i.key === key)?.label ?? key).toLowerCase();

/** "“Onboarding” (needs reach, effort)" for the rows still waiting for a score. */
function unscoredLine(rows: readonly RankedRow[]): string {
  const waiting = rows.filter((r) => r.result.score === null);
  if (waiting.length === 0) return "";
  const named = waiting
    .slice(0, MAX_ROWS)
    .map(
      (r) =>
        `“${sanitizePromptCell(r.row.title, 80)}” (needs ${r.result.missing.map(inputLabel).join(", ")})`
    );
  const more = waiting.length > named.length ? ` and ${waiting.length - named.length} more` : "";
  return `\n\nNot scored yet: ${named.join("; ")}${more}.`;
}

/**
 * The backlog review prompt over the rows as the page shows them: reach as
 * entered with its period and the reach per quarter the score used, the
 * impact, the confidence, the effort in person-months (a legacy effort
 * below 0.5 counts as 0.5 and says so), RICE to one decimal place as the
 * rows read, and the rows still missing an input, never scored as 0.
 */
export function generateRicePrompts(
  data: RiceData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const scored = rows.filter((r) => r.result.score !== null);
  const table =
    scored.length === 0
      ? "No initiative is scored yet."
      : formatTable(
          [
            "#",
            "Initiative",
            "Reach",
            "Reach per quarter",
            "Impact",
            "Confidence",
            "Effort (person-months)",
            "RICE",
            "Note",
          ],
          scored.slice(0, MAX_ROWS).map((r) => {
            const period = toChoice(REACH_PERIODS, r.values.reachPeriod) ?? LEGACY_REACH_PERIOD;
            const n = (key: string, digits: number) =>
              formatNumber(toNumber(r.values[key]) ?? 0, digits);
            return [
              r.rank ?? "—",
              r.row.title,
              `${n("reach", 1)} ${REACH_PERIOD_LABEL[period]}`,
              formatNumber(toNumber(r.result.extra?.reachPerQuarter) ?? 0, 1),
              n("impact", 2),
              `${n("confidence", 1)}%`,
              n("effort", 2),
              RICE.format(r.result.score as number),
              r.result.warnings.join(" ") || "—",
            ];
          })
        );
  const more =
    scored.length > MAX_ROWS
      ? `\n(Showing ${MAX_ROWS} of ${scored.length} scored initiatives)`
      : "";
  const outliers = data.outliers ? scored.filter((r) => data.outliers?.has(r.row.id)) : [];
  const outlierLines =
    outliers.length > 0
      ? `\n\n## Outliers (recheck inputs)\n\n${outliers
          .map(
            (r) =>
              `- ${sanitizePromptCell(r.row.title, 120)}: RICE ${RICE.format(r.result.score as number)}`
          )
          .join("\n")}`
      : "";
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  const moonshot = RICE_MOONSHOT_TEXT.replace(/\.$/, "");
  // Titles are user-typed, and the verdict names them.
  const body = wrapUserContent(`${verdict}${table}${more}${unscoredLine(rows)}${outlierLines}`);
  return [
    {
      id: "rice-review",
      title: "Backlog Review",
      description: "Pressure-test the top scores: are inputs realistic, or padded?",
      prompt:
        buildPreamble(
          "RICE Scoring",
          `It scores initiatives as reach per quarter × impact × confidence ÷ effort. Reach is counted per week, month, quarter or year and normalised to per quarter so items compare; impact is per person reached (3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal); confidence is 100% backed by data, 80% some evidence, 50% mostly a guess (${moonshot.charAt(0).toLowerCase()}${moonshot.slice(1)}); effort is person-months, ${RICE_EFFORT_MIN} at least.`
        ) +
        `## Ranked initiatives\n\n${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Which top-ranked items have suspiciously high inputs? Recheck them.\n` +
        `2. Are any items missing entirely (strategic bets, table-stakes)?\n` +
        `3. Recommend a quarterly cut line and the rationale.\n` +
        `4. For low-confidence items, what cheap experiment could lift confidence to 80%?\n` +
        `5. Are 'Effort' estimates calibrated against actuals from past sprints?`,
    },
  ];
}
