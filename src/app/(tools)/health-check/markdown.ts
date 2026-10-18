import {
  HEALTH_CHECK_DIMENSIONS as DIMENSIONS,
  type HealthCheckEntry,
  type HealthCheckSnapshot,
  type HealthDimension,
  type HealthTrafficLight,
  type HealthTrend,
} from "@/lib/stores/workspace-types";

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

const isLight = (v: unknown): v is HealthTrafficLight =>
  v === "green" || v === "yellow" || v === "red";

/**
 * The health check as Markdown, for a retro page or the team channel: the
 * current check, one row per dimension with its light and trend, then the
 * last few saved checks side by side, oldest first.
 *
 * `lights` is the current check as the page shows it, with null for a
 * dimension not rated yet (the stored draft holds a placeholder green). If
 * it's left out, every stored light counts as rated.
 */
export function toMarkdown(
  {
    current,
    history,
    lights,
  }: {
    current: HealthCheckSnapshot;
    history: readonly HealthCheckEntry[];
    lights?: Record<HealthDimension, HealthTrafficLight | null>;
  },
  now: Date = new Date()
): string {
  const title = `# Squad Health Check — ${mdDate(now)}`;
  const lightOf = (d: HealthDimension): HealthTrafficLight | null => {
    const l = lights ? lights[d] : current.scores?.[d]?.light;
    return isLight(l) ? l : null;
  };
  const rated = DIMENSIONS.filter((d) => lightOf(d) !== null);
  if (rated.length === 0 && history.length === 0) {
    return `${title}\n\nNo health checks yet.\n`;
  }

  const name = cell(current.sprintName);
  const lines = [title, "", `## Current check${name ? `: ${name}` : ""}`, ""];
  if (rated.length === 0) {
    lines.push("_Not rated yet._");
  } else {
    const greens = rated.filter((d) => lightOf(d) === "green").length;
    lines.push(
      // Same reading as the page: the share of the RATED dimensions that are green.
      `**Health:** ${Math.round((greens / rated.length) * 100)}% (` +
        (rated.length === DIMENSIONS.length
          ? `${greens} of ${DIMENSIONS.length} dimensions green)`
          : `${greens} of ${rated.length} rated green; ${DIMENSIONS.length - rated.length} not rated yet)`),
      "",
      "| Dimension | Status | Trend |",
      "|---|---|---|",
      ...DIMENSIONS.map((d) => {
        const light = lightOf(d);
        return light
          ? `| ${d} | ${LIGHT[light]} | ${TREND[current.scores?.[d]?.trend ?? "same"]} |`
          : `| ${d} | Not rated | — |`;
      })
    );
  }

  if (history.length > 0) {
    const shown = history.slice(-MAX_HISTORY);
    const health = (h: HealthCheckEntry) =>
      Math.round(
        (DIMENSIONS.filter((d) => h.scores?.[d]?.light === "green").length / DIMENSIONS.length) *
          100
      );
    lines.push(
      "",
      shown.length < history.length
        ? `## History (last ${shown.length} of ${history.length})`
        : "## History",
      "",
      `| Dimension | ${shown.map((h) => `${cell(h.sprintName) || "—"} (${cell(h.date)})`).join(" | ")} |`,
      `|---|${shown.map(() => "---").join("|")}|`,
      ...DIMENSIONS.map((d) => {
        const row = shown.map((h) => {
          const l = h.scores?.[d]?.light;
          return isLight(l) ? LIGHT[l] : "—";
        });
        return `| ${d} | ${row.join(" | ")} |`;
      }),
      `| **Health** | ${shown.map((h) => `**${health(h)}%**`).join(" | ")} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
