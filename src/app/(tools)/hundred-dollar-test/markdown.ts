import type { AllocationRound, PrioritizationItem } from "@/lib/stores/workspace-types";
import { allocationAmount, allocationRoundMarkdown } from "@/lib/realtime/vote-room/allocation";
import {
  allocationOf,
  compareSplit,
  dollars,
  hundredDollarVerdict,
  hundredRows,
  kitResultOf,
  splitSummary,
} from "@/lib/hundred-dollar/allocation";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The test as Markdown, for a planning thread: the verdict, the agreed
 * split, and the latest team round (its averages and spread as the kit
 * writes them, then each item beside the agreed split). Only aggregates:
 * a round holds no one's split, so none can be exported.
 */
export function toMarkdown(
  rows: readonly PrioritizationItem[],
  rounds: readonly AllocationRound[],
  now: Date = new Date()
): string {
  const items = hundredRows(rows);
  const latest = rounds[0] ?? null;
  const lines = [`# $100 Test — ${mdDate(now)}`, ""];
  if (items.length === 0 && !latest) {
    lines.push("No items yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`> ${md(hundredDollarVerdict(items, latest))}`, "");

  if (items.length > 0) {
    const split = splitSummary(items);
    lines.push(
      "## Agreed split",
      "",
      "| Item | Amount |",
      "| --- | ---: |",
      ...items.map((x) => {
        const a = allocationOf(x);
        return `| ${md(x.title)} | ${a === null ? "—" : dollars(a)} |`;
      }),
      "",
      split.full
        ? "All $100 is given out."
        : split.remaining > 0
          ? `${dollars(split.total)} given out, ${dollars(split.remaining)} still to give.`
          : `${dollars(split.total)} given out: ${dollars(-split.remaining)} over the $100.`,
      ""
    );
  }

  if (latest) {
    // The kit's round table under this document's heading level.
    const body = allocationRoundMarkdown(kitResultOf(latest)).split("\n").slice(1).join("\n");
    lines.push(`## Team round: ${md(latest.title)}`, body.trimEnd(), "");
    if (items.length > 0) {
      lines.push(
        "### Beside the agreed split",
        "",
        "| Item | Agreed split | Team average |",
        "| --- | ---: | ---: |",
        ...compareSplit(items, latest).map(
          (c) =>
            `| ${md(c.text)}${c.current ? "" : " (deleted since)"} | ${c.agreed === null ? "—" : dollars(c.agreed)} | ${c.mean === null ? "—" : allocationAmount(c.mean, latest.unit)} |`
        ),
        ""
      );
    }
    if (rounds.length > 1) {
      lines.push(
        `${rounds.length - 1} earlier ${rounds.length === 2 ? "round" : "rounds"} saved.`,
        ""
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
