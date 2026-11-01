/**
 * The health trend chart in words: a one-sentence summary and each check's
 * lights as a table, both built from the rows the chart draws (health as a
 * percentage per saved check, and per dimension 2 = green, 1 = yellow,
 * 0 = red, null = not in that check).
 */

import { NO_VALUE, listAnd, move, plural, type ChartText } from "@/lib/charts/chart-text";
import { HEALTH_CHECK_DIMENSIONS as DIMENSIONS } from "@/lib/stores/workspace-types";
import type { HealthCheck } from "@/lib/stores/workspace-types";
import {
  allDimensions,
  checkLabel,
  checksByDate,
  entryShare,
  sharePct,
  storedLight,
  type CheckOptions,
} from "@/lib/health-check/score";

/** One row per saved check: its name, its health % and a 0–2 value per dimension key. */
export type HealthTrendRow = { name: string; health?: number | null } & Record<
  string,
  string | number | null | undefined
>;

/** The dimensions a table names: their key in the rows and their name. */
export interface TrendDimension {
  key: string;
  name: string;
}

type Light = "Red" | "Yellow" | "Green";

const lightOf = (v: unknown): Light | typeof NO_VALUE =>
  v === 2 ? "Green" : v === 1 ? "Yellow" : v === 0 ? "Red" : NO_VALUE;

const BUILT_INS: TrendDimension[] = DIMENSIONS.map((d) => ({ key: d, name: d }));

const VALUE = { green: 2, yellow: 1, red: 0 } as const;

/** The chart's rows: the saved checks oldest first, with health and every dimension's light. */
export function healthTrendRows(
  doc: HealthCheck,
  opts: CheckOptions = {}
): {
  rows: HealthTrendRow[];
  dims: TrendDimension[];
} {
  const checks = checksByDate(doc, opts);
  const dims = allDimensions(doc)
    .filter((d) => checks.some((e) => storedLight(e, d.key) !== null))
    .map((d) => ({ key: d.key, name: d.name }));
  const rows = checks.map((e) => {
    const row: HealthTrendRow = { name: checkLabel(e), health: sharePct(entryShare(e)) };
    for (const d of dims) {
      const light = storedLight(e, d.key);
      row[d.key] = light ? VALUE[light] : null;
    }
    return row;
  });
  return { rows, dims };
}

export function healthTrendText(
  rows: readonly HealthTrendRow[],
  dims: readonly TrendDimension[] = BUILT_INS
): ChartText {
  let summary: string;
  if (rows.length === 0) {
    summary = "No checks saved yet.";
  } else {
    const latest = rows[rows.length - 1];
    const counts = { Green: 0, Yellow: 0, Red: 0 };
    let rated = 0;
    for (const d of dims) {
      const l = lightOf(latest[d.key]);
      if (l === NO_VALUE) continue;
      counts[l] += 1;
      rated++;
    }
    const lights = listAnd([
      `${counts.Green} green`,
      `${counts.Yellow} yellow`,
      `${counts.Red} red`,
    ]);
    const healths = rows.map((r) => r.health).filter((h): h is number => typeof h === "number");
    const health =
      healths.length >= 2
        ? `; health ${move(healths[0], healths[healths.length - 1], (v) => `${v}%`)}`
        : healths.length === 1
          ? `; health ${healths[0]}%`
          : "";
    summary =
      rows.length === 1
        ? `One check (${latest.name}) with ${lights} of ${rated} dimensions${health}.`
        : `${plural(rows.length, "check")} from ${rows[0].name} to ${latest.name}${health}; the latest has ${lights} of ${rated} dimensions.`;
  }

  const withHealth = rows.some((r) => r.health !== undefined);
  return {
    summary,
    table: {
      caption: "Light per dimension by check",
      columns: ["Check", ...dims.map((d) => d.name), ...(withHealth ? ["Health"] : [])],
      rows: rows.map((r) => [
        String(r.name),
        ...dims.map((d) => lightOf(r[d.key])),
        ...(withHealth ? [typeof r.health === "number" ? `${r.health}%` : NO_VALUE] : []),
      ]),
    },
  };
}
