"use client";

import { useId } from "react";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import type { Tile } from "../view";

/** The sprint's numbers: plan, scope, progress, pace and history. */
export function SprintTiles({ tiles }: { tiles: Tile[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Where the sprint stands
      </h2>
      <KpiGrid cols={[2, 2, 3, 4]} marginBottom="none">
        {tiles.map((t) => (
          <div key={t.id} data-tile={t.id} className="min-w-0">
            <StatCard
              variant="compact"
              label={t.label}
              value={t.value}
              unit={t.unit}
              hint={t.hint}
              tone={t.tone}
              className="h-full"
              valueClassName={t.empty ? "font-sans text-base text-sub" : undefined}
            />
          </div>
        ))}
      </KpiGrid>
    </section>
  );
}
