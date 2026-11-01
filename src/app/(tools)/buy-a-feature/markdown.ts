import type {
  AllocationRound,
  BuyAFeatureGame,
  PrioritizationItem,
} from "@/lib/stores/workspace-types";
import { allocationAmount, allocationRoundMarkdown } from "@/lib/realtime/vote-room/allocation";
import { kitResultOf } from "@/lib/hundred-dollar/allocation";
import {
  budgetText,
  buyAFeatureVerdict,
  featureLedger,
  featureRows,
  gameCheck,
  isFunded,
  pool,
  remaining,
  unitOf,
} from "@/lib/buy-a-feature/game";

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
 * The game as Markdown, for the debrief: the verdict, the game's settings
 * and pool, each feature's price, what it raised and what it still needs,
 * and the latest round's totals as the kit writes them. Rounds hold totals
 * only, so nobody's split is in it.
 */
export function toMarkdown(
  rows: readonly PrioritizationItem[],
  game: BuyAFeatureGame | null,
  rounds: readonly AllocationRound[],
  opts: { inBacklog?: (id: string) => boolean; now?: Date } = {}
): string {
  const { inBacklog = () => false, now = new Date() } = opts;
  const features = featureRows(rows).map(featureLedger);
  const unit = unitOf(game);
  const money = (n: number) => allocationAmount(n, unit);
  const lines = [`# Buy-a-Feature — ${mdDate(now)}`, ""];
  if (features.length === 0) {
    lines.push("No features yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`> ${md(buyAFeatureVerdict(features, game))}`, "");

  const p = pool(game, features);
  const check = gameCheck(game, features);
  lines.push("## The game", "");
  if (p && check) {
    lines.push(
      `- ${md(budgetText(check, p, unit))}`,
      `- Spent: ${money(p.spent)}; left in the pool: ${money(p.left)}`,
      ""
    );
  } else {
    lines.push("The players and their budget aren't set yet.", "");
  }

  lines.push(
    "## Features",
    "",
    "| Feature | Price | Raised | To go | Status |",
    "| --- | ---: | ---: | ---: | --- |",
    ...features.map((f) => {
      const status =
        f.price === null
          ? "Not priced"
          : isFunded(f)
            ? inBacklog(f.id)
              ? "Funded, in the backlog"
              : "Funded"
            : f.raised > 0
              ? "Pledged"
              : "Open";
      return `| ${md(f.title)} | ${f.price === null ? "—" : money(f.price)} | ${money(f.raised)} | ${f.price === null ? "—" : money(remaining(f))} | ${status} |`;
    }),
    ""
  );

  const latest = rounds[0];
  if (latest) {
    const body = allocationRoundMarkdown(kitResultOf(latest)).split("\n").slice(1).join("\n");
    lines.push(`## Latest round: ${md(latest.title)}`, body.trimEnd(), "");
    if (rounds.length > 1) {
      lines.push(
        `${rounds.length - 1} earlier ${rounds.length === 2 ? "round" : "rounds"} saved.`,
        ""
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
