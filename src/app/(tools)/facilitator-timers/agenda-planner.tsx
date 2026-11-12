"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, CalendarClock, Save, Trash2 } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { agendaTask } from "@/lib/ai/tasks/facilitator-timers";
import type { AiSource } from "@/lib/ai/task-types";
import { fitToTotal, type AgendaSegmentDraft } from "@/lib/facilitator-timers/agenda";
import {
  AGENDA_GOAL_MAX,
  DRAFT_MAX_SEGMENTS,
  type AgendaDraftState,
  type DraftSegment,
} from "@/lib/facilitator-timers/store";
import { AGENDA_NAME_MAX } from "@/app/(tools)/ceremony-timer/agenda";
import { validateAgendaName } from "@/app/(tools)/ceremony-timer/agenda-form";
import { validateAgendaRequest } from "./forms";

const minutesText = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)} min`;

export interface SavedToTimer {
  id: string;
  name: string;
}

/**
 * Draft an agenda for the Ceremony Timer: the meeting's goal and length in,
 * timed segments out, from Amr or (without AI) the nearest built-in agenda.
 * Each suggested segment is added only when the person adds it; the draft
 * can be reordered and trimmed (with Undo) and then saved to the Ceremony
 * Timer under a name, where it can be run and edited.
 */
export function AgendaPlanner({
  agenda,
  takenNames,
  namedCount,
  saved,
  onRequest,
  onAccept,
  onRemove,
  onMove,
  onClear,
  onUndoClear,
  onSave,
}: {
  agenda: AgendaDraftState;
  /** Agenda names the Ceremony Timer already has. */
  takenNames: readonly string[];
  namedCount: number;
  /** The last agenda saved to the Ceremony Timer from here. */
  saved: SavedToTimer | null;
  /** The goal and length as typed, kept with the draft. */
  onRequest: (goal: string, minutes: number | null) => void;
  onAccept: (segments: AgendaSegmentDraft[]) => void;
  onRemove: (segment: DraftSegment) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onClear: () => void;
  onUndoClear: () => void;
  onSave: (name: string) => void;
}) {
  const [goal, setGoal] = useState(agenda.goal);
  const [minutes, setMinutes] = useState(agenda.minutes === null ? "" : String(agenda.minutes));
  const [suggested, setSuggested] = useState<{
    title: string;
    items: AgendaSegmentDraft[];
    source: AiSource;
  } | null>(null);
  const request = validateAgendaRequest({ goal, minutes });
  // A field shows its error once something is typed in it; while blank,
  // the button says what it needs.
  const errors = request.ok ? {} : request.errors;
  const total = agenda.segments.reduce((s, x) => s + x.minutes, 0);
  const room = DRAFT_MAX_SEGMENTS - agenda.segments.length;

  const nameForm = useItemForm<{ name: string }, string, "name">({
    initial: { name: "" },
    validate: (d) => validateAgendaName(d.name, takenNames, namedCount),
    onSave: (name) => onSave(name),
  });

  return (
    <SectionCard
      title="Draft an agenda"
      icon={CalendarClock}
      titleSize="sm"
      actions={
        agenda.segments.length > 0 && (
          <ResetButton
            label="Clear draft"
            title="Clear the agenda draft?"
            description="Every segment in the draft is removed. Agendas saved to the Ceremony Timer stay."
            confirmLabel="Clear draft"
            doneLabel="Cleared the agenda draft"
            onReset={onClear}
            onUndo={onUndoClear}
            variant="ghost"
            size="sm"
          />
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="What is the meeting for?"
          error={goal.trim() ? errors.goal : undefined}
          required
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={AGENDA_GOAL_MAX}
              value={goal}
              placeholder="Agree how we split the checkout rewrite into releases"
              onChange={(e) => setGoal(e.target.value)}
              onBlur={() => onRequest(goal.trim(), request.ok ? request.values.minutes : null)}
            />
          )}
        </Field>
        <Field
          label="Minutes"
          hint="5 to 480."
          error={minutes.trim() ? errors.minutes : undefined}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={5}
              max={480}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              onBlur={() => onRequest(goal.trim(), request.ok ? request.values.minutes : null)}
              className="max-w-[8rem] font-data"
            />
          )}
        </Field>
        <div>
          <AiButton
            task={agendaTask}
            input={() => ({ goal: goal.trim(), minutes: Number(minutes) })}
            label="Ask Amr for an agenda"
            fallbackLabel="Suggest from a template"
            disabledReason={
              request.ok ? null : "Say what the meeting is for and how many minutes it has first."
            }
            onResult={(data, meta) => {
              if (!request.ok) return;
              onRequest(request.values.goal, request.values.minutes);
              setSuggested({
                title: data.title,
                items: fitToTotal(data.segments, request.values.minutes),
                source: meta.source,
              });
            }}
          />
        </div>

        {suggested && (
          <AiSuggestions
            items={suggested.items.slice(0, Math.max(0, room))}
            title={`Suggested: ${suggested.title}`}
            source={suggested.source}
            acceptLabel="Add"
            render={(s) => ({
              title: `${s.label} · ${minutesText(s.minutes)}`,
              detail: s.hint || undefined,
            })}
            onAccept={(s) => onAccept([s])}
            onAcceptAll={(items) => onAccept(items)}
            onDismiss={() => setSuggested(null)}
          />
        )}

        {agenda.segments.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-text">
              Your draft: {minutesText(total)}
              {agenda.minutes && agenda.minutes !== total ? ` of ${agenda.minutes} planned` : ""}
            </h3>
            <ol className="flex flex-col gap-1" aria-label="Agenda draft">
              {agenda.segments.map((s, i) => (
                <li
                  key={s.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-text">
                      {i + 1}. {s.label}{" "}
                      <span className="font-data text-xs text-sub">{minutesText(s.minutes)}</span>
                    </span>
                    {s.hint && <span className="block text-xs text-sub">{s.hint}</span>}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconButton
                      label={`Move ${s.label} up`}
                      icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => onMove(s.id, -1)}
                      disabled={i === 0}
                    />
                    <IconButton
                      label={`Move ${s.label} down`}
                      icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => onMove(s.id, 1)}
                      disabled={i === agenda.segments.length - 1}
                    />
                    <IconButton
                      label={`Remove ${s.label}`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => onRemove(s)}
                      className="text-sub hover:text-danger"
                    />
                  </span>
                </li>
              ))}
            </ol>
            <ItemForm
              form={nameForm}
              submitLabel="Save to the Ceremony Timer"
              submitIcon={<Save aria-hidden="true" />}
            >
              <Field
                label="Agenda name"
                hint="It joins Your agendas in the Ceremony Timer."
                error={nameForm.errors.name}
                required
              >
                {(p) => (
                  <Input
                    {...p}
                    maxLength={AGENDA_NAME_MAX}
                    value={nameForm.draft.name}
                    placeholder={suggested?.title ?? "Release slicing workshop"}
                    onChange={(e) => nameForm.update({ name: e.target.value })}
                  />
                )}
              </Field>
            </ItemForm>
          </div>
        )}

        {saved && (
          <p className="text-sm text-text" role="status">
            Saved “{saved.name}” to the Ceremony Timer.{" "}
            <Link
              href={`/ceremony-timer?agenda=${saved.id}`}
              className="font-medium text-accent underline underline-offset-2"
            >
              Run it in the Ceremony Timer
            </Link>
          </p>
        )}
      </div>
    </SectionCard>
  );
}
