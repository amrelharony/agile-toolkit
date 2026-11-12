"use client";

/**
 * Interrupt Buffer's pieces: the gauge, the buffer's form, the interrupt
 * form (with Ask Amr for its kind and size), the Emergency Procedure and the
 * sprint history.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Save } from "lucide-react";
import { AiButton } from "@/components/ai";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { INTERRUPT_KINDS, TOOL_TEXT_MAX, type Sprint } from "@/lib/stores/workspace-types";
import { interruptClassifyTask } from "@/lib/ai/tasks/interrupt-buffer";
import {
  BUFFER_PCT_MAX,
  EMERGENCY_STEPS,
  INTERRUPT_KIND_LABEL,
  INTERRUPT_SIZE_MAX,
  bufferDraftFor,
  pointsText,
  validateBufferDraft,
  validateInterruptDraft,
  type BufferDraft,
  type BufferHistoryRow,
  type InterruptBufferStatus,
  type InterruptDraft,
  type InterruptField,
  type InterruptValues,
} from "@/lib/sprints/interrupts";
import type { SprintInterruptBuffer } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import type { EmergencyRun } from "./store";

export const NATIVE_SELECT =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 text-base pointer-fine:md:text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const STATE_LABEL: Record<InterruptBufferStatus["state"], string> = {
  none: "No buffer to weigh against",
  ok: "Within the buffer",
  watch: "Nearly used up",
  over: "Over the buffer",
};

/** Buffer used against what it holds, as a bar; the overflow said in words. */
export function BufferGauge({ status }: { status: InterruptBufferStatus }) {
  const share = status.usedShare;
  const width = share === null ? 0 : Math.min(100, Math.round(share * 100));
  const tone =
    status.state === "over" ? "bg-danger" : status.state === "watch" ? "bg-warning" : "bg-accent";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text" data-field="buffer-state">
          {status.state === "over" && (
            <AlertTriangle className="mr-1 inline h-4 w-4 text-danger" aria-hidden="true" />
          )}
          {STATE_LABEL[status.state]}
        </p>
        {status.bufferPoints !== null && (
          <p className="font-data text-sm text-sub">
            {status.usedPoints} / {status.bufferPoints} pts
          </p>
        )}
      </div>
      {status.bufferPoints !== null && (
        <div
          role="progressbar"
          aria-label="Buffer used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={width}
          aria-valuetext={status.summary}
          className="h-3 w-full overflow-hidden rounded-full border border-border bg-surface"
        >
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
        </div>
      )}
      <p className="text-sm text-text" data-field="buffer-summary">
        {status.summary}
      </p>
      {status.total > 0 && (
        <p className="text-xs text-sub">
          {INTERRUPT_KINDS.filter((k) => status.byKind[k] > 0)
            .map((k) => `${INTERRUPT_KIND_LABEL[k]} ${status.byKind[k]}`)
            .join(" · ")}
          {status.emergencies > 0 &&
            ` · ${status.emergencies} ${status.emergencies === 1 ? "emergency" : "emergencies"}`}
        </p>
      )}
    </div>
  );
}

/** The sprint's buffer: a share of its planned points, or points. Blank clears it. */
export function BufferForm({
  sprint,
  suggested,
  onSave,
}: {
  sprint: Pick<Sprint, "id" | "name" | "interruptBuffer" | "pointsPlanned">;
  /** The average earlier sprints used, as a starting point. */
  suggested: number | null;
  onSave: (buffer: SprintInterruptBuffer | undefined) => void;
}) {
  const form = useItemForm<BufferDraft, SprintInterruptBuffer | undefined, "value">({
    initial: () => bufferDraftFor(sprint),
    validate: validateBufferDraft,
    onSave: (values) => onSave(values),
    resetOnSave: false,
  });
  const { reset } = form;
  // Another sprint, or a buffer set elsewhere: the form shows what is stored.
  const key = `${sprint.id}:${JSON.stringify(sprint.interruptBuffer ?? null)}`;
  useEffect(() => {
    reset(bufferDraftFor(sprint));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <ItemForm
      form={form}
      submitLabel="Save the buffer"
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,10rem)]">
        <Field label="Keep it as">
          {(control) => (
            <select
              {...control}
              className={NATIVE_SELECT}
              value={form.draft.mode}
              onChange={(e) => form.update({ mode: e.target.value as BufferDraft["mode"] })}
            >
              <option value="pct">A share of the sprint (%)</option>
              <option value="points">Points</option>
            </select>
          )}
        </Field>
        <Field
          label={form.draft.mode === "pct" ? "Share" : "Points"}
          hint={form.draft.mode === "pct" ? `1 to ${BUFFER_PCT_MAX}%` : "0 or more"}
          error={form.errors.value}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={form.draft.mode === "pct" ? BUFFER_PCT_MAX : undefined}
              step="any"
              value={form.draft.value}
              onChange={(e) => form.update({ value: e.target.value })}
            />
          )}
        </Field>
      </div>
      <p className="text-xs text-sub">
        {form.draft.mode === "pct"
          ? sprint.pointsPlanned > 0
            ? `A share of the ${sprint.pointsPlanned} points planned for ${sprint.name}.`
            : `${sprint.name} has no planned points yet: the share turns into points once it is planned.`
          : "Leave it empty to keep no buffer."}
        {suggested !== null &&
          ` The last finished sprints used ${pointsText(suggested)} of interrupts on average.`}
      </p>
    </ItemForm>
  );
}

/** A new interrupt, or a change to one, with Ask Amr for its kind and size. */
export function InterruptForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
  focusOnMount = false,
}: {
  initial: InterruptDraft;
  submitLabel: string;
  onSave: (values: InterruptValues) => void;
  onCancel?: () => void;
  focusOnMount?: boolean;
}) {
  const form = useItemForm<InterruptDraft, InterruptValues, InterruptField>({
    initial,
    validate: validateInterruptDraft,
    onSave,
  });
  const [note, setNote] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);
  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      onCancel={onCancel}
      footer={
        <AiButton
          task={interruptClassifyTask}
          label="Suggest the kind"
          fallbackLabel="Suggest the kind from the words"
          variant="outline"
          disabledReason={form.draft.title.trim() ? null : "Write what came in first."}
          input={() => ({ titles: [form.draft.title.trim().slice(0, 300)] })}
          onResult={(data, meta) => {
            const hit = data.items.find((i) => i.index === 0);
            if (!hit) {
              setNote("No suggestion for this one: pick the kind yourself.");
              return;
            }
            form.update({
              kind: hit.kind,
              ...(hit.size !== undefined && !form.draft.size.trim()
                ? { size: String(hit.size) }
                : {}),
            });
            setNote(
              `${meta.source === "ai" ? "Amr suggests" : "From the words"}: ${INTERRUPT_KIND_LABEL[hit.kind]}${
                hit.size !== undefined ? `, about ${pointsText(hit.size)}` : ""
              }. Change it if it's wrong.`
            );
          }}
        />
      }
    >
      <Field label="What came in" error={form.errors.title}>
        {(control) => (
          <Input
            {...control}
            ref={titleRef}
            maxLength={TOOL_TEXT_MAX.text}
            placeholder="e.g. Checkout fails for one bank"
            value={form.draft.title}
            onChange={(e) => form.update({ title: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)_auto] sm:items-end">
        <Field label="Kind">
          {(control) => (
            <select
              {...control}
              className={NATIVE_SELECT}
              value={form.draft.kind}
              onChange={(e) => form.update({ kind: e.target.value as InterruptDraft["kind"] })}
            >
              {INTERRUPT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INTERRUPT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Size in points" hint="If you know" error={form.errors.size}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={INTERRUPT_SIZE_MAX}
              step="any"
              value={form.draft.size}
              onChange={(e) => form.update({ size: e.target.value })}
            />
          )}
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={form.draft.emergency}
            onChange={(e) => form.update({ emergency: e.target.checked })}
            className="h-4 w-4 accent-accent"
          />
          It couldn&apos;t wait
        </label>
      </div>
      <p role="status" className={cn("text-xs text-sub", !note && "sr-only")}>
        {note}
      </p>
    </ItemForm>
  );
}

/** The steps to take once the buffer is spent, ticked off as the team takes them. */
export function EmergencyPanel({
  run,
  onStart,
  onToggle,
}: {
  run: EmergencyRun | undefined;
  onStart: () => void;
  onToggle: (stepId: string) => void;
}) {
  return (
    <section
      aria-label="Emergency Procedure"
      className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-3"
    >
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        The buffer is spent: Emergency Procedure
      </h3>
      {!run ? (
        <>
          <p className="text-sm text-text">
            Unplanned work now eats into the sprint goal. Take the steps below in order, with the
            Product Owner.
          </p>
          <Button type="button" size="sm" onClick={onStart}>
            Start the Emergency Procedure
          </Button>
        </>
      ) : (
        <p className="text-xs text-sub">
          Started {run.startedAt.slice(0, 10)}. {run.done.length} of {EMERGENCY_STEPS.length} steps
          done.
        </p>
      )}
      <ol className="space-y-2">
        {EMERGENCY_STEPS.map((step, i) => {
          const done = run?.done.includes(step.id) ?? false;
          const text = (
            <>
              <span className={cn("font-medium text-text", done && "line-through")}>
                {step.title}
              </span>
              {done && (
                <Check className="ml-1 inline h-3.5 w-3.5 text-success" aria-hidden="true" />
              )}
              <span className="block text-xs text-sub">{step.detail}</span>
            </>
          );
          return (
            <li key={step.id}>
              {run ? (
                <label className="flex min-h-11 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => onToggle(step.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0">{text}</span>
                </label>
              ) : (
                <div className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 w-4 shrink-0 text-right font-semibold text-sub">
                    {i + 1}.
                  </span>
                  <span className="min-w-0">{text}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Every sprint that kept a buffer or logged an interrupt. */
export function HistoryTable({ rows }: { rows: readonly BufferHistoryRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Interrupts by sprint</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-sub">
            <th scope="col" className="py-1 pr-2 font-medium">
              Sprint
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Buffer
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Used
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Interrupts
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sprint.id} className="border-b border-rule last:border-0">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-text">
                {r.sprint.name}
                {r.status.over && <span className="ml-1 text-xs text-danger">over</span>}
              </th>
              <td className="py-1.5 pr-2 text-right font-data text-text">
                {r.status.bufferPoints ?? "—"}
              </td>
              <td className="py-1.5 pr-2 text-right font-data text-text">{r.status.usedPoints}</td>
              <td className="py-1.5 text-right font-data text-text">{r.status.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
