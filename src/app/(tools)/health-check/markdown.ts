import type { HealthCheck, HealthTrafficLight, HealthTrend } from "@/lib/stores/workspace-types";
import {
  activeDimensions,
  allDimensions,
  checkLabel,
  checksByDate,
  draftLight,
  draftShare,
  entryShare,
  isSplit,
  previousSavedCheck,
  scoreOf,
  sharePct,
  storedLight,
  trendSince,
  votesTotal,
  type CheckOptions,
} from "@/lib/health-check/score";
import { todayLocalISO } from "@/lib/utils/formatters";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const LIGHT: Record<HealthTrafficLight, string> = {
  green: "🟢 Green",
  yellow: "🟡 Yellow",
  red: "🔴 Red",
};
const TREND: Record<HealthTrend, string> = { up: "↑ Up", same: "→ Same", down: "↓ Down" };

/** History columns kept in a pasted table. */
const MAX_HISTORY = 6;

const SCORE_RULE = "green 1, yellow ½, red 0";

/**
 * The health check as Markdown, for a retro page or the team channel: the
 * verdict, the check in progress (one row per dimension with its light,
 * the trend against the previous saved check, the votes and the note),
 * then the last few saved checks side by side, oldest first. Health is the
 * page's: rated dimensions only, yellow counting half.
 */
export function toMarkdown(
  doc: HealthCheck,
  { now = new Date(), verdict, ...opts }: CheckOptions & { now?: Date; verdict?: string } = {}
): string {
  const title = `# Squad Health Check — ${mdDate(now)}`;
  const current = doc.current;
  const dims = activeDimensions(doc);
  const rated = dims.filter((d) => draftLight(current, d.key) !== null);
  const history = checksByDate(doc, opts);
  if (rated.length === 0 && history.length === 0) {
    return `${title}\n\nNo health checks yet.\n`;
  }

  const lines = [title, ""];
  if (verdict) lines.push(verdict, "");
  const name = cell(current.sprintName);
  lines.push(`## Current check${name ? `: ${name}` : ""}`, "");
  if (rated.length === 0) {
    lines.push("_Not rated yet._");
  } else {
    const health = sharePct(draftShare(doc));
    const prev = previousSavedCheck(doc, { date: current.date ?? todayLocalISO(now) }, opts);
    lines.push(
      `**Health:** ${health}% (${SCORE_RULE}; ` +
        (rated.length === dims.length
          ? `all ${dims.length} dimensions rated)`
          : `${rated.length} of ${dims.length} rated so far)`),
      ""
    );
    if (current.source === "room" && typeof current.responses === "number") {
      lines.push(`${current.responses} people voted anonymously.`, "");
    }
    lines.push("| Dimension | Status | Trend | Votes (G/Y/R) | Note |", "|---|---|---|---|---|");
    for (const d of dims) {
      const light = draftLight(current, d.key);
      const score = scoreOf(current, d.key);
      const v = score?.votes;
      const votes =
        v && votesTotal(v) > 0
          ? `${v.green}/${v.yellow}/${v.red}${isSplit(v) ? " (split)" : ""}`
          : "—";
      // As the page says it: nothing to compare against is never "same".
      const since = prev ? trendSince(prev, d.key, light) : null;
      const trend = !light
        ? "—"
        : !prev
          ? "First check"
          : since
            ? TREND[since]
            : `New since ${cell(checkLabel(prev))}`;
      lines.push(
        `| ${cell(d.name)} | ${light ? LIGHT[light] : "Not rated"} | ${trend} | ${votes} | ${cell(score?.note) || "—"} |`
      );
    }
  }

  if (history.length > 0) {
    const shown = history.slice(-MAX_HISTORY);
    const keys = allDimensions(doc).filter((d) =>
      shown.some((e) => storedLight(e, d.key) !== null)
    );
    lines.push(
      "",
      shown.length < history.length
        ? `## History (last ${shown.length} of ${history.length})`
        : "## History",
      "",
      `| Dimension | ${shown.map((h) => `${cell(checkLabel(h))} (${cell(h.date)})`).join(" | ")} |`,
      `|---|${shown.map(() => "---").join("|")}|`,
      ...keys.map((d) => {
        const row = shown.map((h) => {
          const l = storedLight(h, d.key);
          return l ? LIGHT[l] : "—";
        });
        return `| ${cell(d.name)} | ${row.join(" | ")} |`;
      }),
      `| **Health** | ${shown
        .map((h) => {
          const pct = sharePct(entryShare(h));
          return `**${pct === null ? "—" : `${pct}%`}**`;
        })
        .join(" | ")} |`
    );
    const notes = shown.flatMap((h) =>
      keys.flatMap((d) => {
        const note = scoreOf(h, d.key)?.note;
        return note ? [`- ${cell(checkLabel(h))}, ${cell(d.name)}: ${cell(note)}`] : [];
      })
    );
    if (notes.length > 0) lines.push("", "### Notes", "", ...notes);
  }
  return `${lines.join("\n")}\n`;
}
