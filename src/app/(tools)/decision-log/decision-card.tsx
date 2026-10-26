"use client";

import { useId, useState } from "react";
import { nanoid } from "nanoid";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  History,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { ExportButton } from "@/components/shared/export-button";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { SourceLink } from "@/components/handoff/source-link";
import { PeoplePicker } from "@/components/team/person-picker";
import type {
  Decision,
  DecisionOption,
  DecisionRole,
  DecisionStatus,
  TeamMember,
} from "@/lib/stores/workspace-types";
import {
  decide,
  decisionIssues,
  decisionLabel,
  isDecided,
  optionsOf,
  reopen,
  roleHolders,
  supersede,
  templateOf,
  type DecideInput,
} from "@/lib/decisions/model";
import { DECISION_STATUS_LABEL, TEMPLATES } from "@/lib/decisions/templates";
import { isExampleId } from "@/lib/utils/example-id";
import { cn } from "@/lib/utils";
import { DecideForm } from "./decide-form";
import { decisionToMarkdown } from "./markdown";
import { PersonInPlace } from "./person-in-place";
import {
  DECISION_TEXT_MAX,
  DECISION_TITLE_MAX,
  implementedDayError,
  raisedDayError,
  recordName,
  replacementsFor,
  supersededRecords,
  decidedDayError,
} from "./view";

/** How a change reads in the toast, the history and the announcement. */
export interface ChangeHow {
  /** Past tense: "Decided ADR-0004", "Changed the Approver". */
  label: string;
  /** Offer Undo (status changes, removed options): edits typed in place don't need one. */
  undo?: boolean;
  /** The change accepted the record (history logs the milestone). */
  decided?: boolean;
}

const STATUS_TONE: Readonly<Record<DecisionStatus, string>> = {
  proposed: "border-info/40 text-info",
  accepted: "border-success/40 text-success",
  deprecated: "border-border text-sub",
  superseded: "border-border text-sub",
};

export function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <Badge variant="outline" className={cn("font-normal", STATUS_TONE[status] ?? "text-sub")}>
      {DECISION_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** A record's options, edited in place: text, remove (with Undo), add. */
function OptionsInPlace({
  decision: d,
  onSave,
}: {
  decision: Decision;
  onSave: (options: DecisionOption[], chosen: string | undefined, how: ChangeHow) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = optionsOf(d);
  const inputId = useId();

  const add = () => {
    const text = typed.trim();
    if (!text) {
      setError("Type the option first.");
      return;
    }
    if (text.length > DECISION_TEXT_MAX) {
      setError(`Keep the option to ${DECISION_TEXT_MAX} characters.`);
      return;
    }
    if (options.some((o) => o.text.toLowerCase() === text.toLowerCase())) {
      setError("That option is already listed.");
      return;
    }
    setError(null);
    setTyped("");
    onSave([...options, { id: `${d.id}-${nanoid(6)}`, text }], d.chosenOptionId, {
      label: `Added the option “${text}”`,
    });
  };

  return (
    <section aria-label="Options considered" className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-sub">Options considered</h4>
      {options.length === 0 ? (
        <p className="text-sm text-sub">None listed yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {options.map((o, i) => (
            <li key={o.id} className="flex min-w-0 items-center gap-2">
              <BlurInput
                aria-label={`Option ${i + 1}`}
                value={o.text}
                maxLength={DECISION_TEXT_MAX}
                className="h-9 min-w-0 flex-1"
                onCommit={(next) => {
                  const text = next.trim();
                  // An emptied option reverts: removing it is the button's job.
                  if (!text || text === o.text) return;
                  onSave(
                    options.map((x) => (x.id === o.id ? { ...x, text } : x)),
                    d.chosenOptionId,
                    { label: "Changed an option" }
                  );
                }}
              />
              {o.id === d.chosenOptionId && (
                <span className="shrink-0 text-xs font-medium text-success">Chosen</span>
              )}
              <IconButton
                label={`Remove the option “${o.text}”`}
                icon={<X className="h-4 w-4" />}
                onClick={() =>
                  onSave(
                    options.filter((x) => x.id !== o.id),
                    d.chosenOptionId === o.id ? undefined : d.chosenOptionId,
                    { label: `Removed the option “${o.text}”`, undo: true }
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex min-w-0 gap-2">
        <label htmlFor={inputId} className="sr-only">
          New option
        </label>
        <Input
          id={inputId}
          value={typed}
          maxLength={DECISION_TEXT_MAX}
          placeholder="Another option"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <Button type="button" variant="outline" className="shrink-0 gap-1" onClick={add}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** A long text field of the record, saved when it is left. */
function TextInPlace({
  label,
  hint,
  value,
  rows = 3,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string;
  rows?: number;
  onSave: (next: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <BlurTextarea
          id={props.id}
          rows={rows}
          maxLength={DECISION_TEXT_MAX}
          value={value}
          onCommit={(next) => {
            if (next.trim() !== value.trim()) onSave(next.trim());
          }}
        />
      )}
    </Field>
  );
}

export interface DecisionCardProps {
  decision: Decision;
  /** Every record, for the links between them. */
  all: readonly Decision[];
  today: string;
  roster: readonly TeamMember[];
  expanded: boolean;
  onToggle: () => void;
  /** Open and scroll to another record. */
  onJump: (id: string) => void;
  onChange: (prev: Decision, next: Decision, how: ChangeHow) => void;
  onDelete: (d: Decision) => void;
}

/**
 * One decision record. Collapsed, it reads as its number, form, status,
 * title and anything it still needs; expanded, every field is edited in
 * place, and its lifecycle moves (decide, reopen, carried out, deprecate,
 * supersede) each come with Undo.
 */
export function DecisionCard({
  decision: d,
  all,
  today,
  roster,
  expanded,
  onToggle,
  onJump,
  onChange,
  onDelete,
}: DecisionCardProps) {
  const bodyId = useId();
  const titleEdit = useInlineEdit();
  const [deciding, setDeciding] = useState(false);
  const [replacement, setReplacement] = useState("");
  const template = templateOf(d);
  const spec = TEMPLATES[template];
  const label = decisionLabel(d);
  const issues = decisionIssues(d, today);
  const example = isExampleId(d.id);
  const replaced = supersededRecords(all, d.id);
  const candidates = replacementsFor(all, d);
  const options = optionsOf(d);
  const save = (next: Decision, how: ChangeHow) => onChange(d, next, how);

  const setRole = (role: DecisionRole, names: string[], what: string) => {
    const roles = { ...(d.roles ?? {}) };
    if (names.length > 0) roles[role] = names;
    else delete roles[role];
    const next: Decision = { ...d, roles };
    if (Object.keys(roles).length === 0) delete next.roles;
    save(next, { label: what });
  };
  const setDecider = (name: string) => {
    const next: Decision = { ...d, decider: name };
    if (!name) delete next.decider;
    save(next, { label: `Changed the ${spec.deciderLabel}` });
  };
  const recordDecision = (input: DecideInput) => {
    setDeciding(false);
    save(decide(d, input), { label: `Decided ${label}`, undo: true, decided: true });
  };

  return (
    <li
      id={`decision-${d.id}`}
      className={cn(
        "scroll-mt-24 rounded-lg border bg-card",
        expanded ? "border-accent/40" : "border-border"
      )}
    >
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full min-w-0 items-start gap-2 rounded-lg p-3 text-left transition-colors hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronRight
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-sub transition-transform",
              expanded && "rotate-90"
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-mono text-sub">{label}</span>
              <Badge variant="outline" className="font-normal">
                {spec.label}
              </Badge>
              <StatusBadge status={d.status} />
              {issues.length > 0 && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {issues.length === 1 ? "1 thing to fix" : `${issues.length} things to fix`}
                </span>
              )}
            </span>
            <span className="mt-0.5 block break-words text-sm font-medium text-text">
              {d.title || "Untitled"}
            </span>
            <span className="block text-xs text-sub">
              Raised {d.date || "on an unknown day"}
              {d.decidedAt && isDecided(d.status) ? ` · decided ${d.decidedAt}` : ""}
              {d.implementedAt ? ` · carried out ${d.implementedAt}` : ""}
            </span>
          </span>
        </button>
      </h3>

      {expanded && (
        <div id={bodyId} className="space-y-4 border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <div className="min-w-0">
              <span className="text-xs text-sub">Title</span>
              {titleEdit.editing ? (
                <InlineItemEditor
                  label="Edit title"
                  title={d.title}
                  titleLabel="Decision title"
                  titleMaxLength={DECISION_TITLE_MAX}
                  onDone={(next, { refocus }) => {
                    titleEdit.stop({ refocus });
                    if (next) save({ ...d, title: next.title }, { label: "Renamed the decision" });
                  }}
                />
              ) : (
                <button
                  ref={titleEdit.triggerRef}
                  type="button"
                  onClick={titleEdit.start}
                  title="Click to edit"
                  className="block w-full cursor-text break-words rounded-sm text-left text-sm text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  {d.title || "Untitled"} <span className="sr-only">(edit the title)</span>
                </button>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-xs text-sub" aria-hidden="true">
                Raised on
              </span>
              <DayInput
                label={`Day ${label} was raised`}
                value={d.date}
                max={today}
                validate={(day) =>
                  raisedDayError(day, today) ??
                  (d.decidedAt && day > d.decidedAt
                    ? `It was decided on ${d.decidedAt}: pick that day or earlier.`
                    : null)
                }
                onCommit={(date) =>
                  save({ ...d, date }, { label: "Changed the day it was raised" })
                }
              />
            </div>
          </div>

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
              {issues.map((i) => (
                <li key={i.kind} className="flex items-start gap-2 text-sm text-text">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  {i.message}
                </li>
              ))}
            </ul>
          )}

          {(d.sourceRef || d.supersededBy || replaced.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <SourceLink sourceRef={d.sourceRef} />
              {d.supersededBy && (
                <button
                  type="button"
                  onClick={() => onJump(d.supersededBy!)}
                  className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                >
                  Superseded by {recordName(all, d.supersededBy)}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              {replaced.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => onJump(x.id)}
                  className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                >
                  <History className="h-3 w-3" aria-hidden="true" />
                  Supersedes {recordName(all, x.id)}
                </button>
              ))}
            </div>
          )}

          <TextInPlace
            label="Context"
            hint="The problem, and the constraints on it."
            value={d.context ?? ""}
            onSave={(context) => {
              const next: Decision = { ...d, context };
              if (!context) delete next.context;
              save(next, { label: "Changed the context" });
            }}
          />

          <OptionsInPlace
            decision={d}
            onSave={(opts, chosen, how) => {
              const next: Decision = { ...d, options: opts };
              if (chosen) next.chosenOptionId = chosen;
              else delete next.chosenOptionId;
              save(next, how);
            }}
          />

          {template !== "adr" && (
            <TextInPlace
              label="Recommendation"
              hint={
                template === "daci" ? "What the Driver proposes." : "What Recommend (R) proposes."
              }
              rows={2}
              value={d.recommendation ?? ""}
              onSave={(recommendation) => {
                const next: Decision = { ...d, recommendation };
                if (!recommendation) delete next.recommendation;
                save(next, { label: "Changed the recommendation" });
              }}
            />
          )}

          <section aria-label="People" className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-sub">People</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <PersonInPlace
                label={spec.deciderLabel}
                name={d.decider ?? ""}
                offerAddToRoster={!example}
                onSave={setDecider}
              />
              {spec.roles
                .filter((r) => r.single)
                .map((r) => (
                  <PersonInPlace
                    key={r.role}
                    label={r.label}
                    name={roleHolders(d, r.role)[0] ?? ""}
                    offerAddToRoster={!example}
                    onSave={(name) => setRole(r.role, name ? [name] : [], `Changed the ${r.label}`)}
                  />
                ))}
            </div>
            {spec.roles
              .filter((r) => !r.single)
              .map((r) => (
                <PeoplePicker
                  key={r.role}
                  label={r.label}
                  values={roleHolders(d, r.role)}
                  hint={r.hint}
                  offerAddToRoster={!example}
                  onChange={(names) => setRole(r.role, names, `Changed ${r.label}`)}
                />
              ))}
          </section>

          <section aria-label="Outcome" className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-sub">Outcome</h4>
            {d.status === "proposed" ? (
              deciding ? (
                <DecideForm
                  decision={d}
                  today={today}
                  roster={roster}
                  offerAddToRoster={!example}
                  onSave={recordDecision}
                  onCancel={() => setDeciding(false)}
                />
              ) : (
                <div className="space-y-2">
                  {d.decision.trim() ? (
                    <p className="whitespace-pre-wrap text-sm text-sub">
                      Last decided: {d.decision}
                    </p>
                  ) : (
                    <p className="text-sm text-sub">Not decided yet.</p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1"
                    onClick={() => setDeciding(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Record the decision
                  </Button>
                </div>
              )
            ) : (
              <>
                <TextInPlace
                  label="What was decided"
                  value={d.decision}
                  onSave={(decision) => save({ ...d, decision }, { label: "Changed the outcome" })}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  {options.length > 0 && (
                    <Field label="Option chosen">
                      {(props) => (
                        <select
                          {...props}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={d.chosenOptionId ?? ""}
                          onChange={(e) => {
                            const next: Decision = { ...d, options };
                            if (e.target.value) next.chosenOptionId = e.target.value;
                            else delete next.chosenOptionId;
                            save(next, { label: "Changed the option chosen" });
                          }}
                        >
                          <option value="">None of them</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.text}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                  <div className="min-w-0">
                    <span className="text-xs text-sub" aria-hidden="true">
                      Decided on
                    </span>
                    <DayInput
                      label={`Day ${label} was decided`}
                      value={d.decidedAt ?? ""}
                      max={today}
                      validate={(day) => decidedDayError(day, d.date, today)}
                      onCommit={(decidedAt) =>
                        save({ ...d, decidedAt }, { label: "Changed the day it was decided" })
                      }
                    />
                  </div>
                  {template !== "adr" && d.status === "accepted" && d.implementedAt && (
                    <div className="min-w-0">
                      <span className="text-xs text-sub" aria-hidden="true">
                        Carried out on
                      </span>
                      <DayInput
                        label={`Day ${label} was carried out`}
                        value={d.implementedAt}
                        max={today}
                        validate={(day) => implementedDayError(day, d, today)}
                        onCommit={(implementedAt) =>
                          save(
                            { ...d, implementedAt },
                            { label: "Changed the day it was carried out" }
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            <TextInPlace
              label="Consequences"
              hint="Trade-offs, follow-ups, what becomes easier or harder."
              value={d.consequences ?? ""}
              onSave={(consequences) => {
                const next: Decision = { ...d, consequences };
                if (!consequences) delete next.consequences;
                save(next, { label: "Changed the consequences" });
              }}
            />
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {d.status !== "proposed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => save(reopen(d, today), { label: `Reopened ${label}`, undo: true })}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reopen
              </Button>
            )}
            {template !== "adr" && d.status === "accepted" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (d.implementedAt) {
                    const next = { ...d };
                    delete next.implementedAt;
                    save(next, { label: `${label} not carried out yet`, undo: true });
                  } else {
                    save(
                      { ...d, implementedAt: today },
                      { label: `Marked ${label} carried out`, undo: true }
                    );
                  }
                }}
              >
                {d.implementedAt ? "Not carried out yet" : "Mark carried out"}
              </Button>
            )}
            {d.status === "accepted" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  save({ ...d, status: "deprecated" }, { label: `Deprecated ${label}`, undo: true })
                }
              >
                Deprecate
              </Button>
            )}
            {d.status !== "superseded" && candidates.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label htmlFor={`${bodyId}-sup`} className="sr-only">
                  The record that replaces {label}
                </label>
                <select
                  id={`${bodyId}-sup`}
                  className="flex h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                >
                  <option value="">Superseded by…</option>
                  {candidates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {recordName(all, x.id)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!replacement}
                  onClick={() => {
                    const next = supersede(d, replacement);
                    setReplacement("");
                    if (next) {
                      save(next, {
                        label: `${label} superseded by ${recordName(all, replacement).split(" · ")[0]}`,
                        undo: true,
                      });
                    }
                  }}
                >
                  Supersede
                </Button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              <ExportButton
                filename={label.toLowerCase()}
                markdown={decisionToMarkdown(d, all)}
                clipboardText={decisionToMarkdown(d, all)}
              />
              <IconButton
                label={`Delete ${label}: ${d.title || "Untitled"}`}
                icon={<Trash2 className="h-4 w-4" />}
                className="text-sub hover:text-danger"
                onClick={() => onDelete(d)}
              />
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
