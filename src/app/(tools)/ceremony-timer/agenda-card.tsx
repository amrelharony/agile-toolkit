"use client";

import { useState } from "react";
import { Check, ListChecks, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { formatClock } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import { agendaSeconds, durationText, shortClock, type Agenda, type Segment } from "./agenda";
import {
  draftOf,
  validateAgenda,
  withRowMinutes,
  withTotal,
  type AgendaDraft,
} from "./agenda-form";
import type { RunView } from "./run";

/**
 * The agenda's segments with the time each took so far, and the editor for
 * the team's own lengths, names and rounds of turns. Edits are saved for
 * this agenda only; "Reset to defaults" puts the cadence's lengths back.
 */
export function AgendaCard({
  agenda,
  view,
  onSave,
  onResetDefaults,
  onRestore,
}: {
  agenda: Agenda;
  view: RunView;
  onSave: (segments: Segment[]) => void;
  onResetDefaults: () => void;
  onRestore: () => void;
}) {
  // A Custom time-box has nothing to run until it has a length: open the
  // editor straight away rather than a Start that does nothing.
  const unset = agendaSeconds(agenda) <= 0;
  const [editing, setEditing] = useState(false);
  const open = editing || unset;

  return (
    <SectionCard
      title={`${agenda.label} agenda`}
      icon={ListChecks}
      titleSize="sm"
      actions={
        !open && (
          <>
            {agenda.edited && (
              <ResetButton
                label="Reset to defaults"
                title={`Reset the ${agenda.label} agenda?`}
                description="Each segment's name, length and round of turns go back to the defaults for your sprint length."
                confirmLabel="Reset agenda"
                doneLabel={`Reset the ${agenda.label} agenda`}
                onReset={onResetDefaults}
                onUndo={onRestore}
              />
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit agenda
            </Button>
          </>
        )
      }
    >
      {open ? (
        <AgendaEditor
          // A fresh draft each time the editor opens, from the agenda as it is.
          key={agenda.id}
          agenda={agenda}
          onSave={(segments) => {
            onSave(segments);
            setEditing(false);
          }}
          onCancel={unset ? undefined : () => setEditing(false)}
        />
      ) : (
        <SegmentList agenda={agenda} view={view} />
      )}
    </SectionCard>
  );
}

/** Each segment: planned, then what it took (done), so far (on), or nothing yet. */
function SegmentList({ agenda, view }: { agenda: Agenda; view: RunView }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Agenda segments">
      {view.lines.map((line) => {
        const { segment, state, spentSeconds } = line;
        const over = spentSeconds - segment.seconds;
        const reached = view.started && state !== "next";
        return (
          <li
            key={segment.id}
            aria-current={state === "current" && !view.finished ? "step" : undefined}
            className={cn(
              "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 rounded-lg px-2 py-2 text-sm",
              state === "current" && !view.finished ? "bg-accent/10" : undefined
            )}
          >
            <span className="pt-0.5 font-data text-xs text-sub">
              {state === "done" ? (
                <>
                  <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                  <span className="sr-only">Done:</span>
                </>
              ) : (
                `${line.index + 1}.`
              )}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 text-text">
                {segment.label}
                {segment.speakers && (
                  <span className="inline-flex items-center gap-1 text-xs text-sub">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    turns
                  </span>
                )}
              </span>
              {agenda.segments.length > 1 && (
                <span className="block text-xs text-sub">{segment.hint}</span>
              )}
            </span>
            <span className="text-right font-data text-xs tabular-nums">
              <span className="block text-sub">
                <span className="sr-only">Planned </span>
                {durationText(segment.seconds)}
              </span>
              {reached && (
                <span className={cn("block", over > 0 ? "text-warning" : "text-text")}>
                  <span className="sr-only">{state === "done" ? "Took " : "So far "}</span>
                  {formatClock(spentSeconds)}
                  {state === "done" && over !== 0 && (
                    <span>
                      {" "}
                      ({over > 0 ? "+" : "−"}
                      {shortClock(Math.abs(over))})
                    </span>
                  )}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Draft-then-save: nothing changes until every segment has a name and a usable length. */
function AgendaEditor({
  agenda,
  onSave,
  onCancel,
}: {
  agenda: Agenda;
  onSave: (segments: Segment[]) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<AgendaDraft, Segment[], string>({
    initial: () => draftOf(agenda),
    validate: (d) => validateAgenda(d, agenda),
    onSave: (segments) => onSave(segments),
    resetOnSave: false,
  });
  const { draft, errors } = form;
  const multi = draft.rows.length > 1;
  const setDraft = (next: AgendaDraft) => form.update(next);

  return (
    <ItemForm form={form} submitLabel="Save agenda" onCancel={onCancel}>
      {multi && (
        <Field
          label="Total minutes"
          hint="Changing the total re-splits the segments in the same proportions."
          error={errors.total}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={0.5}
              max={480}
              step={0.5}
              value={draft.total}
              onChange={(e) => setDraft(withTotal(draft, e.target.value))}
              className="max-w-[10rem] font-data"
            />
          )}
        </Field>
      )}
      <ol className="flex flex-col gap-3" aria-label="Segments">
        {draft.rows.map((row, i) => (
          <li
            key={row.id}
            className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_7rem]"
          >
            <Field
              label={multi ? `Segment ${i + 1} name` : "Name"}
              error={errors[`label:${row.id}`]}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  value={row.label}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rows: draft.rows.map((r) =>
                        r.id === row.id ? { ...r, label: e.target.value } : r
                      ),
                    })
                  }
                />
              )}
            </Field>
            <Field
              label={multi ? `Segment ${i + 1} minutes` : "Minutes"}
              error={errors[`minutes:${row.id}`]}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  max={480}
                  step={0.5}
                  value={row.minutes}
                  onChange={(e) => setDraft(withRowMinutes(draft, row.id, e.target.value))}
                  className="font-data"
                />
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-sub sm:col-span-2">
              <input
                type="checkbox"
                checked={row.speakers}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rows: draft.rows.map((r) =>
                      r.id === row.id ? { ...r, speakers: e.target.checked } : r
                    ),
                  })
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Speakers take turns
              {multi && <span className="sr-only"> in segment {i + 1}</span>}
            </label>
          </li>
        ))}
      </ol>
    </ItemForm>
  );
}
