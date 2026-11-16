"use client";

import { useId } from "react";
import Link from "next/link";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import type { Tile } from "@/lib/sprints/hub-view";

/**
 * The sprint's numbers: plan, scope, progress, pace and history. A tile
 * with an `href` (the cockpit's interrupt buffer) links as a whole to the
 * tool that holds its numbers: the link covers the card, and its name says
 * where it goes while the card's text is read as it is.
 */
export function SprintTiles({ tiles }: { tiles: Tile[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Where the sprint stands
      </h2>
      <KpiGrid cols={[2, 2, 3, 4]} marginBottom="none">
        {tiles.map((t) => (
          <div key={t.id} data-tile={t.id} className="relative min-w-0">
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
            {t.href && (
              <Link
                href={t.href}
                data-tile-link={t.id}
                className="absolute inset-0 rounded-lg hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="sr-only">{t.linkLabel ?? `Open ${t.label}`}</span>
              </Link>
            )}
          </div>
        ))}
      </KpiGrid>
    </section>
  );
}
