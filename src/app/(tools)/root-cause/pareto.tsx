"use client";

/**
 * The Pareto chart of the fishbone's counts: the causes most first, with
 * the running share, and the "vital few" behind about 80% of them named in
 * a sentence. A table of the same numbers is one press away, and below two
 * counted causes there is no order to show yet.
 */

import dynamic from "next/dynamic";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import type { RootCauseCause } from "@/lib/stores/workspace-types";
import {
  PARETO_CUTOFF,
  PARETO_MIN_CAUSES,
  paretoRows,
  type ParetoRow,
} from "@/lib/root-cause/model";
import type { ChartText } from "@/lib/charts/chart-text";
import type { ParetoPoint } from "./pareto-chart";

const ParetoChart = dynamic(() => import("./pareto-chart").then((m) => m.ParetoChart), {
  ssr: false,
});

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The chart's sentence and table, from the rows. */
export function paretoText(rows: readonly ParetoRow[]): ChartText {
  const vital = rows.filter((r) => r.vital);
  const covered = vital.length > 0 ? vital[vital.length - 1].cumulative : 0;
  const names = vital.map((r) => `“${r.text}”`);
  const list =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const summary =
    vital.length === 0
      ? "No cause has a count yet."
      : vital.length === rows.length
        ? `The counts are spread out: no few causes stand out, so weigh them all (${rows.length} causes).`
        : `${vital.length === 1 ? "One cause" : `${vital.length} of ${rows.length} causes`} account for ${pct(covered)} of the counts: ${list}.`;
  return {
    summary,
    table: {
      columns: ["Cause", "Category", "How often", "Running share", "Vital few"],
      rows: rows.map((r) => [
        r.text,
        r.category,
        r.count,
        pct(r.cumulative),
        r.vital ? "Yes" : "No",
      ]),
      caption: `Causes by how often they happened, with the running share (the vital few reach ${pct(PARETO_CUTOFF)})`,
    },
  };
}

export function Pareto({ causes }: { causes: readonly RootCauseCause[] }) {
  const rows = paretoRows(causes);
  if (rows.length < PARETO_MIN_CAUSES) {
    return (
      <NotEnoughData
        have={rows.length}
        need={PARETO_MIN_CAUSES}
        unit={["cause with a count", "causes with a count"]}
        what="the Pareto chart"
      />
    );
  }
  const text = paretoText(rows);
  const points: ParetoPoint[] = rows.map((r, i) => ({
    name: String(i + 1),
    cause: r.text,
    count: r.count,
    cumulative: Math.round(r.cumulative * 100),
    vital: r.vital,
  }));
  return (
    <section aria-labelledby="pareto-heading" className="space-y-2">
      <h3 id="pareto-heading" className="text-sm font-semibold text-text">
        Pareto: which causes matter most
      </h3>
      <ChartFigure
        labelledBy="pareto-heading"
        summary={text.summary}
        table={text.table}
        plotClassName="h-[240px]"
      >
        <ParetoChart data={points} />
      </ChartFigure>
      <ol className="space-y-0.5 text-xs text-sub" aria-label="Causes in Pareto order">
        {rows.map((r, i) => (
          <li key={r.id} className={r.vital ? "font-medium text-text" : undefined}>
            {i + 1}. {r.text} · {r.count} · {pct(r.cumulative)}
            {r.vital ? " · vital few" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
