import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { WeightedMatrix, WeightedOption, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import {
  SCORE_MAX,
  SCORE_MIN,
  SENSITIVITY_LIMIT,
  TIE_MARGIN,
  cellOf,
  formatTotal,
  matrixTitle,
  sensitivityText,
  type MatrixResult,
} from "../weighted/model";

/**
 * One matrix as the Weighted Decision page shows it: `result` is its
 * matrixResult (totals, leader, tie, sensitivity and verdict, the numbers
 * the page and the agent actions share), `options` its option rows for the
 * cells, and `matrix` the matrix itself (what it decides).
 */
interface WeightedData {
  result: MatrixResult;
  options: readonly WeightedOption[];
  matrix?: Pick<WeightedMatrix, "name" | "question"> | null;
}

/** The table shows this many options, in rank order. */
const MAX_OPTIONS = 20;

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The AI prompt over one matrix, as its table reads: a cell not scored is
 * "—", never 0 (a weight-0 criterion's too), an option with a cell still
 * empty shows its partial total and never the star, and the leader (every
 * tied option in a tie) is starred.
 */
export function generateWeightedPrompts(
  data: WeightedData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { result } = data;
  if (result.options.length === 0 || result.criteria.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const criteria = formatTable(
    ["Criterion", "Weight", "Share", `${SCORE_MIN} means`, `${SCORE_MAX} means`],
    result.criteria.map((c) => [
      c.name,
      c.weight,
      c.active ? pct(c.share) : "not counted",
      c.low ?? "—",
      c.high ?? "—",
    ])
  );

  const byId = new Map(data.options.map((o) => [o.id, o]));
  const starred = new Set(result.tie ? result.tie.ids : result.leaderId ? [result.leaderId] : []);
  const shown = result.options.slice(0, MAX_OPTIONS);
  const scores = formatTable(
    [
      "Option",
      ...result.criteria.map((c) =>
        c.active ? `${c.name} (w${c.weight})` : `${c.name} (w${c.weight}, not counted)`
      ),
      "Total",
    ],
    shown.map((o) => {
      const row = byId.get(o.id);
      const cells = result.criteria.map((c) => {
        const cell = row ? cellOf(row, c.id) : { kind: "empty" as const };
        return cell.kind === "scored"
          ? String(cell.value)
          : cell.kind === "off"
            ? `${cell.value} (off scale)`
            : "—";
      });
      const total =
        o.total !== null
          ? `${formatTotal(o.total)}${starred.has(o.id) ? " ★" : ""}`
          : `partial ${formatTotal(o.partialTotal)} (${o.unscored.length} not scored)`;
      return [o.name, ...cells, total];
    })
  );
  const more =
    result.options.length > shown.length
      ? `\n(Showing ${shown.length} of ${result.options.length} options)`
      : "";

  const notes = [
    ...(result.tie
      ? [`- Too close to call: the top totals are within ${pct(TIE_MARGIN)} of each other.`]
      : []),
    ...result.sensitivity.map((f) => `- ${sensitivityText(f)}`),
  ];
  const sensitivity =
    notes.length > 0
      ? `\n\n## Sensitivity\n\n${notes.join("\n")}`
      : result.sensitivityChecked
        ? `\n\n## Sensitivity\n\nNone within ±${pct(SENSITIVITY_LIMIT)}: no single weight change of up to ${pct(SENSITIVITY_LIMIT)} hands the lead to another option.`
        : "";

  const title = data.matrix
    ? `Decision: ${sanitizePromptCell(matrixTitle(data.matrix), 300)}\n\n`
    : "";
  // Option and criterion names are user-typed: the verdict, both tables and
  // the sensitivity notes name them, so all of it sits in the untrusted block.
  const body = wrapUserContent(
    `${title}Verdict: ${sanitizePromptCell(result.verdict, 600)}\n\n## Criteria\n\n${criteria}\n\n## Scores\n\n${scores}${more}${sensitivity}`
  );

  return [
    {
      id: "weighted-sensitivity",
      title: "Sensitivity Check",
      description: "Probe whether the winner survives changes to weights and scores.",
      prompt:
        buildPreamble(
          "Weighted Decision Matrix",
          `It scores each option ${SCORE_MIN}–${SCORE_MAX} on each criterion; Total = Σ score × weight, once every criterion with a weight above 0 is scored. "—" is a cell not scored yet (never 0): an option with one has only a partial total and can't lead. ★ marks the leader, or every option in a tie (top totals within ${pct(TIE_MARGIN)} of each other).`
        ) +
        `${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Is the leader a clear winner, or a coin-flip against the next option? Use the gap and the sensitivity notes.\n` +
        `2. Are any criteria highly correlated (double-counting the same thing)?\n` +
        `3. Which scores are weakest (low confidence) and could swing the result?\n` +
        `4. Which cells still to score could change the result, and which should be scored first?\n` +
        `5. What additional criterion would meaningfully change the ranking?`,
    },
  ];
}
