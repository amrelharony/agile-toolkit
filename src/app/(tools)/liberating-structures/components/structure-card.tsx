"use client";

import Link from "@/components/motion/transition-link";
import { Clock, ExternalLink, Heart, Play, Timer, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { RefFor } from "@/hooks/use-return-focus";
import {
  LS_PURPOSE_LABEL,
  LS_SOURCE_URL,
  lsPeopleLabel,
  stepsMinutes,
  type LsStructure,
} from "@/lib/liberating-structures/catalog";
import type { DockedTimer } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";

/** The Ceremony Timer link for a structure it has an agenda for. */
export const ceremonyTimerHref = (agenda: string) =>
  `/ceremony-timer?agenda=${encodeURIComponent(agenda)}`;

/**
 * One structure: its purpose, people and timing; opened, how it runs step
 * by step, the step timer, and the source.
 *
 * Its title and Start button register with the page's useReturnFocus
 * (`title:<id>`, `start:<id>`): opening it from the favourites strip, and
 * stopping its run at the top of the page, bring focus back here.
 */
export function StructureCard({
  structure: s,
  refFor,
  isFavorite,
  expanded,
  onExpand,
  onToggleFavorite,
  isRunning,
  ownRunTitle,
  otherTimer,
  onStartTimer,
}: {
  structure: LsStructure;
  refFor: RefFor;
  isFavorite: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggleFavorite: () => void;
  /** This structure's steps are on the step timer now. */
  isRunning: boolean;
  /** Another structure's run this page has on the dock, which Start replaces. */
  ownRunTitle: string | null;
  /** Another page's timer holding the dock, which this page never replaces. */
  otherTimer: DockedTimer | null;
  onStartTimer: () => void;
}) {
  const total = stepsMinutes(s);
  return (
    <Card
      id={`ls-card-${s.id}`}
      className={cn(
        "relative bg-surface border-border transition cursor-pointer scroll-mt-24",
        expanded ? "border-accent/40" : "hover:border-accent/30"
      )}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          {/* The title button stretches over the card (see icebreaker). */}
          <button
            ref={refFor(`title:${s.id}`)}
            type="button"
            onClick={onExpand}
            aria-expanded={expanded}
            className="text-sm font-semibold text-text text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
          >
            {s.name}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={`${isFavorite ? "Remove" : "Add"} ${s.name} ${isFavorite ? "from" : "to"} favorites`}
            aria-pressed={isFavorite}
            className="relative z-10 shrink-0 p-1 -m-1 min-touch-coarse inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Heart
              aria-hidden="true"
              className={cn(
                "w-4 h-4 transition",
                isFavorite ? "fill-accent text-accent" : "text-sub hover:text-accent"
              )}
            />
          </button>
        </div>
        <div className="text-xs text-sub line-clamp-2">{s.purpose}</div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline" className="text-xs bg-bg border-border text-sub">
            <Clock className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {s.timing}
          </Badge>
          <Badge variant="outline" className="text-xs bg-bg border-border text-sub">
            <Users className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {lsPeopleLabel(s)}
          </Badge>
          {s.purposes.map((p) => (
            <Badge
              key={p}
              variant="outline"
              className="text-xs bg-accent/10 border-accent/30 text-accent"
            >
              {LS_PURPOSE_LABEL[p]}
            </Badge>
          ))}
          {isRunning && (
            <Badge variant="outline" className="text-xs bg-info/10 border-info/30 text-info">
              <Timer className="w-3 h-3 mr-0.5" aria-hidden="true" />
              Running
            </Badge>
          )}
        </div>
        {expanded && (
          // Above the title's stretched hit area, so the text is selectable
          // and the buttons clickable.
          <div className="relative z-10 pt-2 border-t border-border space-y-3 cursor-auto">
            <p className="text-xs text-text leading-relaxed">{s.description}</p>

            {s.steps ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-sub">
                  Steps ({total} min)
                </p>
                <ol className="space-y-1 text-xs">
                  {s.steps.map((step) => (
                    <li key={step.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-text">
                        {step.label}
                        <span className="block text-sub">{step.hint}</span>
                      </span>
                      <span className="shrink-0 font-mono text-sub">{step.minutes} min</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="text-xs text-sub">
                It runs as one open session at the group&apos;s pace, so there is no step timer.
              </p>
            )}

            {s.steps && (
              <div className="space-y-1.5">
                {isRunning ? (
                  <p className="text-xs text-sub">On the step timer at the top of the page.</p>
                ) : otherTimer ? (
                  <p className="text-xs text-sub" role="status">
                    The {otherTimer.label} timer is running, so the step timer can&apos;t start.{" "}
                    <Link
                      href={otherTimer.href}
                      className="text-accent underline-offset-2 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Open the {otherTimer.label} timer
                    </Link>
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      ref={refFor(`start:${s.id}`)}
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={onStartTimer}
                    >
                      <Play aria-hidden="true" />
                      Start step timer
                    </Button>
                    {ownRunTitle && (
                      <span className="text-xs text-sub">Replaces the {ownRunTitle} timer.</span>
                    )}
                  </div>
                )}
                {s.ceremonyTimerAgenda && (
                  <p className="text-xs text-sub">
                    <Link
                      href={ceremonyTimerHref(s.ceremonyTimerAgenda)}
                      className="text-accent underline-offset-2 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Open in the Ceremony Timer
                    </Link>{" "}
                    (opens its {s.name} agenda unless a meeting is already running there).
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <a
                href={LS_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-sub hover:text-accent rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Source: {s.source}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                aria-pressed={isFavorite}
                className="gap-1.5 text-xs"
              >
                <Heart
                  aria-hidden="true"
                  className={cn("w-3.5 h-3.5", isFavorite && "fill-accent text-accent")}
                />
                {isFavorite ? "Saved" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
