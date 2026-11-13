"use client";

/**
 * Wall mode for the Sprint Cockpit: the sprint on a screen nobody touches,
 * such as a team room's TV, in large type and refreshing by itself.
 *
 * The view itself is the shared `WallView` (components/presentation/
 * wall-view): it builds on Present mode, refreshes every minute, holds
 * nothing to press and makes the page under it inert. This file holds what
 * the cockpit puts on it (`CockpitWallContent`) and the button that opens
 * it (`WallModeButton`). `WallView`'s `onRefresh` runs on every refresh,
 * not on opening, so the cockpit moves its day and clock on both there and
 * as the button opens the wall.
 */

import { Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPresenting } from "@/components/presentation/presentation-mode";
import { StatCard } from "@/components/shared/stat-card";
import { CEREMONY_LABEL, whenLabel, type CeremonyOccurrence } from "@/lib/sprints/cadence";
import type { Tile } from "@/lib/sprints/hub-view";
import { RISK_LEVEL_LABEL, type SprintRisk } from "@/lib/sprints/risk";
import { cn } from "@/lib/utils";

/** The tiles the wall shows, in this order, when the cockpit has them. */
export const WALL_TILES: readonly Tile["id"][] = [
  "committed",
  "done",
  "remaining",
  "gap",
  "finish",
  "blockers",
  "interrupts",
];

/**
 * What the wall shows: where the sprint is in its days, the verdict, the
 * goal check with its reasons, the main numbers and the next ceremony.
 */
export function CockpitWallContent({
  dayLine,
  goal,
  verdict,
  risk,
  tiles,
  next,
  now,
}: {
  /** "Day 5 of 14 · 9 days left". */
  dayLine: string;
  goal?: string;
  verdict: string;
  risk: SprintRisk;
  tiles: readonly Tile[];
  next: CeremonyOccurrence | undefined;
  now: Date;
}) {
  const shown = WALL_TILES.map((id) => tiles.find((t) => t.id === id)).filter((t): t is Tile =>
    Boolean(t)
  );
  const atRisk = risk.level === "at_risk";
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="font-data text-sub">{dayLine}</p>
        {goal && <p className="text-2xl font-semibold sm:text-4xl">Goal: {goal}</p>}
        <p className="sm:text-3xl">{verdict}</p>
      </div>
      {risk.applies && (
        <div
          data-wall-risk={risk.level}
          className={cn(
            "rounded-xl border p-4 sm:p-6",
            atRisk
              ? "border-destructive/40 bg-destructive/5"
              : risk.level === "watch"
                ? "border-warning/40 bg-warning/5"
                : "border-success/40 bg-success/5"
          )}
        >
          {/* The label, then the headline: it says the level in its own words. */}
          <p className="font-semibold sm:text-3xl">Goal check: {RISK_LEVEL_LABEL[risk.level]}</p>
          <p className="sm:text-3xl">{risk.headline}</p>
          {risk.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {risk.reasons.slice(0, 3).map((r) => (
                <li key={r.id}>{r.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {shown.map((t) => (
            <StatCard
              key={t.id}
              label={t.label}
              value={t.value}
              unit={t.unit}
              hint={t.hint}
              tone={t.tone}
              className="h-full"
              valueClassName={t.empty ? "font-sans text-xl text-sub" : undefined}
            />
          ))}
        </div>
      )}
      {next && (
        <p className="text-sub">
          Next: <span className="text-text">{CEREMONY_LABEL[next.kind]}</span> ·{" "}
          {whenLabel(next.at, now)}
        </p>
      )}
    </div>
  );
}

/** The "Wall mode" button: opens the view in the same tick as the click, so fullscreen is allowed. */
export function WallModeButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Show the sprint on a screen nobody touches, refreshing by itself"
      onClick={() => {
        startPresenting();
        onOpen();
      }}
    >
      <Tv aria-hidden="true" />
      Wall mode
    </Button>
  );
}
