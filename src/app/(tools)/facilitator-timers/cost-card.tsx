"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Pause, Pencil, Play, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import {
  LIMITS,
  costElapsedMs,
  costPerMinute,
  formatMoney,
  meetingCost,
  personHours,
  personHoursText,
} from "@/lib/facilitator-timers/model";
import type { CostTicker } from "@/lib/facilitator-timers/store";
import { formatClock } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import { validateCost, type CostDraft, type CostValues } from "./forms";

/**
 * The presented amount: sized to the screen, so "EGP 12,345.67" (a code and
 * a number the browser joins with a no-break space) stays inside a phone's
 * width, and allowed to break as a last resort.
 */
const BIG_AMOUNT = "max-w-full break-words text-[clamp(1.75rem,8.5vw,4.5rem)]";

/**
 * The meeting cost ticker: people × a rough hourly rate × the time so far,
 * growing while the meeting runs. Nothing is filled in: no rate looks like
 * anyone's salary. The numbers stay in this browser tab only.
 */
export function CostCard({
  ticker,
  now,
  rosterCount,
  big,
  onStart,
  onPause,
  onResume,
  onReset,
  onUndoReset,
}: {
  ticker: CostTicker;
  now: number;
  /** People on the Team page, offered as the count. */
  rosterCount: number;
  big: boolean;
  /** Start (or, after a change, carry on) with these numbers. */
  onStart: (values: CostValues) => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onUndoReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attendees, hourlyRate, currency, clock } = ticker;
  const ready = attendees !== null && hourlyRate !== null && currency !== "";
  const running = Boolean(clock && clock.since !== null);
  const showForm = !ready || !clock || editing;
  const seconds = clock ? Math.floor(costElapsedMs(clock, now) / 1000) : 0;

  // Starting, saving, changing the numbers and resetting each swap the form
  // and the ticker, and focus would otherwise drop to the page: where it
  // goes next, once React has drawn the change.
  const bodyRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"ticker" | "change" | "form" | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    const el =
      target === "ticker"
        ? pauseRef.current
        : target === "change"
          ? changeRef.current
          : bodyRef.current?.querySelector<HTMLElement>("input");
    if (!el) return;
    focusNext.current = null;
    el.focus();
  });

  return (
    <SectionCard
      title="Meeting cost"
      icon={Wallet}
      titleSize="sm"
      actions={
        clock &&
        !editing && (
          <ResetButton
            label="Reset"
            title="Reset the cost ticker?"
            description="The time and the cost so far go back to zero. The numbers you entered stay."
            confirmLabel="Reset ticker"
            doneLabel="Reset the cost ticker"
            onReset={() => {
              focusNext.current = "form";
              onReset();
            }}
            onUndo={onUndoReset}
            variant="ghost"
            size="sm"
          />
        )
      }
    >
      <div ref={bodyRef}>
        {showForm ? (
          <CostForm
            ticker={ticker}
            rosterCount={rosterCount}
            resume={Boolean(clock)}
            onSave={(v) => {
              focusNext.current = "ticker";
              onStart(v);
              setEditing(false);
            }}
            onCancel={
              editing
                ? () => {
                    focusNext.current = "change";
                    setEditing(false);
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span
              role="timer"
              aria-label={`Meeting cost so far: ${formatMoney(meetingCost(attendees!, hourlyRate!, seconds), currency)}`}
              className={cn(
                "font-data font-bold tabular-nums text-text",
                big ? BIG_AMOUNT : "text-3xl sm:text-4xl"
              )}
            >
              {formatMoney(meetingCost(attendees!, hourlyRate!, seconds), currency)}
            </span>
            <p className="text-sm text-sub">
              {attendees} {attendees === 1 ? "person" : "people"} · {formatClock(seconds)} ·{" "}
              {formatMoney(costPerMinute(attendees!, hourlyRate!), currency)} a minute
            </p>
            <p className="text-xs text-sub">
              {personHoursText(personHours(attendees!, seconds))} so far.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                ref={pauseRef}
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={running ? onPause : onResume}
              >
                {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {running ? "Pause" : "Resume"}
              </Button>
              <Button
                ref={changeRef}
                type="button"
                variant="ghost"
                className="gap-1.5"
                onClick={() => {
                  if (running) onPause();
                  focusNext.current = "form";
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" />
                Change the numbers
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-sub">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        The rate stays in this browser tab: it isn&apos;t saved to your account, exported or sent
        anywhere. Keep it friendly: it helps the room decide, it isn&apos;t there to blame anyone.
      </p>
    </SectionCard>
  );
}

function CostForm({
  ticker,
  rosterCount,
  resume,
  onSave,
  onCancel,
}: {
  ticker: CostTicker;
  rosterCount: number;
  /** The ticker has run: saving carries on from its time. */
  resume: boolean;
  onSave: (v: CostValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<CostDraft, CostValues, keyof CostDraft>({
    initial: () => ({
      attendees: ticker.attendees === null ? "" : String(ticker.attendees),
      hourlyRate: ticker.hourlyRate === null ? "" : String(ticker.hourlyRate),
      currency: ticker.currency,
    }),
    validate: validateCost,
    onSave: (v) => onSave(v),
    resetOnSave: false,
  });
  return (
    <ItemForm
      form={form}
      submitLabel={resume ? "Save and carry on" : "Start the ticker"}
      submitIcon={<Play aria-hidden="true" />}
      onCancel={onCancel}
      footer={
        rosterCount > 0 && (
          <Button
            type="button"
            variant="toolkit"
            className="gap-1.5"
            onClick={() => form.update({ attendees: String(rosterCount) })}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Count the team ({rosterCount})
          </Button>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="People" error={form.errors.attendees} required>
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={LIMITS.attendees.min}
              max={LIMITS.attendees.max}
              step={1}
              value={form.draft.attendees}
              onChange={(e) => form.update({ attendees: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field
          label="Rough hourly rate"
          hint="An average per person, a round figure."
          error={form.errors.hourlyRate}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={form.draft.hourlyRate}
              onChange={(e) => form.update({ hourlyRate: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field label="Currency" hint="A code such as EUR." error={form.errors.currency} required>
          {(p) => (
            <Input
              {...p}
              value={form.draft.currency}
              maxLength={8}
              autoComplete="off"
              onChange={(e) => form.update({ currency: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
