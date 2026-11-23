"use client";

/**
 * Team stability: who was in each finished sprint against the one before
 * (stayed, joined, left), on either board, with where the names came from.
 * A change in the last two sprints gets a line about the forecast. It says
 * when the team changed, never why.
 */

import Link from "next/link";
import { Users } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { changedRecently, type TeamStability } from "@/lib/flow/stability";

const names = (list: readonly string[]) => (list.length ? list.join(", ") : "—");

export function StabilitySection({
  stability,
  rows: shownRows,
}: {
  stability: TeamStability;
  /** How many of the latest sprints to show. */
  rows: number;
}) {
  const rows = stability.rows.slice(-shownRows);
  const rough = rows.some((r) => r.rough);

  return (
    <SectionCard title="Team stability" icon={Users} contentClassName="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-sub">
          No finished sprints yet, so there is no team to compare. Close a sprint, and record who is
          in each one in the{" "}
          <Link href="/capacity-planner" className="text-accent underline-offset-2 hover:underline">
            Capacity Planner
          </Link>
          .
        </p>
      ) : (
        <>
          {changedRecently(stability) && (
            <p
              role="note"
              className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
            >
              Forecasts lean on sprints before the change: check the{" "}
              <Link
                href="/release-planner"
                className="text-accent underline-offset-2 hover:underline"
              >
                Release Planner
              </Link>
              &apos;s range.
            </p>
          )}
          <div className="relative overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">
                Who was in each sprint, against the sprint before
              </caption>
              <thead>
                <tr className="border-b border-border bg-surface-deep text-xs uppercase tracking-wider text-sub">
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Sprint
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    People
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Stayed
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Joined
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">
                    Left
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Stability
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Points done
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sprintId} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-text">
                      {r.name}
                      {r.rough && <span className="text-xs text-sub"> (rough)</span>}
                    </th>
                    <td className="px-2 py-2 text-right font-data">{r.people}</td>
                    <td className="px-2 py-2 text-right font-data">
                      {r.pct === null ? "—" : r.stayed}
                    </td>
                    <td className="px-2 py-2 text-left">{names(r.joined)}</td>
                    <td className="px-2 py-2 text-left">{names(r.left)}</td>
                    <td className="px-2 py-2 text-right font-data">
                      {r.pct === null ? "—" : `${r.pct}%`}
                    </td>
                    <td className="px-3 py-2 text-right font-data">{r.pointsCompleted ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-sub">
            Stability is the people in both sprints over the people in either.{" "}
            {rough
              ? "Rough rows have no capacity plan of their own on both sides, so they read who owned each sprint's stories: someone who owned none doesn't show."
              : "Read from each sprint's own capacity plan."}{" "}
            <Link
              href="/capacity-planner"
              className="text-accent underline-offset-2 hover:underline"
            >
              Record who&apos;s in each sprint in the Capacity Planner
            </Link>
            .
          </p>
        </>
      )}
    </SectionCard>
  );
}
