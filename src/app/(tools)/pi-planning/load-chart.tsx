"use client";

import { ChartFigure } from "@/components/shared/chart-card";
import { NO_VALUE, type ChartText } from "@/lib/charts/chart-text";
import { cn } from "@/lib/utils";
import { teamLoad } from "./load";
import type { PiState } from "./store";

/**
 * The summary and table behind the load chart: each team's planned feature
 * points against its PI capacity (velocity × iterations).
 */
export function loadChartText(state: PiState): ChartText {
  const rows = state.teams.map((t) => ({ team: t, load: teamLoad(state, t) }));
  const measured = rows.filter((r) => r.load.pct !== null);
  let summary: string;
  if (measured.length === 0) {
    summary = "No team has a velocity yet, so load can't be compared with capacity.";
  } else {
    const sorted = [...measured].sort((a, b) => (b.load.pct as number) - (a.load.pct as number));
    const top = sorted[0];
    const low = sorted[sorted.length - 1];
    summary =
      sorted.length === 1
        ? `${top.team.name} has planned ${top.load.pct}% of its PI capacity.`
        : `${top.team.name} is the most loaded at ${top.load.pct}% of its PI capacity; ${low.team.name} has the most room at ${low.load.pct}%.`;
  }
  return {
    summary,
    table: {
      caption: "Load vs capacity per team",
      columns: ["Team", "Planned (pts)", "Capacity (pts)", "Load"],
      rows: rows.map(({ team, load }) => [
        team.name,
        load.planned,
        load.capacity ?? NO_VALUE,
        load.pct === null ? NO_VALUE : `${load.pct}%`,
      ]),
    },
  };
}

/** One bar per team; over capacity shows red and says so in text. */
export function LoadChart({ state }: { state: PiState }) {
  const text = loadChartText(state);
  return (
    <ChartFigure label="Load vs capacity" summary={text.summary} table={text.table}>
      <ul className="space-y-2">
        {state.teams.map((team) => {
          const load = teamLoad(state, team);
          const pct = load.pct ?? 0;
          return (
            <li
              key={team.id}
              className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs"
            >
              <span className="truncate text-text">{team.name}</span>
              <span className="h-3 overflow-hidden rounded-full bg-sub/15">
                <span
                  className={cn("block h-full rounded-full", load.over ? "bg-danger" : "bg-accent")}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </span>
              <span className="font-mono text-text">
                {load.capacity === null ? "no velocity" : `${load.planned} / ${load.capacity}`}
              </span>
            </li>
          );
        })}
      </ul>
    </ChartFigure>
  );
}
