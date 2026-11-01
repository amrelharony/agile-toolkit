import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { WSJF } from "../prioritization/methods";
import { FIBONACCI_TEXT, isFibonacci } from "../prioritization/methods/fibonacci";
import { formatNumber, toNumber } from "../prioritization/methods/fields";
import { WSJF_JOB_SIZE_MIN, WSJF_KEYS, WSJF_LABEL } from "../prioritization/methods/wsjf";
import type { RankedRow } from "../prioritization/rank";

/**
 * The features as the WSJF page reads them: its rows, scored by the
 * registry and read through to their backlog items (rankMethodRows), and
 * its verdict.
 */
interface WsjfData {
  rows: readonly RankedRow[];
  verdict?: string;
}

/** The table lists this many scored features, in rank order. */
const MAX_ROWS = 20;

/** A part as the row shows it: "8", an off-scale "7 (custom)", or "—" when not scored. */
function partText(v: number | string | undefined): string {
  const n = toNumber(v);
  if (n === undefined) return "—";
  return isFibonacci(n) ? formatNumber(n, 2) : `${formatNumber(n, 2)} (custom)`;
}

/** "“Login” (needs job size)" for the features still waiting for a score. */
function unscoredLine(rows: readonly RankedRow[]): string {
  const waiting = rows.filter((r) => r.result.score === null);
  if (waiting.length === 0) return "";
  const named = waiting.slice(0, MAX_ROWS).map((r) => {
    // In the parts' order, each once (a job size of 0 is listed missing twice).
    const needs = WSJF_KEYS.filter((k) => r.result.missing.includes(k))
      .map((k) => WSJF_LABEL[k].toLowerCase())
      .join(", ");
    return `“${sanitizePromptCell(r.row.title, 80)}” (needs ${needs})`;
  });
  const more = waiting.length > named.length ? ` and ${waiting.length - named.length} more` : "";
  return `\n\nNot scored yet: ${named.join("; ")}${more}.`;
}

/**
 * The sequencing prompt over the features as the page shows them: every
 * part on the modified Fibonacci scale (an off-scale stored value marked
 * custom, never snapped), the cost of delay, WSJF to two places with the
 * job size floor of 1 (a legacy smaller size counts as 1 and says so), the
 * features still missing a part, and the page's verdict.
 */
export function generateWsjfPrompts(
  data: WsjfData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const scored = rows.filter((r) => r.result.score !== null);
  const table =
    scored.length === 0
      ? "No feature is scored yet."
      : formatTable(
          [
            "#",
            "Feature",
            "Business value",
            "Time criticality",
            "RR/OE",
            "Job size",
            "Cost of delay",
            "WSJF",
            "Note",
          ],
          scored
            .slice(0, MAX_ROWS)
            .map((r) => [
              r.rank ?? "—",
              r.row.title,
              ...WSJF_KEYS.map((k) => partText(r.values[k])),
              formatNumber(toNumber(r.result.extra?.costOfDelay) ?? 0, 2),
              WSJF.format(r.result.score as number),
              r.result.warnings.join(" ") || "—",
            ])
        );
  const more =
    scored.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${scored.length} scored features)` : "";
  // The page's verdict carries the relative hint (a column with no 1 yet).
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  // Titles are user-typed, and the verdict names them.
  const body = wrapUserContent(`${verdict}${table}${more}${unscoredLine(rows)}`);
  return [
    {
      id: "wsjf-sequencing",
      title: "WSJF Sequencing & PI Plan",
      description: "Translate WSJF rankings into a PI-level commitment.",
      prompt:
        buildPreamble(
          "WSJF Calculator",
          `It sequences work by cost of delay ÷ job size, where cost of delay = business value + time criticality + risk reduction / opportunity enablement (RR/OE). Every part is scored relative to the other features on ${FIBONACCI_TEXT} (the smallest in each column a 1); the job size is ${WSJF_JOB_SIZE_MIN} at least.`
        ) +
        `## Ranked features\n\n${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. What features should make the next PI based on capacity (assume 50 SP/sprint × 5 sprints)?\n` +
        `2. Which 'Time Criticality' scores look unrealistic? Recheck with the team.\n` +
        `3. Could splitting any large item into 2 produce a better WSJF outcome?\n` +
        `4. Are 'Job Size' estimates calibrated against historical actuals?\n` +
        `5. Which items would you defer entirely?`,
    },
  ];
}
