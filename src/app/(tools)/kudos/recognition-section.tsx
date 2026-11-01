"use client";

import { Award, Lightbulb, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import type { FairnessHint, RecognitionSummary } from "@/lib/kudos/recognition";
import { RECENT_DAYS } from "@/lib/kudos/recognition";
import type { Sprint } from "@/lib/stores/workspace-types";
import { recognitionChartText, recognitionRows, type RecognitionRow } from "./verdict";

/** Which kudos the Recognition section counts. */
export type WindowMode = "sprint" | "recent" | "all";

/** "Sam", from "Sam Lee": the button names a person by their first name. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Kudos received per person as plain bars: one row each, the roster's
 * teammates with none included (an empty bar is the point). ChartFigure
 * hides it from screen readers behind its summary and table.
 */
function RecognitionBars({ rows }: { rows: RecognitionRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2rem] items-center gap-2 text-xs"
        >
          <span className="truncate text-text" title={r.name}>
            {r.name}
            {!r.onRoster && <span className="text-sub"> · not on the team</span>}
          </span>
          <span className="h-3 overflow-hidden rounded bg-surface-deep">
            <span
              className="block h-3 rounded bg-accent"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-data text-text">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export interface RecognitionSectionProps {
  summary: RecognitionSummary;
  hints: FairnessHint[];
  rosterSize: number;
  /** "in Sprint 12", "in the last 30 days", "so far". */
  windowLabel: string;
  verdict: string;
  mode: WindowMode;
  onMode: (mode: WindowMode) => void;
  /** Sprints with real dates, newest first. */
  sprints: Sprint[];
  selectedSprintId: string | undefined;
  onSelectSprint: (id: string) => void;
  /** Shown when the Sprint window has no dated sprint to read. */
  sprintNote?: string;
  /** "Send to …" for a teammate with none; absent while the example is shown. */
  onSendTo?: (memberId: string) => void;
  /** Can the form pick this member (they're in its recipient list)? */
  canSendTo?: (memberId: string) => boolean;
}

/**
 * Recognition received: who the kudos in a window reached, from how many
 * people, with fairness hints from the roster. Counts show from the first
 * kudos; shares and hints wait for MIN_SAMPLE.distribution of them.
 */
export function RecognitionSection({
  summary,
  hints,
  rosterSize,
  windowLabel,
  verdict,
  mode,
  onMode,
  sprints,
  selectedSprintId,
  onSelectSprint,
  sprintNote,
  onSendTo,
  canSendTo,
}: RecognitionSectionProps) {
  const rows = recognitionRows(summary);
  const text = recognitionChartText(summary, rosterSize, windowLabel);
  return (
    <SectionCard title="Recognition received" icon={Award} contentClassName="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          {/* The group names itself ("Window"); this is the visible caption. */}
          <span className="text-xs font-medium text-sub" aria-hidden="true">
            Window
          </span>
          <ToggleGroup<WindowMode>
            label="Window"
            size="sm"
            value={mode}
            onValueChange={onMode}
            options={[
              { value: "sprint", label: "Sprint", disabled: sprints.length === 0 },
              { value: "recent", label: `Last ${RECENT_DAYS} days` },
              { value: "all", label: "All time" },
            ]}
          />
        </div>
        {mode === "sprint" && sprints.length > 0 && (
          <SprintPicker
            sprints={sprints}
            selectedId={selectedSprintId}
            onSelect={onSelectSprint}
            allowCreate={false}
          />
        )}
      </div>
      {sprintNote && <p className="text-xs text-sub">{sprintNote}</p>}

      <p className="text-sm font-medium text-text">{verdict}</p>

      {rows.length > 0 && (
        <ChartFigure
          label="Kudos received per person"
          summary={text.summary}
          table={text.table}
          caption={`Kudos received ${windowLabel}`}
        >
          <RecognitionBars rows={rows} />
        </ChartFigure>
      )}

      {summary.total > 0 && !summary.enough && (
        <NotEnoughData
          have={summary.total}
          need="distribution"
          unit={["kudos", "kudos"]}
          action="Send"
          what="how recognition spreads across the team"
        />
      )}

      {hints.length > 0 && (
        <ul className="space-y-2" aria-label="Fairness hints">
          {hints.map((h) => {
            const target = h.kind === "none-received" ? h.memberIds[0] : undefined;
            const name = h.kind === "none-received" ? h.names[0] : undefined;
            const sendable = target && name && onSendTo && (canSendTo?.(target) ?? true);
            return (
              <li
                key={h.kind}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-surface-deep/40 px-3 py-2 text-sm"
              >
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-text">{h.sentence}</p>
                {sendable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => onSendTo(target)}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    Send to {firstName(name)}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
