import type { FeatureFlag } from "@/lib/stores/workspace-types";
import {
  ENV_LABEL,
  PURPOSE_LABEL,
  STATUS_LABEL,
  compareFlags,
  flagStaleness,
  flagSummary,
} from "@/lib/flags/model";
import { NO_VALUE } from "@/lib/charts/chart-text";
import { dayLabel, stalenessText } from "./text";
import { flagVerdict } from "./verdict";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const orDash = (v: string | undefined) => md(v) || NO_VALUE;

/**
 * The flags for a cleanup planning thread or a release review: the verdict,
 * the live flags in the page's order (the most overdue first) with owner,
 * purpose, created and removal days and why each is or isn't stale, then
 * the retired ones.
 */
export function toMarkdown(
  flags: readonly FeatureFlag[],
  today: string,
  releaseName: (id: string) => string | undefined
): string {
  const title = `# Feature flags — ${dayLabel(today, true)}`;
  if (flags.length === 0) return `${title}\n\nNo flags tracked yet.\n`;
  const s = flagSummary(flags, today);
  const sorted = [...flags].sort((a, b) => compareFlags(a, b, today));
  const live = sorted.filter((f) => f.status !== "retired");
  const retired = sorted.filter((f) => f.status === "retired");
  // Days with their year, as on the cards: flags often outlive the year they were added in.
  const day = (v: string | undefined) => dayLabel(v, true);
  const lines = [
    title,
    "",
    `**${md(flagVerdict(flags, today))}**`,
    "",
    `- Live: ${s.live} (${s.on} on, ${s.off} off)`,
    `- Stale: ${s.stale} (${s.pastRemoval} past their removal date, ${s.overLifetime} over their purpose's typical lifetime)`,
    `- Exempt: ${s.exempt}`,
    `- Live with no owner: ${s.noOwner}`,
    `- Retired this quarter: ${s.retiredThisQuarter}`,
  ];
  if (live.length > 0) {
    lines.push(
      "",
      `## Live (${live.length})`,
      "",
      "| Flag | Status | Purpose | Owner | Environment | Created | Remove by | Ships with | Staleness |",
      "|---|---|---|---|---|---|---|---|---|",
      ...live.map(
        (f) =>
          `| ${md(f.name)} | ${STATUS_LABEL[f.status]} | ${PURPOSE_LABEL[f.purpose]} | ${orDash(f.owner)} | ${
            f.environment ? ENV_LABEL[f.environment] : NO_VALUE
          } | ${day(f.createdAt)} | ${day(f.removeBy)} | ${orDash(
            f.releaseId ? releaseName(f.releaseId) : undefined
          )} | ${md(stalenessText(flagStaleness(f, today), f.purpose))} |`
      )
    );
  }
  if (retired.length > 0) {
    lines.push(
      "",
      `## Retired (${retired.length})`,
      "",
      "| Flag | Purpose | Owner | Created | Retired |",
      "|---|---|---|---|---|",
      ...retired.map(
        (f) =>
          `| ${md(f.name)} | ${PURPOSE_LABEL[f.purpose]} | ${orDash(f.owner)} | ${day(
            f.createdAt
          )} | ${f.retiredAt ? day(f.retiredAt) : "Day not recorded"} |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
