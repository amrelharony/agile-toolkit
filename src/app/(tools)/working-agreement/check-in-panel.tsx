"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { BlurInput } from "@/components/shared/blur-fields";
import { ChartFigure } from "@/components/shared/chart-card";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import type { CharterCheckIn, Sprint } from "@/lib/stores/workspace-types";
import {
  CHECK_IN_NOTE_MAX,
  TREND_MIN_ROUNDS,
  checkInAdherence,
  checkInTrend,
  dayLabel,
} from "@/lib/working-agreement/model";
import {
  ISO_DAY,
  validateCheckIn,
  type CheckInDraft,
  type CheckInField,
  type CheckInValues,
} from "./form";
import { MARK_GROUP_PREFIX } from "./rule-card";
import {
  adherenceChartText,
  adherencePoints,
  adherenceTrend,
  chartReady,
  trendTestSentence,
} from "./trend";

// Recharts loads with the chart, not the page.
const AdherenceChart = dynamic(() => import("./charts").then((m) => m.AdherenceChart), {
  ssr: false,
});

/**
 * "Save check-in round": the marks on the rules become a dated round
 * (backdatable, with an optional sprint and note). Nothing is saved until
 * at least one rule is marked.
 */
export function SaveRoundForm({
  marked,
  total,
  today,
  sprints,
  onSave,
  onDiscard,
}: {
  /** Rules marked Working or Not working in this round. */
  marked: number;
  total: number;
  /** YYYY-MM-DD, local: the latest day a round can be dated. */
  today: string;
  /** Every sprint, newest first. */
  sprints: Sprint[];
  onSave: (values: CheckInValues) => void;
  /** Clear the marks without saving (with Undo). */
  onDiscard: () => void;
}) {
  const base = useItemForm<CheckInDraft, CheckInValues, CheckInField>({
    initial: () => ({ date: today, sprintId: "", note: "" }),
    validate: (d) => validateCheckIn(d, marked, today),
    onSave,
  });
  // "Mark at least one rule" has no field in the form: the marks are on the
  // rule cards above, so a refused save takes focus to the first one's
  // "This round" choice (the form then focuses a bad date over it, if any).
  const form = {
    ...base,
    submit: (e?: FormEvent) => {
      const saved = base.submit(e);
      if (!saved && marked === 0) {
        document
          .querySelector<HTMLElement>(
            `[role="radiogroup"][aria-label^="${MARK_GROUP_PREFIX}"] [role="radio"][tabindex="0"]`
          )
          ?.focus();
      }
      return saved;
    },
  };
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Save check-in round"
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      footer={
        <Button type="button" variant="ghost" size="sm" disabled={marked === 0} onClick={onDiscard}>
          Clear the marks
        </Button>
      }
    >
      <p className="text-sm text-text" aria-live="polite">
        {marked} of {total} {total === 1 ? "rule" : "rules"} marked in this round.
      </p>
      {errors.rules && (
        <p className="text-xs text-danger" role="alert">
          {errors.rules}
        </p>
      )}
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Day of the check-in" error={errors.date} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        {sprints.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <SprintPicker
              sprints={sprints}
              selectedId={draft.sprintId || undefined}
              onSelect={(sprintId) => update({ sprintId })}
              label="Sprint (optional)"
              allowCreate={false}
            />
            {draft.sprintId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update({ sprintId: "" })}
              >
                No sprint
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <Field label="Note (optional)" hint="What the team decided to try next.">
        {(props) => (
          <Input
            {...props}
            value={draft.note}
            maxLength={CHECK_IN_NOTE_MAX}
            onChange={(e) => update({ note: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/**
 * A saved round's day, edited in place: saved on blur or Enter when it is a
 * day no later than today. Anything else goes back to the saved day, with a
 * message saying why, so the field never shows a day that wasn't saved.
 */
function RoundDayInput({
  round,
  today,
  onDate,
}: {
  round: CharterCheckIn;
  today: string;
  onDate: (round: CharterCheckIn, date: string) => void;
}) {
  const [draft, setDraft] = useState(round.date);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => setDraft(round.date), [round.date]);
  const commit = () => {
    if (draft === round.date || (ISO_DAY.test(draft) && draft <= today)) {
      setError(null);
      if (draft !== round.date) onDate(round, draft);
      return;
    }
    setError(
      ISO_DAY.test(draft) ? "Pick today or an earlier day." : "Pick the day of the check-in."
    );
    setDraft(round.date);
  };
  return (
    <div className="flex flex-col gap-1">
      <Input
        type="date"
        max={today}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-9 w-40"
        aria-label={`Day of the check-in of ${dayLabel(round.date, true)}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** One saved round: its day and note edited in place, and Delete (with Undo). */
function RoundRow({
  round,
  today,
  sprintName,
  onDate,
  onNote,
  onDelete,
}: {
  round: CharterCheckIn;
  today: string;
  sprintName: (id: string | undefined) => string | undefined;
  onDate: (round: CharterCheckIn, date: string) => void;
  onNote: (round: CharterCheckIn, note: string) => void;
  onDelete: (round: CharterCheckIn) => void;
}) {
  const a = checkInAdherence(round);
  const sprint = sprintName(round.sprintId);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <RoundDayInput round={round} today={today} onDate={onDate} />
      <span className="min-w-0 flex-1 basis-40 text-sm text-text">
        {a.working} of {a.checked} working
        <span className="text-sub">
          {" "}
          · v{round.version}
          {sprint ? ` · ${sprint}` : ""}
        </span>
      </span>
      <BlurInput
        value={round.note ?? ""}
        maxLength={CHECK_IN_NOTE_MAX}
        onCommit={(note) => onNote(round, note)}
        placeholder="Note"
        className="h-9 w-full sm:w-56"
        aria-label={`Note on the check-in of ${dayLabel(round.date, true)}`}
      />
      <IconButton
        label={`Delete the check-in of ${dayLabel(round.date, true)}`}
        icon={<Trash2 className="h-4 w-4" />}
        className="h-9 w-9 text-sub hover:text-danger"
        data-round-delete={round.id}
        onClick={() => onDelete(round)}
      />
    </li>
  );
}

/**
 * Adherence by check-in: the chart (from TREND_MIN_ROUNDS saved rounds,
 * with its summary and table), the trend test in Advanced analysis from
 * MIN_SAMPLE.trend rounds, and every saved round, newest first.
 */
export function CheckInHistory({
  rounds,
  today,
  sprintName,
  onDate,
  onNote,
  onDelete,
}: {
  rounds: readonly CharterCheckIn[];
  today: string;
  sprintName: (id: string | undefined) => string | undefined;
  onDate: (round: CharterCheckIn, date: string) => void;
  onNote: (round: CharterCheckIn, note: string) => void;
  onDelete: (round: CharterCheckIn) => void;
}) {
  const rows = checkInTrend({ checkIns: [...rounds] });
  const points = adherencePoints(rows);
  const text = adherenceChartText(rows, sprintName);
  const trend = adherenceTrend(points);
  return (
    <div className="space-y-4">
      {chartReady(points) ? (
        <ChartFigure
          label="Adherence by check-in"
          summary={text.summary}
          table={text.table}
          caption="Adherence by check-in"
          plotClassName="h-[200px]"
        >
          <AdherenceChart data={points} />
        </ChartFigure>
      ) : (
        <NotEnoughData
          have={points.length}
          need={TREND_MIN_ROUNDS}
          unit={["check-in", "check-ins"]}
          action="Save"
          what="how adherence moves"
        />
      )}
      {rounds.length > 0 && (
        <ul className="divide-y divide-border" aria-label="Saved check-ins">
          {[...rounds].reverse().map((round) => (
            <RoundRow
              key={round.id}
              round={round}
              today={today}
              sprintName={sprintName}
              onDate={onDate}
              onNote={onNote}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      {points.length >= TREND_MIN_ROUNDS && (
        <AdvancedAnalysis summary="Advanced analysis: is adherence trending?">
          {trend ? (
            <p className="text-sm text-text">{trendTestSentence(trend)}</p>
          ) : (
            <NotEnoughData
              have={points.length}
              need="trend"
              unit={["check-in", "check-ins"]}
              action="Save"
              what="whether adherence is trending"
            />
          )}
        </AdvancedAnalysis>
      )}
    </div>
  );
}
