import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { BacklogItem, PrioritizationItem, Workspace } from "../stores/workspace-types";
import { evaluateItem, method } from "../prioritization/methods";
import { MOSCOW_LABEL, isMoscowBucket } from "../prioritization/methods/moscow";
import { VE_LABEL, isValueEffortQuadrant } from "../prioritization/methods/value-effort";
import { readBacklogItem } from "../prioritization/defaults";
import { decidedOrder } from "../prioritization/rank";

/**
 * The backlog as the Prioritizer shows it: the items (in any order; the
 * prompt lists them in the decided order) and the method rows linked to
 * them. Every score comes from the method registry, so the prompt quotes
 * the numbers on screen, and a method that isn't scored reads "Not scored".
 */
interface PrioritizerData {
  items: readonly BacklogItem[];
  rows?: readonly PrioritizationItem[];
}

const NOT_SCORED = "Not scored";

export function generatePrioritizerPrompts(
  data: PrioritizerData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const rows = data.rows ?? [];

  const ordered = decidedOrder(data.items);
  const { data: shown, truncated, totalCount } = truncateData([...ordered]);

  const table = formatTable(
    ["Order", "Item", "MoSCoW", "WSJF", "RICE", "Value/Effort", "Effort (pm)", "Description"],
    shown.map((item) => {
      const s = evaluateItem(item, rows);
      const effort = readBacklogItem(item).effort;
      return [
        typeof item.rank === "number" ? item.rank : "—",
        item.name,
        isMoscowBucket(s.moscow.bucket) ? MOSCOW_LABEL[s.moscow.bucket] : "Not sorted yet",
        s.wsjf.score === null ? NOT_SCORED : method("wsjf").format(s.wsjf.score),
        s.rice.score === null ? NOT_SCORED : method("rice").format(s.rice.score),
        isValueEffortQuadrant(s["value-effort"].bucket)
          ? VE_LABEL[s["value-effort"].bucket]
          : NOT_SCORED,
        effort === undefined ? "—" : effort,
        (item.description ?? "—").slice(0, 80),
      ];
    })
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} items)\n` : "";

  const mustHaves = data.items.filter((i) => readBacklogItem(i).moscow === "must");
  const wontHaves = data.items.filter((i) => readBacklogItem(i).moscow === "wont");

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  return [
    {
      id: "prioritizer-validate",
      title: "Prioritization Validation",
      description: "Challenge the ranking and identify potential biases or misalignments.",
      prompt:
        buildPreamble(
          "Backlog Prioritizer",
          'It scores items using MoSCoW, WSJF, RICE and Value vs Effort side by side; "Not scored" means the method has no inputs for the item yet.'
        ) +
        `## Backlog Items\n\n${table}${note}\n\nMust-haves: ${mustHaves.length} | Won't-haves: ${wontHaves.length} | Total items: ${data.items.length}${context}\n\n## Questions\n\n1. Are the MoSCoW categories well-distributed? Is anything mis-categorized based on the WSJF/RICE scores?\n2. Do the WSJF and RICE rankings agree? Where do they diverge and what does that mean?\n3. Are there any "hidden gems" — items with high value/impact but low priority placement?\n4. Challenge the Must-have list: should any items be downgraded? Are there too many Must-haves?\n5. What ordering would you recommend for the next sprint based on this data?`,
    },
    {
      id: "prioritizer-quickwins",
      title: "Quick Win Identification",
      description: "Find high-value, low-effort items that can deliver fast results.",
      prompt:
        buildPreamble("Backlog Prioritizer", "Identify quick wins from the scored backlog.") +
        `## Backlog Items\n\n${table}${note}${context}\n\n## Questions\n\n1. Which items have the highest value-to-effort ratio? List the top 5 quick wins.\n2. Are there items that could be split into smaller pieces to capture value sooner?\n3. How should the team balance quick wins with strategic Must-have items?\n4. Draft a stakeholder-friendly explanation of why you'd recommend this ordering.\n5. What items would you defer or drop entirely? Why?`,
    },
  ];
}
