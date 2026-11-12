"use client";

import { useId } from "react";
import { MessagesSquare } from "lucide-react";
import { ChartFigure } from "@/components/shared/chart-card";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { SHARE_RUN_CHOICES, percent, type ShareRuns, type SpeakingShares } from "./history";

/** A share is worth pointing out once it is this far above the even share. */
const WELL_ABOVE = 0.1;

/**
 * Speaking time across runs: each person's average share of the speaking
 * time over the last few meetings with rounds of turns, against an even
 * share. Names show here, for the facilitator; the export leaves them out
 * unless "Name people in the export" is on.
 */
export function SpeakingTimeCard({
  shares,
  kept,
  runs,
  onRuns,
  exportNames,
  onExportNames,
  onClear,
  onUndoClear,
}: {
  shares: SpeakingShares;
  /** Finished meetings kept, with or without turns. */
  kept: number;
  runs: ShareRuns;
  onRuns: (runs: ShareRuns) => void;
  exportNames: boolean;
  onExportNames: (on: boolean) => void;
  onClear: () => void;
  onUndoClear: () => void;
}) {
  const namesId = useId();
  const widest = Math.max(0.01, ...shares.people.map((p) => Math.max(p.share, p.even)));
  const summary =
    shares.runs === 1
      ? "Each person's share of the speaking time in the last meeting with turns."
      : `Each person's average share of the speaking time over the last ${shares.runs} meetings with turns.`;

  return (
    <SectionCard
      title="Speaking time across runs"
      icon={MessagesSquare}
      titleSize="sm"
      actions={
        <ResetButton
          label="Clear history"
          title="Clear the kept meetings?"
          description={`The ${kept === 1 ? "finished meeting" : `${kept} finished meetings`} kept for this view ${kept === 1 ? "is" : "are"} removed. The speaking order stays.`}
          confirmLabel="Clear history"
          doneLabel="Cleared the kept meetings"
          onReset={onClear}
          onUndo={onUndoClear}
          variant="ghost"
          size="sm"
        />
      }
    >
      <div className="flex flex-col gap-4">
        <ToggleGroup<ShareRuns>
          label="Meetings to average"
          size="sm"
          options={SHARE_RUN_CHOICES.map((n) => ({ value: n, label: `Last ${n}` }))}
          value={runs}
          onValueChange={onRuns}
        />
        <ChartFigure
          label="Share of the speaking time"
          summary={summary}
          table={{
            caption: "Average share of the speaking time per person",
            columns: ["Speaker", "Share", "Even share", "Meetings"],
            rows: shares.people.map((p) => [
              p.name,
              percent(p.share),
              percent(p.even),
              `${p.runs} of ${shares.runs}`,
            ]),
          }}
        >
          <ul className="space-y-3" aria-label="Speaking shares">
            {shares.people.map((p) => {
              const above = p.share - p.even >= WELL_ABOVE;
              return (
                <li key={p.key} className="grid gap-1 text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-text">{p.name}</span>
                    <span className={cn("shrink-0 font-data", above ? "text-warning" : "text-sub")}>
                      {percent(p.share)}
                      <span className="text-sub"> · even {percent(p.even)}</span>
                      {shares.runs > 1 && (
                        <span className="text-sub">
                          {" "}
                          · {p.runs} of {shares.runs}
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="relative block h-2 overflow-hidden rounded-full bg-sub/15">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        above ? "bg-warning" : "bg-accent"
                      )}
                      style={{ width: `${(p.share / widest) * 100}%` }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 w-0.5 bg-text/60"
                      style={{ left: `${(p.even / widest) * 100}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-sub">
            The thin line on each bar is an even share. Use it to invite the quieter voices, not to
            rank anyone.
          </p>
        </ChartFigure>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={namesId} className="text-sm text-text">
            Name people in the export
          </Label>
          <Switch id={namesId} checked={exportNames} onCheckedChange={onExportNames} />
        </div>
        {!exportNames && (
          <p className="text-xs text-sub">
            The export gives the range of shares, with no names, unless you turn this on.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
