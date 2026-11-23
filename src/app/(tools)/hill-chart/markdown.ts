import type { HillChart, Story } from "@/lib/stores/workspace-types";
import {
  MARKDOWN_CHECK_INS,
  MISMATCH_TEXT,
  SIDE_LABEL,
  checkInsNewestFirst,
  daysSinceMove,
  isStuck,
  lastCheckIn,
  localDay,
  movedAgoText,
  movement,
  movementText,
  scopeMismatch,
  sideOf,
} from "@/lib/hill-chart/model";

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * One chart for a status update: each scope with its side, position, how it
 * moved since the last check-in, when it last moved and its flag (stuck, or
 * a story that disagrees), then the check-in log, newest 12.
 */
export function hillChartMarkdown(
  chart: HillChart,
  now: Date,
  stories: readonly Pick<Story, "id" | "status">[] = []
): string {
  const lines = [`# Hill chart — ${md(chart.title)} (${localDay(now)})`, ""];
  if (chart.about) lines.push(md(chart.about), "");
  if (chart.scopes.length === 0) {
    lines.push("No scopes yet.");
    return `${lines.join("\n")}\n`;
  }
  const byStory = new Map(stories.map((s) => [s.id, s]));
  const moves = new Map(movement(chart, lastCheckIn(chart)).map((m) => [m.scopeId, m]));
  lines.push(
    "| Scope | Side | Position | Since the last check-in | Last moved | Flag |",
    "|---|---|---:|---|---|---|",
    ...chart.scopes.map((s) => {
      const days = daysSinceMove(s, now);
      const mismatch = scopeMismatch(s, s.storyId ? byStory.get(s.storyId) : undefined);
      const flag = isStuck(s, now) ? "Stuck" : mismatch ? `Check: ${MISMATCH_TEXT[mismatch]}` : "";
      const move = moves.get(s.id);
      return `| ${md(s.title)} | ${SIDE_LABEL[sideOf(s.position)]} | ${s.position} | ${
        move ? movementText(move) : ""
      } | ${movedAgoText(days)} | ${md(flag)} |`;
    })
  );
  const log = checkInsNewestFirst(chart).slice(0, MARKDOWN_CHECK_INS);
  if (log.length > 0) {
    lines.push(
      "",
      "## Check-ins",
      "",
      ...log.map((c) => `- ${localDay(c.at)}${c.note ? `: ${md(c.note)}` : ""}`)
    );
  }
  return `${lines.join("\n")}\n`;
}
