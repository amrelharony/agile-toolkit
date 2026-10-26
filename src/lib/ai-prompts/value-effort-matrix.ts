import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { BacklogItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { FIBONACCI_TEXT } from "../prioritization/methods/fibonacci";
import { VE_HIGH_EFFORT_FROM, VE_HIGH_VALUE_FROM } from "../prioritization/methods/value-effort";
import type { RankedRow } from "../prioritization/rank";
import {
  legacyValueNote,
  offScaleNote,
  placeOf,
  ratioText,
  veGroups,
} from "@/app/(tools)/value-effort-matrix/model";
import { veVerdict } from "@/app/(tools)/value-effort-matrix/verdict";

/**
 * The matrix as the Value vs Effort page reads it: its rows, scored by the
 * registry and read through to their backlog items (rankMethodRows), and
 * the backlog items, for a value read from the old 1–10 field.
 */
interface ValueEffortData {
  rows: readonly RankedRow[];
  items?: readonly BacklogItem[];
}

/** The table lists this many items, in do-first order. */
const MAX_ITEMS = 40;

/**
 * The quadrant prompt over the matrix as the page shows it: value on the
 * Fibonacci scale (high from 8), effort 1–10 (high from 6), the quadrant
 * derived from both (never a stored one), value ÷ effort, items not placed
 * yet, and what a row says about a value off its scale or read from the
 * old 1–10 field.
 */
export function generateValueEffortPrompts(
  data: ValueEffortData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { rows } = data;
  if (rows.length === 0) return [];
  const items = data.items ?? [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const groups = veGroups(rows);
  const counts = groups.map((g) => `${g.label} ${g.rows.length}`).join(" · ");
  const listed = groups.flatMap((g) => g.rows.map((r) => ({ r, label: g.label })));
  const shown = listed.slice(0, MAX_ITEMS);
  const table = formatTable(
    ["Item", "Quadrant", "Value", "Effort", "Value ÷ effort"],
    shown.map(({ r, label }) => {
      const at = placeOf(r);
      return [r.row.title, label, at.value ?? "—", at.effort ?? "—", ratioText(r) ?? "—"];
    })
  );
  const more =
    listed.length > shown.length ? `\n(Showing ${shown.length} of ${listed.length} items)` : "";
  // What a row says under it: a value or effort off its scale, a value read from the old field.
  const notes = shown.flatMap(({ r }) => {
    const said = [offScaleNote(r), legacyValueNote(r, items)].filter(Boolean);
    return said.length > 0 ? [`- ${sanitizePromptCell(r.row.title, 120)}: ${said.join(" ")}`] : [];
  });
  const notesSection = notes.length > 0 ? `\n\n## Notes\n\n${notes.join("\n")}` : "";
  // Item titles are user-typed, and the verdict names them.
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(veVerdict(rows), 400)}\n${counts}\n\n${table}${more}${notesSection}`
  );
  return [
    {
      id: "ve-quadrant-action",
      title: "Quadrant Action Plan",
      description: "Sequence work from the four quadrants.",
      prompt:
        buildPreamble(
          "Value vs Effort Matrix",
          `It plots items into Quick Wins (high value, low effort), Big Bets (high value, high effort), Fill-Ins (low value, low effort) and Time Wasters (low value, high effort). Value is relative, on ${FIBONACCI_TEXT}, and high from ${VE_HIGH_VALUE_FROM}; effort runs 1–10 (1 under a day, 10 months across teams) and is high from ${VE_HIGH_EFFORT_FROM}. Within a quadrant, items are ordered by value ÷ effort.`
        ) +
        body +
        "\n" +
        context +
        `\n## Questions\n\n` +
        `1. Which Quick Wins should ship in the next sprint?\n` +
        `2. Are 'Big Bets' actually big — or could any be split into Quick Wins?\n` +
        `3. Recommend the Time Wasters to drop and a script to communicate it.\n` +
        `4. Are 'Effort' estimates calibrated against historical actuals?\n` +
        `5. What's missing from this matrix, and where should the items not placed yet go?`,
    },
  ];
}
