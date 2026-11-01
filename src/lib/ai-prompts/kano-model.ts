import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import {
  KANO_CATEGORY_LABEL,
  KANO_CLASSES,
  KANO_MIN_RESPONSES,
} from "../prioritization/methods/kano";
import type { RankedRow } from "../prioritization/rank";
import {
  GROUP_LABEL,
  answersText,
  coefText,
  coefficientsWait,
  compareFeatures,
  featureView,
} from "@/app/(tools)/kano-model/model";
import { kanoVerdict } from "@/app/(tools)/kano-model/verdict";

/** The features as the Kano page reads them: its rows, scored by the registry (kanoRows). */
interface KanoData {
  rows: readonly RankedRow[];
}

/** The table lists this many features, in the page's order. */
const MAX_FEATURES = 40;

/**
 * The roadmap prompt over the features as the page shows them: each
 * category derived from the answer counts (the most common class, from 3
 * answers), never picked; the A / O / M / I / R / Q counts; Better and
 * Worse once 3 answers count toward them; a lone answer pair or a
 * category picked by hand on the old page marked as such; and the page's
 * verdict.
 */
export function generateKanoPrompts(
  data: KanoData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.rows.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const ordered = [...data.rows].sort(compareFeatures);
  const shown = ordered.slice(0, MAX_FEATURES);
  const table = formatTable(
    ["Feature", "Category", "How answered", ...KANO_CLASSES, "Better", "Worse", "Note"],
    shown.map((r) => {
      const f = featureView(r);
      const c = f.reading.counts;
      const note = c && !f.coefficients ? coefficientsWait(f) : r.result.warnings.join(" ") || "—";
      return [
        r.row.title,
        f.category ? KANO_CATEGORY_LABEL[f.category] : GROUP_LABEL[f.group],
        answersText(f),
        ...KANO_CLASSES.map((k) => (c ? c[k] : "—")),
        coefText(f.coefficients?.better),
        coefText(f.coefficients?.worse),
        note,
      ];
    })
  );
  const more =
    ordered.length > shown.length
      ? `\n(Showing ${shown.length} of ${ordered.length} features)`
      : "";
  // Feature titles are user-typed, and the verdict names them.
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(kanoVerdict(data.rows), 400)}\n\n${table}${more}`
  );
  return [
    {
      id: "kano-roadmap",
      title: "Kano-Driven Roadmap",
      description: "Convert Kano classifications into a sequenced roadmap.",
      prompt:
        buildPreamble(
          "Kano Model",
          `Each answer pair (how a customer feels if the feature is there, and if it isn't) falls in one class: A attractive, O performance, M must-be, I indifferent, R reverse, Q questionable. A feature's category is its most common class (ties M > O > A > I > R > Q), shown from ${KANO_MIN_RESPONSES} answers. Better = (A + O) ÷ (A + O + M + I): how much having it helps; Worse = −(O + M) ÷ (A + O + M + I): how much missing it hurts.`
        ) +
        `${body}\n` +
        context +
        `\n## Questions\n\n` +
        `1. What sequence — Must-be → Performance → Attractive — best fits this set? Use Worse for the expected features and Better for the delighters.\n` +
        `2. Which 'Indifferent' items can be dropped to free capacity?\n` +
        `3. Are any 'Reverse' items dangerous to ship at all?\n` +
        `4. Identify the highest-ROI Attractive feature for delight.\n` +
        `5. Which categories rest on too few answers (one person's, picked by hand, or under ${KANO_MIN_RESPONSES}), and what survey would confirm them?`,
    },
  ];
}
