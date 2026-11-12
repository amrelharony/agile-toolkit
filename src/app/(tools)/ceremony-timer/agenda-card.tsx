"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CopyPlus,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { formatClock } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import type { FormErrors, Validation } from "@/lib/utils/form";
import {
  AGENDA_NAME_MAX,
  MAX_SEGMENTS,
  SEGMENT_LABEL_MAX,
  agendaSeconds,
  durationText,
  newSegmentId,
  shortClock,
  type Agenda,
  type Segment,
} from "./agenda";
import {
  draftOf,
  validateAgenda,
  validateAgendaName,
  withAddedRow,
  withMovedRow,
  withRowMinutes,
  withTotal,
  withoutRow,
  type AgendaDraft,
} from "./agenda-form";
import type { RunView } from "./run";

/** What the card shows: the segments, the editor, or the "save as" form. */
type Mode = "list" | "edit" | "save-as";

export interface AgendaCardProps {
  agenda: Agenda;
  view: RunView;
  /**
   * Segments can be added, removed and moved: not once the meeting has
   * started, since the run keeps its record segment by segment.
   */
  canRestructure: boolean;
  /**
   * "Reset to defaults" has something to put back: a built-in agenda the
   * team edited (during a meeting, its names, lengths or turns).
   */
  canReset: boolean;
  /** Names a saved agenda can't take: every other agenda's. */
  takenNames: readonly string[];
  /** How many agendas the team has saved by name. */
  namedCount: number;
  /** The edited segments, and for a saved agenda its name. */
  onSave: (segments: Segment[], name?: string) => void;
  onResetDefaults: () => void;
  onRestore: () => void;
  /** Save the agenda as it is under a new name. */
  onSaveAs: (name: string) => void;
  /** Delete a saved agenda (it confirms, and offers Undo). */
  onDelete: () => void;
  onUndoDelete: () => void;
}

/**
 * The agenda's segments with the time each took so far, and the editor for
 * the team's own names, lengths, rounds of turns and segments. Edits to a
 * built-in agenda are saved for it only, and "Reset to defaults" puts the
 * cadence's back; "Save as new agenda" keeps a copy under a name, which can
 * be edited, renamed and deleted like any of the team's own.
 */
export function AgendaCard({
  agenda,
  view,
  canRestructure,
  canReset,
  takenNames,
  namedCount,
  onSave,
  onResetDefaults,
  onRestore,
  onSaveAs,
  onDelete,
  onUndoDelete,
}: AgendaCardProps) {
  // A Custom time-box has nothing to run until it has a length: open the
  // editor straight away rather than a Start that does nothing.
  const unset = agendaSeconds(agenda) <= 0;
  // The editor or the save-as form belongs to the agenda it was opened for:
  // picking another agenda goes back to its segments.
  const [mode, setMode] = useState<{ id: string; kind: Mode }>({ id: agenda.id, kind: "list" });
  const kind: Mode = mode.id === agenda.id ? mode.kind : "list";
  const open = kind === "edit" || (unset && kind !== "save-as");

  // Opening, saving, cancelling and resetting each remove the control that
  // had focus (Edit agenda, the editor's buttons, or Reset to defaults with
  // its dialog). Focus moves to the form's first field on opening and back
  // to Edit agenda after, rather than to the top of the page. A Custom
  // time-box opening its editor by itself leaves focus where it is.
  const editRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusNextRef = useRef<"editor" | "edit" | null>(null);
  useEffect(() => {
    const next = focusNextRef.current;
    if (next === "editor" && kind !== "list") {
      bodyRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else if (next === "edit" && !open && kind === "list") {
      editRef.current?.focus();
    } else return;
    focusNextRef.current = null;
  });
  const show = (next: Mode) => {
    focusNextRef.current = next === "list" ? "edit" : "editor";
    setMode({ id: agenda.id, kind: next });
  };

  return (
    <SectionCard
      title={agenda.saved ? agenda.label : `${agenda.label} agenda`}
      icon={ListChecks}
      titleSize="sm"
      actions={
        kind === "list" &&
        !open && (
          <>
            {canReset && !agenda.saved && (
              <ResetButton
                label="Reset to defaults"
                title={`Reset the ${agenda.label} agenda?`}
                description={
                  canRestructure
                    ? "Each segment's name, length and round of turns go back to the defaults for your sprint length, and any segments you added or removed come back as they were."
                    : "Each segment's name, length and round of turns go back to the defaults for your sprint length. The meeting keeps its segments in their order: Start over to bring back the built-in ones."
                }
                confirmLabel="Reset agenda"
                doneLabel={`Reset the ${agenda.label} agenda`}
                onReset={() => {
                  focusNextRef.current = "edit";
                  onResetDefaults();
                }}
                onUndo={onRestore}
              />
            )}
            {agenda.saved && (
              <ResetButton
                label="Delete agenda"
                title={`Delete “${agenda.label}”?`}
                description="It goes from your agendas. A meeting in progress on it is cleared."
                confirmLabel="Delete agenda"
                doneLabel={`Deleted “${agenda.label}”`}
                onReset={onDelete}
                onUndo={onUndoDelete}
              />
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => show("save-as")}>
              <CopyPlus className="h-4 w-4" aria-hidden="true" />
              Save as new agenda
            </Button>
            <Button
              ref={editRef}
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => show("edit")}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit agenda
            </Button>
          </>
        )
      }
    >
      <div ref={bodyRef}>
        {kind === "save-as" ? (
          <SaveAsForm
            agenda={agenda}
            takenNames={[agenda.label, ...takenNames]}
            namedCount={namedCount}
            onSave={(name) => {
              onSaveAs(name);
              show("list");
            }}
            onCancel={() => show("list")}
          />
        ) : open ? (
          <AgendaEditor
            // A fresh draft each time the editor opens, from the agenda as it is.
            key={agenda.id}
            agenda={agenda}
            canRestructure={canRestructure}
            takenNames={takenNames}
            onSave={(segments, name) => {
              onSave(segments, name);
              show("list");
            }}
            onCancel={unset ? undefined : () => show("list")}
          />
        ) : (
          <SegmentList agenda={agenda} view={view} />
        )}
      </div>
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
              <span className="flex flex-wrap items-center gap-x-2 break-words text-text">
                {segment.label}
                {segment.speakers && (
                  <span className="inline-flex items-center gap-1 text-xs text-sub">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    turns
                  </span>
                )}
              </span>
              {agenda.segments.length > 1 && segment.hint && (
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

/** The editor's whole check: the segments, and for a saved agenda its name. */
function validateEditor(
  draft: AgendaDraft,
  agenda: Agenda,
  takenNames: readonly string[]
): Validation<{ segments: Segment[]; name?: string }, string> {
  const segs = validateAgenda(draft, agenda);
  const named = draft.name === undefined ? null : validateAgendaName(draft.name, takenNames);
  const errors: FormErrors<string> = {
    ...(segs.ok ? {} : segs.errors),
    ...(named && !named.ok ? named.errors : {}),
  };
  if (!segs.ok || (named && !named.ok)) return { ok: false, errors };
  return {
    ok: true,
    values: { segments: segs.values, ...(named?.ok ? { name: named.values } : {}) },
  };
}

/** Draft-then-save: nothing changes until every segment has a name and a usable length. */
function AgendaEditor({
  agenda,
  canRestructure,
  takenNames,
  onSave,
  onCancel,
}: {
  agenda: Agenda;
  canRestructure: boolean;
  takenNames: readonly string[];
  onSave: (segments: Segment[], name?: string) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<AgendaDraft, { segments: Segment[]; name?: string }, string>({
    initial: () => draftOf(agenda),
    validate: (d) => validateEditor(d, agenda, takenNames),
    onSave: ({ segments, name }) => onSave(segments, name),
    resetOnSave: false,
  });
  const { draft, errors } = form;
  const multi = draft.rows.length > 1;
  const setDraft = (next: AgendaDraft) => form.update(next);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // After adding, removing or moving a segment, what to focus: a row's name,
  // Add segment, or the moved row's arrow.
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    focusRef.current = null;
    const list = listRef.current;
    if (target === "add") return addRef.current?.focus();
    if (target.startsWith("move:")) {
      // Moved to the top or bottom, that arrow is switched off: its other one.
      const [, id, dir] = target.split(":");
      const arrow = (d: string) =>
        list?.querySelector<HTMLButtonElement>(`[data-move="${id}:${d}"]`);
      const el = arrow(dir);
      return (el && !el.disabled ? el : arrow(dir === "up" ? "down" : "up"))?.focus();
    }
    // A row's first field is its name.
    list?.querySelector<HTMLInputElement>(`[data-row="${target}"] input`)?.focus();
  });
  const moveSegment = (id: string, dir: "up" | "down") => {
    focusRef.current = `move:${id}:${dir}`;
    setDraft(withMovedRow(draft, id, dir === "up" ? -1 : 1));
  };

  const addSegment = () => {
    const id = newSegmentId(draft.rows.map((r) => r.id));
    focusRef.current = id;
    setDraft(withAddedRow(draft, id));
  };
  const removeSegment = (id: string) => {
    const i = draft.rows.findIndex((r) => r.id === id);
    const next = withoutRow(draft, id);
    focusRef.current = next.rows[i]?.id ?? next.rows[i - 1]?.id ?? "add";
    setDraft(next);
  };

  return (
    <ItemForm form={form} submitLabel="Save agenda" onCancel={onCancel}>
      {draft.name !== undefined && (
        <Field label="Agenda name" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              value={draft.name}
              maxLength={AGENDA_NAME_MAX}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          )}
        </Field>
      )}
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
      <ol ref={listRef} className="flex flex-col gap-3" aria-label="Segments">
        {draft.rows.map((row, i) => (
          <li
            key={row.id}
            data-row={row.id}
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
                  maxLength={SEGMENT_LABEL_MAX}
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
            <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-sub">
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
              {canRestructure && multi && (
                <span className="flex items-center gap-1">
                  <IconButton
                    label={`Move segment ${i + 1} up`}
                    icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => moveSegment(row.id, "up")}
                    disabled={i === 0}
                    data-move={`${row.id}:up`}
                  />
                  <IconButton
                    label={`Move segment ${i + 1} down`}
                    icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => moveSegment(row.id, "down")}
                    disabled={i === draft.rows.length - 1}
                    data-move={`${row.id}:down`}
                  />
                  <IconButton
                    label={`Remove segment ${i + 1}`}
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => removeSegment(row.id)}
                    className="text-sub hover:text-danger"
                  />
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {canRestructure ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={addSegment}
            disabled={draft.rows.length >= MAX_SEGMENTS}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add segment
          </Button>
          {draft.rows.length >= MAX_SEGMENTS && (
            <span className="text-xs text-sub">An agenda holds up to {MAX_SEGMENTS} segments.</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-sub">
          Start over to add, remove or reorder segments: the meeting keeps its time per segment.
        </p>
      )}
    </ItemForm>
  );
}

/** A name for a copy of the agenda as it is now. */
function SaveAsForm({
  agenda,
  takenNames,
  namedCount,
  onSave,
  onCancel,
}: {
  agenda: Agenda;
  takenNames: readonly string[];
  namedCount: number;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<{ name: string }, string, "name">({
    initial: { name: "" },
    validate: (d) => validateAgendaName(d.name, takenNames, namedCount),
    onSave: (name) => onSave(name),
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Save as new agenda"
      submitIcon={<CopyPlus aria-hidden="true" />}
      onCancel={onCancel}
    >
      <p className="text-sm text-sub">
        Keeps a copy of the {agenda.saved ? `“${agenda.label}”` : agenda.label} agenda, its{" "}
        {agenda.segments.length === 1 ? "segment" : `${agenda.segments.length} segments`} and
        lengths as they are now, under your own name. It joins Your agendas.
      </p>
      <Field label="New agenda name" error={form.errors.name} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            maxLength={AGENDA_NAME_MAX}
            placeholder="Our retro"
            onChange={(e) => form.update({ name: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
