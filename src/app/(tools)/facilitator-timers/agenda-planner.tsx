"use client";

import { useEffect, useRef, useState } from "react";
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
import { parseNumber, type Validation } from "@/lib/utils/form";
import { AGENDA_NAME_MAX, MAX_AGENDA_MINUTES } from "@/app/(tools)/ceremony-timer/agenda";
import { validateAgendaName } from "@/app/(tools)/ceremony-timer/agenda-form";
import { validateAgendaRequest } from "./forms";

const minutesText = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
const minutesField = (m: number | null) => (m === null ? "" : String(m));

/** The minutes typed, when they are a length the draft can keep. */
function usableMinutes(raw: string): number | null {
  const n = parseNumber(raw);
  return n !== undefined && Number.isInteger(n) && n >= 5 && n <= 480 ? n : null;
}

const FULL_TEXT = `The draft holds up to ${DRAFT_MAX_SEGMENTS} segments. Remove one to add more.`;

export interface SavedToTimer {
  id: string;
  name: string;
}

/**
 * Draft an agenda for the Ceremony Timer: the meeting's goal and length in,
 * timed segments out, from Amr or (without AI) the nearest built-in agenda.
 * Each suggested segment is added only when the person adds it (with Undo);
 * the draft can be reordered and trimmed (with Undo) and then saved to the
 * Ceremony Timer under a name, where it can be run and edited.
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
  /** The goal and length as typed, kept with the draft (null minutes: keep the saved ones). */
  onRequest: (goal: string, minutes: number | null) => void;
  /** Add suggested segments, as many as fit; returns how many were added. */
  onAccept: (segments: AgendaSegmentDraft[]) => number;
  onRemove: (segment: DraftSegment) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onClear: () => void;
  onUndoClear: () => void;
  onSave: (name: string) => void;
}) {
  const [goal, setGoal] = useState(agenda.goal);
  const [minutes, setMinutes] = useState(minutesField(agenda.minutes));
  // The fields follow the draft whenever it changes under them: an example
  // loaded or cleared, a change synced from another device, or the trimmed
  // value of what was typed here.
  const shown = useRef({ goal: agenda.goal, minutes: agenda.minutes });
  useEffect(() => {
    if (agenda.goal !== shown.current.goal) setGoal(agenda.goal);
    if (agenda.minutes !== shown.current.minutes) setMinutes(minutesField(agenda.minutes));
    shown.current = { goal: agenda.goal, minutes: agenda.minutes };
  }, [agenda.goal, agenda.minutes]);

  const [suggested, setSuggested] = useState<{
    title: string;
    items: AgendaSegmentDraft[];
    source: AiSource;
    /** A new list (a new answer, or what didn't fit) starts the review afresh. */
    round: number;
  } | null>(null);
  const request = validateAgendaRequest({ goal, minutes });
  // A field shows its error once something is typed in it; while blank,
  // the button says what it needs.
  const errors = request.ok ? {} : request.errors;
  const total = agenda.segments.reduce((s, x) => s + x.minutes, 0);
  const room = DRAFT_MAX_SEGMENTS - agenda.segments.length;
  const full = room <= 0;

  /** Keep what was typed with the draft, only when it changes what the draft holds. */
  const commit = () => {
    const g = goal.trim().slice(0, AGENDA_GOAL_MAX);
    const m = usableMinutes(minutes);
    if (g === agenda.goal && (m === null || m === agenda.minutes)) return;
    onRequest(g, m);
  };

  // Removing, moving and adding change or remove the focused control, and
  // focus would otherwise drop to the page: where it goes next, once React
  // has drawn the change.
  const rootRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const root = rootRef.current;
    const byData = (v: string) => root?.querySelector<HTMLButtonElement>(`[data-draft="${v}"]`);
    if (target === "full") return fullRef.current?.focus();
    if (target === "ask") return askRef.current?.querySelector<HTMLElement>("button")?.focus();
    if (target === "goal") return root?.querySelector<HTMLElement>("textarea")?.focus();
    const [id, what] = target.split(":");
    if (what === "up" || what === "down") {
      // A row moved to the top or bottom has that arrow switched off: its other one.
      const arrow = byData(target);
      const other = byData(`${id}:${what === "up" ? "down" : "up"}`);
      return (arrow && !arrow.disabled ? arrow : other)?.focus();
    }
    byData(target)?.focus();
  });

  const move = (s: DraftSegment, dir: "up" | "down") => {
    focusNext.current = `${s.id}:${dir}`;
    onMove(s.id, dir === "up" ? -1 : 1);
  };
  const remove = (s: DraftSegment, i: number) => {
    const next = agenda.segments[i + 1] ?? agenda.segments[i - 1];
    focusNext.current = next ? `${next.id}:remove` : "goal";
    onRemove(s);
  };
  const addOne = (s: AgendaSegmentDraft) => {
    const n = onAccept([s]);
    // The list hides once the draft is full: say so where focus can land.
    if (n > 0 && room - n <= 0) focusNext.current = "full";
  };
  const addAll = (items: AgendaSegmentDraft[]) => {
    const n = onAccept(items);
    if (n < items.length) {
      // What didn't fit stays on offer for when there is room again.
      setSuggested((cur) => cur && { ...cur, items: items.slice(n), round: cur.round + 1 });
      focusNext.current = "full";
    }
  };

  const nameForm = useItemForm<{ name: string }, string, "name" | "total">({
    initial: { name: "" },
    validate: (d): Validation<string, "name" | "total"> => {
      const named = validateAgendaName(d.name, takenNames, namedCount);
      // The Ceremony Timer edits an agenda only within its limit.
      const tooLong = total > MAX_AGENDA_MINUTES;
      if (named.ok && !tooLong) return named;
      return {
        ok: false,
        errors: {
          ...(named.ok ? {} : named.errors),
          ...(tooLong
            ? {
                total: `The Ceremony Timer runs agendas of up to ${MAX_AGENDA_MINUTES} minutes. Remove or shorten a segment first.`,
              }
            : {}),
        },
      };
    },
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
            onReset={() => {
              focusNext.current = "goal";
              onClear();
            }}
            onUndo={onUndoClear}
            variant="ghost"
            size="sm"
          />
        )
      }
    >
      <div ref={rootRef} className="flex flex-col gap-4">
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
              onBlur={commit}
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
              onBlur={commit}
              className="max-w-[8rem] font-data"
            />
          )}
        </Field>
        <div ref={askRef}>
          <AiButton
            task={agendaTask}
            input={() => ({ goal: goal.trim(), minutes: Number(minutes) })}
            label="Ask Amr for an agenda"
            fallbackLabel="Suggest from a template"
            disabledReason={
              full
                ? FULL_TEXT
                : request.ok
                  ? null
                  : "Say what the meeting is for and how many minutes it has first."
            }
            onResult={(data, meta) => {
              if (!request.ok) return;
              onRequest(request.values.goal, request.values.minutes);
              setSuggested((cur) => ({
                title: data.title,
                items: fitToTotal(data.segments, request.values.minutes),
                source: meta.source,
                round: (cur?.round ?? 0) + 1,
              }));
            }}
          />
        </div>

        {suggested && full && (
          <p ref={fullRef} tabIndex={-1} className="text-sm text-sub focus:outline-none">
            The draft is full: it holds up to {DRAFT_MAX_SEGMENTS} segments. Remove one to add the
            rest of the suggestions.
          </p>
        )}
        {suggested && (
          // The whole list each time, so it keeps track of what was added
          // itself. Hidden (not closed) while the draft is full, so what is
          // left comes back as it was once there is room.
          <div className={full ? "hidden" : undefined}>
            <AiSuggestions
              key={suggested.round}
              items={suggested.items}
              title={`Suggested: ${suggested.title}`}
              source={suggested.source}
              acceptLabel="Add"
              render={(s) => ({
                title: `${s.label} · ${minutesText(s.minutes)}`,
                detail: s.hint || undefined,
              })}
              onAccept={(s) => addOne(s)}
              onAcceptAll={addAll}
              onDismiss={() => {
                focusNext.current = "ask";
                setSuggested(null);
              }}
            />
          </div>
        )}

        {agenda.segments.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-text">
              Your draft: {minutesText(total)}
              {agenda.minutes && agenda.minutes !== total ? ` of ${agenda.minutes} planned` : ""}
            </h3>
            {nameForm.errors.total && (
              <p className="text-xs text-danger" role="alert">
                {nameForm.errors.total}
              </p>
            )}
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
                      onClick={() => move(s, "up")}
                      disabled={i === 0}
                      data-draft={`${s.id}:up`}
                    />
                    <IconButton
                      label={`Move ${s.label} down`}
                      icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => move(s, "down")}
                      disabled={i === agenda.segments.length - 1}
                      data-draft={`${s.id}:down`}
                    />
                    <IconButton
                      label={`Remove ${s.label}`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => remove(s, i)}
                      className="text-sub hover:text-danger"
                      data-draft={`${s.id}:remove`}
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
