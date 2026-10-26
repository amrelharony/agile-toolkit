import type { PromptDefinition } from "./types";
import {
  buildPreamble,
  formatTable,
  sanitizePromptCell,
  truncateData,
  wrapUserContent,
} from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { BacklogItem, PrioritizationItem, Workspace } from "../stores/workspace-types";
import { evaluateItem, method } from "../prioritization/methods";
import { readBacklogItem } from "../prioritization/defaults";
import { decidedOrder } from "../prioritization/rank";
import { HUB_METHODS, methodText } from "@/app/(tools)/prioritizer/method-text";

/**
 * The backlog as the Prioritizer shows it: the items (in any order; the
 * prompt lists them in the decided order), the method rows linked to them,
 * and the hub's verdict. Every cell is the hub's own (method-text over the
 * method registry), so the prompt quotes the numbers on screen, and a
 * method that hasn't scored an item reads its "not yet" ("Not sorted yet",
 * "Not placed yet", "Not scored"), never 0.
 */
interface PrioritizerData {
  items: readonly BacklogItem[];
  rows?: readonly PrioritizationItem[];
  verdict?: string;
}

export function generatePrioritizerPrompts(
  data: PrioritizerData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.items.length === 0) return [];
  const rows = data.rows ?? [];

  const ordered = decidedOrder(data.items);
  const { data: shown, truncated, totalCount } = truncateData([...ordered]);

  const table = formatTable(
    [
      "Order",
      "Item",
      ...HUB_METHODS.map((id) => method(id).label),
      "RICE effort (person-months)",
      "Description",
    ],
    shown.map((item) => {
      const s = evaluateItem(item, rows);
      const effort = readBacklogItem(item).effort;
      return [
        typeof item.rank === "number" ? item.rank : "Not ordered yet",
        item.name,
        ...HUB_METHODS.map((id) => methodText(id, s[id])),
        effort === undefined ? "—" : effort,
        (item.description ?? "—").slice(0, 80),
      ];
    })
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} items)` : "";

  const mustHaves = data.items.filter((i) => readBacklogItem(i).moscow === "must");
  const wontHaves = data.items.filter((i) => readBacklogItem(i).moscow === "wont");
  const verdict = data.verdict ? `Verdict: ${sanitizePromptCell(data.verdict, 400)}\n\n` : "";
  // Item names and descriptions are user-typed, and the verdict names items.
  const body = wrapUserContent(`${verdict}${table}${note}`);

  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const methods = HUB_METHODS.map((id) => method(id).label).join(", ");

  return [
    {
      id: "prioritizer-validate",
      title: "Prioritization Validation",
      description: "Challenge the ranking and identify potential biases or misalignments.",
      prompt:
        buildPreamble(
          "Backlog Prioritizer",
          `It scores items with ${methods} side by side; "Not scored", "Not sorted yet" and "Not placed yet" mean the method has no inputs for the item yet. The order is the one the team decided; "Not ordered yet" items haven't been placed.`
        ) +
        `## Backlog Items\n\n${body}\n\nMust-haves: ${mustHaves.length} | Won't-haves: ${wontHaves.length} | Total items: ${data.items.length}${context}\n\n## Questions\n\n1. Are the MoSCoW categories well-distributed? Is anything mis-categorized based on the WSJF/RICE scores?\n2. Do the WSJF and RICE rankings agree? Where do they diverge and what does that mean?\n3. Are there any "hidden gems" — items with high value/impact but low priority placement?\n4. Challenge the Must-have list: should any items be downgraded? Are there too many Must-haves?\n5. What ordering would you recommend for the next sprint based on this data?`,
    },
    {
      id: "prioritizer-quickwins",
      title: "Quick Win Identification",
      description: "Find high-value, low-effort items that can deliver fast results.",
      prompt:
        buildPreamble("Backlog Prioritizer", "Identify quick wins from the scored backlog.") +
        `## Backlog Items\n\n${body}${context}\n\n## Questions\n\n1. Which items have the highest value-to-effort ratio? List the top 5 quick wins.\n2. Are there items that could be split into smaller pieces to capture value sooner?\n3. How should the team balance quick wins with strategic Must-have items?\n4. Draft a stakeholder-friendly explanation of why you'd recommend this ordering.\n5. What items would you defer or drop entirely? Why?`,
    },
  ];
}
