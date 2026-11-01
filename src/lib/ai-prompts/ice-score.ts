import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { ICE } from "../prioritization/methods";
import { formatNumber, toNumber } from "../prioritization/methods/fields";
import { ICE_KEYS, ICE_STEPS } from "../prioritization/methods/ice";
import type { RankedRow } from "../prioritization/rank";

/**
 * The ideas as the ICE page reads them: its rows, scored by the registry
 * (rankMethodRows), and its verdict.
 */
interface IceData {
  rows: readonly RankedRow[];
  verdict?: string;
}

/** The table lists this many scored ideas, in rank order. */
const MAX_ROWS = 20;

const inputLabel = (key: string) =>
  (ICE.inputs.find((i) => i.key === key)?.label ?? key).toLowerCase();

/** An input as the row shows it: "7", an off-scale stored "12 (custom)", "—" when not set. */
function partText(key: (typeof ICE_KEYS)[number], v: number | string | undefined): string {
  const n = toNumber(v);
  if (n === undefined) return "—";
  return ICE_STEPS[key].some((s) => s.value === n)
    ? formatNumber(n, 2)
    : `${formatNumber(n, 2)} (custom)`;
}

/**
 * The experiment pipeline prompt over the ideas as the page shows them:
 * impact, confidence and ease on 1–10 (an off-scale stored value marked
 * custom; the score holds it to 1–10), ICE to two places as the rows read,
 * and the ideas still missing an input, never scored as 0.
 */
export function generateIcePrompts(
  data: IceData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const scored = rows.filter((r) => r.result.score !== null);
  const table =
    scored.length === 0
      ? "No idea is scored yet."
      : formatTable(
          ["#", "Idea", "Impact", "Confidence", "Ease", "ICE"],
          scored
            .slice(0, MAX_ROWS)
            .map((r) => [
              r.rank ?? "—",
              r.row.title,
              ...ICE_KEYS.map((k) => partText(k, r.values[k])),
              ICE.format(r.result.score as number),
            ])
        );
  const more =
    scored.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${scored.length} scored ideas)` : "";
  const waiting = rows.filter((r) => r.result.score === null);
  const unscored =
    waiting.length > 0
      ? `\n\nNot scored yet: ${waiting
          .slice(0, MAX_ROWS)
          .map(
            (r) =>
              `“${sanitizePromptCell(r.row.title, 80)}” (needs ${r.result.missing.map(inputLabel).join(", ")})`
          )
          .join("; ")}${waiting.length > MAX_ROWS ? ` and ${waiting.length - MAX_ROWS} more` : ""}.`
      : "";
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  // Titles are user-typed, and the verdict names them.
  const body = wrapUserContent(`${verdict}${table}${more}${unscored}`);
  return [
    {
      id: "ice-experiment-pipeline",
      title: "Experiment Pipeline Review",
      description: "Build a 4-week experiment pipeline from the top ICE-scored ideas.",
      prompt:
        buildPreamble(
          "ICE Score",
          "It scores experiments by Impact × Confidence × Ease, each 1–10 (a score of 1–1000): impact 1 barely noticeable to 10 changes the game for the goal; confidence 1 a hunch to 10 proven in an earlier launch; ease 1 months across teams to 10 under a day."
        ) +
        `## Ideas\n\n${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Pick the top 4 ideas — sketch a 4-week experiment pipeline (1 per week).\n` +
        `2. For low-confidence ideas, what's the cheapest signal that would lift confidence?\n` +
        `3. Are 'ease' scores calibrated, or systematically optimistic?\n` +
        `4. Recommend three ideas worth killing.\n` +
        `5. What experiment is missing from this list?`,
    },
  ];
}
