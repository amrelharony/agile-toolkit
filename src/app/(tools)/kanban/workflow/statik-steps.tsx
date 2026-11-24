"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/icon-button";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  MEETING_CADENCES,
  WORKFLOW_DEFINITION_ID,
  type KanbanCadence,
  type StatikNotes,
} from "@/lib/stores/workspace-types";
import {
  CADENCE_LABEL,
  KANBAN_CADENCES_MAX,
  STATIK_NOTE_MAX,
  WORKFLOW_TEXT_MAX,
  deliveryToday,
  mergeWorkflow,
  type WorkflowBoard,
  BOARD_NAME,
} from "@/lib/kanban/workflow";
import { STATIK_CREDIT, STATIK_STEPS, statikProgress } from "@/lib/kanban/statik";
import type { FlowItem } from "@/lib/flow/types";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import { cn } from "@/lib/utils";
import { EMPTY_CADENCE, validateCadence, type CadenceDraft, type CadenceValues } from "./form";
import { NoteField, SELECT_CLASS, TextField } from "./fields";
import type { WorkflowController } from "./use-workflow";

/**
 * Design it (STATIK): seven guided steps, one on screen at a time, each
 * saved into the definition's notes, with "n of 7" progress. Step 3 shows
 * what the board already delivers; step 7 holds the team's Kanban
 * cadences (a list here only: they don't join the ceremony calendar).
 */
export function StatikSteps({
  controller,
  board,
  items,
  log,
}: {
  controller: WorkflowController;
  /** The board the steps read (the described one, else the one on screen). */
  board: WorkflowBoard;
  items: readonly FlowItem[];
  log: (action: string, payload: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const def = controller.def;
  const progress = statikProgress(def?.statik, def?.cadences);
  const firstOpen = progress.steps.findIndex((done) => !done);
  // The tab stays mounted from page load, so until the person picks, types
  // in or saves a step, it shows the first one not written yet (the
  // definition may arrive after the first render).
  const [picked, setPicked] = useState<number | null>(null);
  const at = picked ?? (firstOpen < 0 ? 0 : firstOpen);
  const go = (i: number) => setPicked(Math.max(0, Math.min(STATIK_STEPS.length - 1, i)));
  const [drafts, setDrafts] = useState<Partial<Record<keyof StatikNotes, string>>>({});
  const step = STATIK_STEPS[at];
  const valueOf = (key: keyof StatikNotes) => drafts[key] ?? def?.statik?.[key] ?? "";

  const saveStep = () => {
    setPicked(at);
    const notes: Partial<StatikNotes> = {};
    for (const f of step.fields) notes[f.key] = valueOf(f.key);
    const saved = controller.saveQuietly((cur) =>
      mergeWorkflow(cur ?? { id: WORKFLOW_DEFINITION_ID }, {
        board: cur?.board ?? board,
        statik: { ...(cur?.statik ?? {}), ...notes },
      })
    );
    setDrafts((d) => {
      const next = { ...d };
      for (const f of step.fields) delete next[f.key];
      return next;
    });
    if (!saved) {
      announce(`Nothing changed in step ${step.n}.`);
      return;
    }
    if (!controller.example) log(KANBAN_ACTIONS.STATIK_STEP_SAVED, { step: step.n });
    announce(`Saved step ${step.n}: ${step.title}.`);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-sub">
        <span className="font-medium text-text">
          {progress.done} of {progress.total}
        </span>{" "}
        steps written. Work through them together, then write the policies on the Definition tab.
      </p>
      <ol className="flex flex-wrap gap-1.5" aria-label="STATIK steps">
        {STATIK_STEPS.map((s, i) => (
          <li key={s.id}>
            <Button
              type="button"
              size="sm"
              variant={i === at ? "default" : "outline"}
              aria-current={i === at ? "step" : undefined}
              onClick={() => go(i)}
              className="min-touch-coarse h-8 gap-1 px-2.5 text-xs"
            >
              {progress.steps[i] && <Check aria-hidden="true" />}
              {s.n}
              <span className="sr-only">
                : {s.title}
                {progress.steps[i] ? " (written)" : ""}
              </span>
            </Button>
          </li>
        ))}
      </ol>

      <section aria-labelledby={`statik-${step.id}`} className="space-y-3">
        <h3 id={`statik-${step.id}`} className="text-sm font-semibold text-text">
          Step {step.n} of {progress.total}: {step.title}
        </h3>
        <p className="text-sm text-sub">{step.ask}</p>
        {step.id === "capability" && <Delivered board={board} items={items} />}
        {step.fields.map((f) => (
          <NoteField
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={valueOf(f.key)}
            max={STATIK_NOTE_MAX}
            onChange={(v) => {
              setPicked(at);
              setDrafts((d) => ({ ...d, [f.key]: v }));
            }}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={saveStep}>
            Save step {step.n}
          </Button>
          <Button type="button" variant="ghost" disabled={at === 0} onClick={() => go(at - 1)}>
            <ChevronLeft aria-hidden="true" />
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={at === STATIK_STEPS.length - 1}
            onClick={() => go(at + 1)}
          >
            Next step
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {step.id === "rollout" && <Cadences controller={controller} board={board} log={log} />}
      </section>
      <p className="text-xs text-sub">{STATIK_CREDIT}.</p>
    </div>
  );
}

/** Step 3: what the board already delivers, read live (never typed). */
function Delivered({ board, items }: { board: WorkflowBoard; items: readonly FlowItem[] }) {
  const d = deliveryToday(items);
  // The "From the …" line sits beside the list, not in it: a <dl> holds only dt/dd groups.
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
      <dl className="grid grid-cols-1 gap-2 xs:grid-cols-3">
        <div>
          <dt className="text-xs text-sub">Finished per week</dt>
          <dd className="font-data text-text">
            {d.perWeek === null ? "Not enough weeks yet" : `${d.perWeek} (last ${d.weeks} weeks)`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">85% finish within</dt>
          <dd className="font-data text-text">
            {d.p85 === null
              ? `Needs 5 finished items (${d.timed} so far)`
              : `${d.p85} ${d.p85 === 1 ? "day" : "days"}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">Items finished</dt>
          <dd className="font-data text-text">{d.finished}</dd>
        </div>
      </dl>
      <p className="text-xs text-sub">From the {BOARD_NAME[board]}.</p>
    </div>
  );
}

/** The team's Kanban cadences: add with a validated form, remove with Undo. */
function Cadences({
  controller,
  board,
  log,
}: {
  controller: WorkflowController;
  board: WorkflowBoard;
  log: (action: string, payload: Record<string, unknown>) => void;
}) {
  const announce = useAnnounce();
  const cadences = controller.def?.cadences ?? [];
  const full = cadences.length >= KANBAN_CADENCES_MAX;
  const form = useItemForm<CadenceDraft, CadenceValues, "name" | "minutes" | "purpose">({
    initial: EMPTY_CADENCE,
    validate: validateCadence,
    onSave: (values) => {
      const cadence: KanbanCadence = { id: `cadence-${nanoid(8)}`, ...values };
      const saved = controller.save(
        (cur) =>
          mergeWorkflow(cur ?? { id: WORKFLOW_DEFINITION_ID }, {
            board: cur?.board ?? board,
            cadences: [...(cur?.cadences ?? []), cadence],
          }),
        `Added “${values.name}”`
      );
      if (saved && !controller.example) {
        log(KANBAN_ACTIONS.STATIK_STEP_SAVED, {
          step: 7,
          part: "cadences",
          count: cadences.length + 1,
        });
      }
      announce(`Added the cadence “${values.name}”.`);
    },
  });

  const remove = (c: KanbanCadence) => {
    controller.save(
      (cur) =>
        cur
          ? mergeWorkflow(cur, { cadences: (cur.cadences ?? []).filter((x) => x.id !== c.id) })
          : null,
      `Removed “${c.name}”`
    );
    announce(`Removed the cadence “${c.name}”.`);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <h4 className="text-sm font-medium text-text">Kanban cadences</h4>
      {cadences.length === 0 ? (
        <p className="text-sm text-sub">
          No cadences yet. A weekly replenishment and a daily look at the board are a common start.
        </p>
      ) : (
        <ul className="space-y-2">
          {cadences.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">
                <span className="font-medium text-text">{c.name}</span>
                <span className="text-sub">
                  {" "}
                  · {CADENCE_LABEL[c.cadence]}
                  {c.minutes ? ` · ${c.minutes} min` : ""}
                  {c.purpose ? ` · ${c.purpose}` : ""}
                </span>
              </span>
              <IconButton
                label={`Remove ${c.name}`}
                icon={<Trash2 className="h-4 w-4" />}
                className="shrink-0 text-sub hover:text-danger"
                onClick={() => remove(c)}
              />
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-sm text-sub">
          That&apos;s {KANBAN_CADENCES_MAX} cadences, the most a workflow keeps. Remove one to add
          another.
        </p>
      ) : (
        <ItemForm
          form={form}
          submitLabel="Add cadence"
          submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        >
          <div className={cn("grid gap-3 sm:grid-cols-2")}>
            <TextField
              label="Meeting"
              placeholder="e.g. Replenishment"
              value={form.draft.name}
              max={WORKFLOW_TEXT_MAX}
              error={form.errors.name}
              onChange={(v) => form.update({ name: v })}
            />
            <Field label="How often">
              {(p) => (
                <select
                  {...p}
                  className={SELECT_CLASS}
                  value={form.draft.cadence}
                  onChange={(e) => form.update({ cadence: e.target.value })}
                >
                  {MEETING_CADENCES.map((m) => (
                    <option key={m} value={m}>
                      {CADENCE_LABEL[m]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Minutes" hint="Optional, 5 to 240." error={form.errors.minutes}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={240}
                  value={form.draft.minutes}
                  onChange={(e) => form.update({ minutes: e.target.value })}
                />
              )}
            </Field>
            <TextField
              label="What it is for"
              value={form.draft.purpose}
              max={WORKFLOW_TEXT_MAX}
              error={form.errors.purpose}
              onChange={(v) => form.update({ purpose: v })}
            />
          </div>
        </ItemForm>
      )}
    </div>
  );
}
