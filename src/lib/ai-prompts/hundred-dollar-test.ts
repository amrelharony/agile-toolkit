import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { AllocationRound, PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { allocationAmount } from "../realtime/vote-room/allocation";
import {
  HUNDRED,
  allocationOf,
  compareSplit,
  dollars,
  hundredDollarVerdict,
  hundredRows,
  roundsFor,
  splitSummary,
  spreadReason,
} from "../hundred-dollar/allocation";

/**
 * The test as the $100 Test page reads it: its item rows (any order; rows
 * of other tools are left out) and the saved team rounds (the latest one is
 * shown, as on the page).
 */
interface HundredDollarData {
  items: readonly PrioritizationItem[];
  rounds?: readonly AllocationRound[];
}

/** Biggest agreed amount first; items with none yet after a deliberate $0 (the page's order). */
const byAmount = (a: PrioritizationItem, b: PrioritizationItem) =>
  (allocationOf(b) ?? -1) - (allocationOf(a) ?? -1);

/** "$40", or "—" for an item no amount was given to (never $0). */
const agreedText = (n: number | null) => (n === null ? "—" : dollars(n));

/**
 * The readout prompt over the agreed split and the latest team round, from
 * lib/hundred-dollar: an item with no amount yet reads "—", not $0; with a
 * round, each item's team average (the round's total ÷ the people who
 * answered), how many gave it something and where the middle half fell,
 * only the aggregates the round keeps.
 */
export function generateHundredDollarPrompts(
  data: HundredDollarData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const items = [...hundredRows(data.items)].sort(byAmount);
  const latest = roundsFor(data.rounds, "hundred-dollar-test")[0] ?? null;
  if (items.length === 0 && !latest) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const split = splitSummary(items);
  const splitLine = split.full
    ? `All ${dollars(HUNDRED)} of the agreed split is given out.`
    : split.remaining > 0
      ? `Agreed split: ${dollars(split.total)} given out, ${dollars(split.remaining)} still to give.`
      : `Agreed split: ${dollars(split.total)} given out, ${dollars(-split.remaining)} over the ${dollars(HUNDRED)}.`;

  let table: string;
  let round = "";
  if (latest) {
    const money = (n: number) => allocationAmount(n, latest.unit);
    table = formatTable(
      ["Item", "Agreed split", "Team average", "People who gave something", "Middle half"],
      compareSplit(items, latest).map((c) => [
        c.current ? c.text : `${c.text} (deleted since)`,
        agreedText(c.agreed),
        c.mean === null ? "Not in this round" : money(c.mean),
        c.backers ?? "—",
        c.middleHalf ?? "—",
      ])
    );
    const how = latest.source === "room" ? "live" : "entered by hand";
    const spread = spreadReason(latest);
    round = `Latest team round (${latest.date}, ${how}): ${latest.ballots} ${latest.ballots === 1 ? "person" : "people"} each split ${money(latest.budget)}.${spread ? ` ${spread}` : ""}\n\n`;
  } else {
    table = formatTable(
      ["Item", "Agreed split"],
      items.map((it) => [it.title, agreedText(allocationOf(it))])
    );
  }
  // The verdict and the table name items: both sit in the untrusted block.
  const verdict = `Verdict: ${sanitizePromptCell(hundredDollarVerdict(items, latest), 400)}`;

  return [
    {
      id: "100-test-readout",
      title: "Vote Readout",
      description: "Interpret allocation pattern and recommend a cut line.",
      prompt:
        buildPreamble(
          "$100 Test",
          `It splits a fixed ${dollars(HUNDRED)} across competing items, in whole dollars: an agreed split the group settles together, and team rounds where each person splits their own ${dollars(HUNDRED)} anonymously and only the totals and spread are kept.`
        ) +
        `${splitLine}\n\n${round}${wrapUserContent(`${verdict}\n\n${table}`)}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Where would you draw the cut line based on the amounts?\n` +
        `2. Which items got an outsized fraction — strong consensus or a few big amounts? Use how many gave each something.\n` +
        (latest
          ? `3. Where do the agreed split and the team's averages disagree, and what would you ask about it?\n`
          : `3. What follow-up would deepen the signal? A team round shows how each person would split it.\n`) +
        `4. Are there candidates that received little or nothing worth keeping anyway? Why?\n` +
        `5. Recommend a script to share results with stakeholders.`,
    },
  ];
}
