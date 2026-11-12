"use client";

import { History, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { groupLabel } from "@/lib/team-mixer/model";
import type { MixerRound } from "@/lib/team-mixer/state";

export interface HistoryCardProps {
  rounds: readonly MixerRound[];
  onRemove: (round: MixerRound) => void;
  onStartOver: () => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The rounds so far, newest first: what the next round avoids. Removing a
 * round (or starting over) lets its pairings count again; both have Undo.
 */
export function HistoryCard({ rounds, onRemove, onStartOver }: HistoryCardProps) {
  const numbered = rounds.map((r) => ({ r, n: r.number })).reverse();
  return (
    <SectionCard
      title={`Rounds so far (${rounds.length})`}
      icon={History}
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onStartOver}>
          Start over
        </Button>
      }
    >
      <p className="mb-3 text-sm text-sub">
        The next round avoids everyone who has already been together here. Start over to forget
        them.
      </p>
      <ol className="space-y-2" aria-label="Rounds so far">
        {numbered.map(({ r, n }) => (
          <li
            key={r.id}
            className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">
                Round {n}
                <span className="ml-1.5 text-xs font-normal text-sub">
                  {when(r.at)} · {r.groups.length} {r.mode === "pairs" ? "pairs" : "groups"}
                </span>
              </p>
              <p className="break-words text-xs text-sub">
                {r.groups
                  .map((g, i) => `${g.name || groupLabel(r.mode, i)}: ${g.people.join(", ")}`)
                  .join(" · ")}
              </p>
            </div>
            <IconButton
              label={`Remove round ${n}`}
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => onRemove(r)}
            />
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
