"use client";

/**
 * One impediment: what it is, its severity, status, age and due date, who
 * raised and owns it, and what can happen next. Open ones escalate or
 * resolve, escalated ones resolve or step back to open, resolved ones
 * reopen. Resolving asks for the day (today unless changed). Edit opens
 * the same fields as the log form in place; delete offers Undo.
 */

import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { SourceLink } from "@/components/handoff/source-link";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import type { Impediment } from "@/lib/stores/workspace-types";
import {
  dayOf,
  daysOverdue,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  isResolved,
  type ImpedimentStatus,
} from "@/lib/impediments/model";
import { cn } from "@/lib/utils";
import {
  draftFrom,
  validateImpediment,
  validateResolvedDay,
  type ImpedimentDraft,
  type ImpedimentField,
  type ImpedimentValues,
} from "../form";
import { categoryLabel, dayLabel, titleOf } from "../helpers";
import { AgeBadge, DueBadge, SeverityBadge, StatusBadge } from "./badges";
import { ImpedimentFields } from "./impediment-fields";

/** The two severities that put the sprint at risk get a red edge (text says it too). */
const severityBorder = (s: string) =>
  s === "critical" ? "border-danger/60" : s === "high" ? "border-danger/30" : "border-border";

type Mode = "view" | "edit" | "resolve";

export interface ImpedimentCardProps {
  impediment: Impediment;
  today: string;
  typicalDays: number | null;
  onStatus: (i: Impediment, status: ImpedimentStatus, day: string) => void;
  onSave: (i: Impediment, values: ImpedimentValues) => void;
  onRemove: (i: Impediment) => void;
}

export function ImpedimentCard({
  impediment: i,
  today,
  typicalDays,
  onStatus,
  onSave,
  onRemove,
}: ImpedimentCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const titleId = useId();
  const editRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the editor or the resolve form closes.
  const returnTo = useRef<"edit" | "action" | null>(null);

  const status = impedimentStatus(i);
  const title = titleOf(i);
  const age = impedimentAgeDays(i, today);
  const due = impedimentDueDate(i);
  const late = daysOverdue(i, today);

  const switchMode = (next: Mode, focus: "edit" | "action" | null = null) => {
    returnTo.current = focus;
    setMode(next);
  };

  /** Escalate, step back or reopen at once; focus moves to the next action. */
  const move = (next: ImpedimentStatus) => {
    returnTo.current = "action";
    onStatus(i, next, today);
  };

  // The button that was pressed is gone once the status changes, so focus
  // would drop to the page; put it on this card's next action instead.
  useEffect(() => {
    if (mode !== "view" || !returnTo.current) return;
    (returnTo.current === "edit" ? editRef : actionRef).current?.focus();
    returnTo.current = null;
  }, [mode, status]);

  if (mode === "edit") {
    return (
      <ImpedimentEditor
        impediment={i}
        today={today}
        typicalDays={typicalDays}
        onSave={(values) => {
          onSave(i, values);
          switchMode("view", "edit");
        }}
        onCancel={() => switchMode("view", "edit")}
      />
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "space-y-3 rounded-lg border p-3 sm:p-4",
        status === "resolved" ? "bg-surface" : "bg-card",
        severityBorder(i.severity)
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="break-words text-sm font-medium text-text">
            {title}
          </h3>
          {i.description && (
            <p className="mt-0.5 whitespace-pre-line break-words text-xs text-sub">
              {i.description}
            </p>
          )}
          {/* Raised from another tool (a retro action, a standup blocker). */}
          <SourceLink sourceRef={i.sourceRef} className="mt-1" />
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton
            ref={editRef}
            label={`Edit ${title}`}
            icon={<Pencil className="h-4 w-4" />}
            className="text-sub hover:text-text"
            onClick={() => switchMode("edit")}
          />
          <IconButton
            label={`Delete ${title}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={() => onRemove(i)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={i.severity} />
        <StatusBadge status={status} />
        {i.category && (
          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-sub">
            {categoryLabel(i.category)}
          </span>
        )}
        {age !== null && <AgeBadge days={age} resolved={status === "resolved"} />}
        {due && status !== "resolved" && <DueBadge due={due} overdueBy={late} today={today} />}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-sub">
        <Meta term="Raised">
          {dayLabel(i.raisedAt)}
          {i.raisedBy && ` by ${i.raisedBy}`}
        </Meta>
        <Meta term="Owner">{i.owner || "Nobody yet"}</Meta>
        {i.escalatedAt && <Meta term="Escalated">{dayLabel(i.escalatedAt)}</Meta>}
        {i.resolvedAt && <Meta term="Resolved">{dayLabel(i.resolvedAt)}</Meta>}
      </dl>

      {mode === "resolve" ? (
        <ResolveForm
          impediment={i}
          today={today}
          onResolve={(day) => {
            onStatus(i, "resolved", day);
            switchMode("view", "action");
          }}
          onCancel={() => switchMode("view", "action")}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          {status !== "resolved" && (
            <StatusButton
              ref={actionRef}
              action="Resolve"
              title={title}
              icon={<CheckCircle2 aria-hidden="true" />}
              tone="success"
              onClick={() => switchMode("resolve")}
            />
          )}
          {status === "open" && (
            <StatusButton
              action="Escalate"
              title={title}
              icon={<ArrowUpCircle aria-hidden="true" />}
              tone="warning"
              onClick={() => move("escalated")}
            />
          )}
          {status === "escalated" && (
            <StatusButton
              action="De-escalate"
              title={title}
              icon={<ArrowDownCircle aria-hidden="true" />}
              onClick={() => move("open")}
            />
          )}
          {status === "resolved" && (
            <StatusButton
              ref={actionRef}
              action="Reopen"
              title={title}
              icon={<RotateCcw aria-hidden="true" />}
              onClick={() => move("open")}
            />
          )}
        </div>
      )}
    </article>
  );
}

function Meta({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt>{term}:</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

const TONE = {
  success: "text-success hover:bg-success/10 hover:text-success",
  warning: "text-warning hover:bg-warning/10 hover:text-warning",
  neutral: "text-sub hover:bg-accent/10 hover:text-text",
} as const;

/**
 * "Resolve", "Escalate"… on screen; "Resolve Build server down" to a
 * screen reader, so a list of cards isn't a list of identical buttons.
 * The visible verb starts the name, as WCAG 2.5.3 asks.
 */
const StatusButton = forwardRef<
  HTMLButtonElement,
  {
    action: string;
    title: string;
    icon: ReactNode;
    tone?: keyof typeof TONE;
    onClick: () => void;
  }
>(({ action, title, icon, tone = "neutral", onClick }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="sm"
    aria-label={`${action} ${title}`}
    onClick={onClick}
    className={cn("min-touch-coarse gap-1", TONE[tone])}
  >
    {icon}
    {action}
  </Button>
));
StatusButton.displayName = "StatusButton";

/** "Resolved on [today]": the day can be moved back to when it really went away. */
function ResolveForm({
  impediment,
  today,
  onResolve,
  onCancel,
}: {
  impediment: Impediment;
  today: string;
  onResolve: (day: string) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<{ resolvedAt: string }, string, "resolvedAt">({
    initial: { resolvedAt: today },
    validate: (d) => validateResolvedDay(d.resolvedAt, impediment.raisedAt, today),
    onSave: onResolve,
    resetOnSave: false,
  });
  const { draft, update, errors, formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm
      form={form}
      submitLabel="Mark resolved"
      submitIcon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="border-t border-border pt-3"
    >
      <Field label="Resolved on" error={errors.resolvedAt} required className="max-w-xs">
        {(props) => (
          <Input
            {...props}
            type="date"
            min={dayOf(impediment.raisedAt) ?? undefined}
            max={today}
            value={draft.resolvedAt}
            onChange={(e) => update({ resolvedAt: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}

/** Edit in place: the log form's fields with this impediment's values. Enter saves, Escape cancels. */
function ImpedimentEditor({
  impediment,
  today,
  typicalDays,
  onSave,
  onCancel,
}: {
  impediment: Impediment;
  today: string;
  typicalDays: number | null;
  onSave: (values: ImpedimentValues) => void;
  onCancel: () => void;
}) {
  const resolved = isResolved(impediment);
  const form = useItemForm<ImpedimentDraft, ImpedimentValues, ImpedimentField>({
    initial: () => draftFrom(impediment),
    validate: (d) => validateImpediment(d, today, { resolved }),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <div className="rounded-lg border border-accent/40 bg-card p-3 sm:p-4">
      <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
        <ImpedimentFields
          form={form}
          today={today}
          resolved={resolved}
          typicalDays={resolved ? null : typicalDays}
        />
      </ItemForm>
    </div>
  );
}
