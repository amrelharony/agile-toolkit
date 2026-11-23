"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { DayPicker, ZonePicker } from "@/app/(tools)/team-time/fields";
import { plural } from "@/lib/charts/chart-text";
import {
  AI_USE_NEVER_IN,
  AI_USE_REVIEW,
  CHARTER_TEMPLATE_MAX,
  CORE_HOURS_PURPOSES,
  type AiUseNeverIn,
  type AiUseReview,
  type CharterTemplateId,
  type CoreHoursPurpose,
  type TeamTimePerson,
  type UrgencyLevel,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { daysLabel } from "@/lib/team-time/format";
import { zoneLabel } from "@/lib/team-time/zones";
import type { Validation } from "@/lib/utils/form";
import {
  NEVER_IN_LABEL,
  PURPOSE_LABEL,
  REVIEW_LABEL,
  appliedValues,
  coreHoursFor,
  coreHoursFromTeamTime,
  localCoreText,
  previewTemplate,
  templateName,
  validateTemplate,
  type AiUseValues,
  type CoreHoursValues,
  type FocusTimeValues,
  type SharedHoursFill,
  type TemplateErrors,
  type TemplateValuesById,
  type UrgencyLadderValues,
} from "@/lib/working-agreement/templates";
import { cn } from "@/lib/utils";

const M = CHARTER_TEMPLATE_MAX;

/** A Team Time person as the forms read them: the name the page shows. */
export type TemplatePerson = Pick<
  TeamTimePerson,
  "id" | "name" | "timeZone" | "start" | "end" | "workingDays" | "officeDays" | "site"
>;

/** What the forms know of Team Time: its people (examples left out), now, and this browser's zone. */
export interface TeamTimeView {
  people: readonly TemplatePerson[];
  now: Date;
  zone: string;
}

export interface TemplateFormProps<Id extends CharterTemplateId> {
  doc: WorkingAgreement;
  initial: TemplateValuesById[Id];
  teamTime: TeamTimeView;
  /** Core hours opened from a link: start filled from Team Time's shared hours. */
  fillOnOpen?: boolean;
  onApply: (values: TemplateValuesById[Id]) => void;
  onCancel: () => void;
}

/* ── Shared pieces ─────────────────────────────────────────────────── */

/** A fieldset's message, wired to it by id. */
function GroupError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-danger">
      {error}
    </p>
  );
}

/** A box of checkboxes, each a 44 px target on touch. */
function CheckList<T extends string>({
  legend,
  options,
  value,
  onChange,
  error,
  name,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  error?: string;
  name: string;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm text-text">{legend}</legend>
      <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {options.map((o) => (
          <label
            key={o.value}
            className="inline-flex items-center gap-2 text-sm text-text pointer-coarse:min-h-11"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={value.includes(o.value)}
              aria-invalid={error ? true : undefined}
              onChange={(e) =>
                onChange(
                  options
                    .map((x) => x.value)
                    .filter((v) => (v === o.value ? e.target.checked : value.includes(v)))
                )
              }
            />
            {o.label}
          </label>
        ))}
      </div>
      <GroupError id={errorId} error={error} />
    </fieldset>
  );
}

/** One choice of several, as radio buttons. */
function RadioList<T extends string>({
  legend,
  options,
  value,
  onChange,
  error,
  name,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (next: T) => void;
  error?: string;
  name: string;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm text-text">{legend}</legend>
      <div className="mt-1 flex flex-col gap-1">
        {options.map((o) => (
          <label
            key={o.value}
            className="inline-flex items-center gap-2 text-sm text-text pointer-coarse:min-h-11"
          >
            <input
              type="radio"
              name={name}
              className="h-4 w-4 accent-[var(--accent)]"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      <GroupError id={errorId} error={error} />
    </fieldset>
  );
}

const STATUS_CLASS = {
  New: "border-success/40 text-success",
  Changed: "border-warning/40 text-warning",
  "No change": "border-border text-sub",
  "Already in the charter": "border-danger/40 text-danger",
} as const;

/**
 * The rules the answers write, each marked New, Changed, No change or
 * Already in the charter (skipped), and the rules the template would take
 * out. Nothing is saved from here.
 */
function TemplatePreview<Id extends CharterTemplateId>({
  id,
  doc,
  check,
}: {
  id: Id;
  doc: WorkingAgreement;
  check: Validation<TemplateValuesById[Id]>;
}) {
  if (!check.ok) {
    return (
      <p className="text-xs text-sub" data-template-preview>
        Fill in the answers above to see the rules this writes.
      </p>
    );
  }
  const p = previewTemplate(doc, id, check.values);
  const own = new Map(
    doc.rules.filter((r) => r.template?.id === id).map((r) => [r.template?.slot ?? "", r])
  );
  const removed = doc.rules.filter((r) => p.removed.includes(r.id));
  const applied = Boolean(appliedValues(doc, id));
  return (
    <div className="space-y-2 rounded-md border border-border bg-bg p-3" data-template-preview>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-sub">Preview</h4>
      <ul className="space-y-2">
        {p.rules.map((r) => {
          const current = own.get(r.slot);
          const status: keyof typeof STATUS_CLASS = p.skipped.some((s) => s.slot === r.slot)
            ? "Already in the charter"
            : current
              ? p.updated.includes(current.id)
                ? "Changed"
                : "No change"
              : "New";
          return (
            <li key={r.slot} className="text-sm">
              <Badge variant="outline" className={cn("mr-2 text-xs", STATUS_CLASS[status])}>
                {status}
              </Badge>
              <span className="break-words text-text">{r.text}</span>
              {r.description && (
                <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-sub">
                  {r.description}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {removed.length > 0 && (
        <p className="text-xs text-sub">
          Comes out: {removed.map((r) => `“${r.text}”`).join("; ")}
        </p>
      )}
      {p.skipped.length > 0 && (
        <p className="text-xs text-sub">
          A rule already in the charter says the same, so that line is left out.
        </p>
      )}
      {applied && (
        <p className="text-xs text-sub">
          Consent stays as it is. Ask the team again if the change matters.
        </p>
      )}
    </div>
  );
}

/** "Add 2 rules" on a first apply; "Update 3 rules" once the template is in the charter. */
function applyLabel<Id extends CharterTemplateId>(
  id: Id,
  doc: WorkingAgreement,
  check: Validation<TemplateValuesById[Id]>
): string {
  const applied = Boolean(appliedValues(doc, id));
  if (!check.ok) return applied ? "Update rules" : "Add rules";
  const p = previewTemplate(doc, id, check.values);
  const n = applied ? p.rules.length - p.skipped.length : p.added.length;
  return `${applied ? "Update" : "Add"} ${plural(n, "rule")}`;
}

/** The form around one template: its fields, the live preview, Apply and Cancel. */
function TemplateFormShell<D extends object, Id extends CharterTemplateId>({
  id,
  doc,
  initial,
  toRaw,
  onApply,
  onCancel,
  children,
}: {
  id: Id;
  doc: WorkingAgreement;
  initial: D;
  toRaw: (d: D) => unknown;
  onApply: (values: TemplateValuesById[Id]) => void;
  onCancel: () => void;
  children: (form: {
    draft: D;
    update: (patch: Partial<D>) => void;
    errors: TemplateErrors;
  }) => ReactNode;
}) {
  const validate = (d: D) => validateTemplate(id, toRaw(d)) as Validation<TemplateValuesById[Id]>;
  const form = useItemForm<D, TemplateValuesById[Id], string>({
    initial,
    validate,
    onSave: (values) => onApply(values),
    resetOnSave: false,
  });
  const check = validate(form.draft);
  return (
    <ItemForm
      form={form}
      submitLabel={applyLabel(id, doc, check)}
      onCancel={onCancel}
      className="rounded-md border border-border bg-card p-3"
    >
      <h4 className="text-sm font-semibold text-text">{templateName(id)}</h4>
      {children({ draft: form.draft, update: form.update, errors: form.errors })}
      <TemplatePreview id={id} doc={doc} check={check} />
    </ItemForm>
  );
}

/* ── Urgency ladder ────────────────────────────────────────────────── */

let levelSeq = 0;
const newLevelId = () => `level-new-${Date.now().toString(36)}-${++levelSeq}`;

export function UrgencyLadderForm({
  doc,
  initial,
  onApply,
  onCancel,
}: TemplateFormProps<"urgency-ladder">) {
  return (
    <TemplateFormShell
      id="urgency-ladder"
      doc={doc}
      initial={initial}
      toRaw={(d: UrgencyLadderValues) => d}
      onApply={onApply}
      onCancel={onCancel}
    >
      {({ draft, update, errors }) => {
        const setLevel = (i: number, patch: Partial<UrgencyLevel>) =>
          update({ levels: draft.levels.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
        const move = (i: number, by: -1 | 1) => {
          const next = [...draft.levels];
          const [l] = next.splice(i, 1);
          next.splice(i + by, 0, l);
          update({ levels: next });
        };
        return (
          <>
            <p className="text-xs text-sub">
              Most urgent first. Each level says when to use it, where to send it and how fast a
              reply comes.
            </p>
            {errors.levels && (
              <p role="alert" className="text-xs text-danger">
                {errors.levels}
              </p>
            )}
            <ol className="space-y-3">
              {draft.levels.map((l, i) => (
                <li key={l.id} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <h5 id={`${l.id}-name`} className="flex-1 text-sm font-medium text-text">
                      Level {i + 1}
                    </h5>
                    <IconButton
                      label={`Move level ${i + 1} up`}
                      icon={<ArrowUp className="h-4 w-4" />}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    />
                    <IconButton
                      label={`Move level ${i + 1} down`}
                      icon={<ArrowDown className="h-4 w-4" />}
                      disabled={i === draft.levels.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <IconButton
                      label={`Remove level ${i + 1}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      disabled={draft.levels.length <= M.levelsMin}
                      onClick={() => update({ levels: draft.levels.filter((_, k) => k !== i) })}
                    />
                  </div>
                  <div
                    role="group"
                    aria-labelledby={`${l.id}-name`}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <Field label="Name" error={errors[`levels.${i}.label`]} required>
                      {(c) => (
                        <Input
                          {...c}
                          value={l.label}
                          maxLength={M.levelLabel}
                          onChange={(e) => setLevel(i, { label: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="Reply within" error={errors[`levels.${i}.replyWithin`]} required>
                      {(c) => (
                        <Input
                          {...c}
                          value={l.replyWithin}
                          maxLength={M.levelReplyWithin}
                          placeholder="Such as 1 working day"
                          onChange={(e) => setLevel(i, { replyWithin: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="When" error={errors[`levels.${i}.when`]} required>
                      {(c) => (
                        <Input
                          {...c}
                          value={l.when}
                          maxLength={M.levelWhen}
                          onChange={(e) => setLevel(i, { when: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="Where" error={errors[`levels.${i}.channel`]} required>
                      {(c) => (
                        <Input
                          {...c}
                          value={l.channel}
                          maxLength={M.levelChannel}
                          onChange={(e) => setLevel(i, { channel: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                </li>
              ))}
            </ol>
            {draft.levels.length < M.levels && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  update({
                    levels: [
                      ...draft.levels,
                      { id: newLevelId(), label: "", when: "", channel: "", replyWithin: "" },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add a level
              </Button>
            )}
            <label className="flex items-start gap-2 text-sm text-text pointer-coarse:min-h-11">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                checked={draft.afterHours}
                onChange={(e) => update({ afterHours: e.target.checked })}
              />
              <span>
                Add: outside someone&apos;s working hours, only{" "}
                {draft.levels[0]?.label.trim() || "the first level"} can&apos;t wait
              </span>
            </label>
          </>
        );
      }}
    </TemplateFormShell>
  );
}

/* ── Core hours ────────────────────────────────────────────────────── */

const PURPOSE_OPTIONS = CORE_HOURS_PURPOSES.map((p) => ({
  value: p,
  label: PURPOSE_LABEL[p].replace(/^./, (c) => c.toUpperCase()),
}));

/** What the shared-hours fill said, in a sentence. */
function fillNote(fill: SharedHoursFill): string {
  if (fill.kind === "no-people") return "";
  if (fill.kind === "none") return "Team Time found no hours that all but one share this week.";
  const when = `${fill.start}–${fill.end} ${zoneLabel(fill.timeZone)}, ${daysLabel(fill.days)}`;
  return fill.kind === "everyone"
    ? `Filled in from Team Time: everyone shares ${when}.`
    : `Filled in from Team Time: everyone but ${fill.leftOut ?? "one person"} shares ${when}.`;
}

/** The draft with Team Time's shared hours (and office days) filled in, when it has any. */
function withFill(d: CoreHoursValues, fill: SharedHoursFill): CoreHoursValues {
  if (fill.kind !== "everyone" && fill.kind !== "all-but-one") return d;
  const next: CoreHoursValues = {
    ...d,
    start: fill.start,
    end: fill.end,
    days: fill.days,
    timeZone: fill.timeZone,
  };
  if (fill.anchorDays.length > 0) next.anchorDays = fill.anchorDays;
  return next;
}

export function CoreHoursForm({
  doc,
  initial,
  teamTime,
  fillOnOpen,
  onApply,
  onCancel,
}: TemplateFormProps<"core-hours">) {
  const opened = useMemo(
    () =>
      fillOnOpen
        ? coreHoursFromTeamTime(teamTime.people, initial.timeZone || teamTime.zone, teamTime.now)
        : null,
    // Read once, when the form opens from a link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [note, setNote] = useState(() => (opened ? fillNote(opened) : ""));
  const start = useMemo(() => (opened ? withFill(initial, opened) : initial), [initial, opened]);
  const noPeople = teamTime.people.length === 0;
  return (
    <TemplateFormShell
      id="core-hours"
      doc={doc}
      initial={start}
      toRaw={(d: CoreHoursValues) => d}
      onApply={onApply}
      onCancel={onCancel}
    >
      {({ draft, update, errors }) => {
        const clocks = coreHoursFor(draft, teamTime.people, teamTime.now);
        const fill = () => {
          const found = coreHoursFromTeamTime(
            teamTime.people,
            draft.timeZone || teamTime.zone,
            teamTime.now
          );
          setNote(fillNote(found));
          const next = withFill(draft, found);
          if (next !== draft) update(next);
        };
        return (
          <>
            <p className="text-xs text-sub">
              The hours everyone is around. Outside them the team works in writing.
            </p>
            {noPeople ? (
              <p className="text-xs text-sub">
                Add your team&apos;s time zones in{" "}
                <Link href="/team-time" className="text-accent underline">
                  Team Time
                </Link>{" "}
                to fill these from the hours you share.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={fill}>
                  Use Team Time&apos;s shared hours
                </Button>
                {note && (
                  <span role="status" className="text-xs text-sub">
                    {note}
                  </span>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start" error={errors.start} required>
                {(c) => (
                  <Input
                    {...c}
                    type="time"
                    value={draft.start}
                    onChange={(e) => update({ start: e.target.value })}
                  />
                )}
              </Field>
              <Field label="End" error={errors.end} required>
                {(c) => (
                  <Input
                    {...c}
                    type="time"
                    value={draft.end}
                    onChange={(e) => update({ end: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Time zone"
              error={errors.timeZone}
              required
              hint="The clock the hours are on"
            >
              {(c) => (
                <ZonePicker
                  control={c}
                  value={draft.timeZone}
                  now={teamTime.now}
                  onChange={(zone) => update({ timeZone: zone })}
                />
              )}
            </Field>
            <DayPicker
              legend="Days"
              value={draft.days}
              error={errors.days}
              onChange={(days) => update({ days })}
            />
            <CheckList<CoreHoursPurpose>
              legend="Kept inside them"
              name="core-purposes"
              options={PURPOSE_OPTIONS}
              value={draft.purposes}
              error={errors.purposes}
              onChange={(purposes) => update({ purposes })}
            />
            {clocks.people.length > 0 && (
              <section aria-label="On each person's clock" className="space-y-1">
                <h5 className="text-xs font-semibold uppercase tracking-wider text-sub">
                  On each person&apos;s clock
                </h5>
                <ul className="space-y-0.5 text-sm">
                  {clocks.people.map((p) => (
                    <li
                      key={p.id}
                      className={cn("break-words", p.outside ? "text-warning" : "text-text")}
                    >
                      {p.name}: {localCoreText(p)} {zoneLabel(p.zone)}
                      {p.outside ? " (outside their hours)" : ""}
                    </li>
                  ))}
                </ul>
                {clocks.outside.length > 0 && (
                  <p role="status" className="text-xs text-warning">
                    These hours fall outside the working hours of {clocks.outside.join(", ")}.
                  </p>
                )}
                <p className="text-xs text-sub">
                  Shown live from Team Time and never saved: a clock change moves them.
                </p>
              </section>
            )}
            {(draft.anchorDays ?? []).length > 0 && (
              <fieldset
                className="space-y-2"
                aria-describedby={errors.anchorDays ? "core-anchor-days-error" : undefined}
              >
                <legend className="text-sm text-text">Office anchor days</legend>
                <GroupError id="core-anchor-days-error" error={errors.anchorDays} />
                {(draft.anchorDays ?? []).map((a, i) => (
                  <div
                    // Two offices can share a name until one is left out.
                    key={`${i}:${a.site}`}
                    className="space-y-1 rounded-md border border-border p-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 break-words text-sm font-medium text-text">
                        {a.site}
                      </span>
                      <IconButton
                        label={`Leave out ${a.site}`}
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => {
                          const rest = (draft.anchorDays ?? []).filter((_, k) => k !== i);
                          update({ anchorDays: rest.length > 0 ? rest : undefined });
                        }}
                      />
                    </div>
                    <GroupError
                      id={`core-anchor-${i}-site-error`}
                      error={errors[`anchorDays.${i}.site`]}
                    />
                    <DayPicker
                      legend={`${a.site}: in the office on`}
                      value={a.days}
                      error={errors[`anchorDays.${i}.days`]}
                      onChange={(days) =>
                        update({
                          anchorDays: (draft.anchorDays ?? []).map((x, k) =>
                            k === i ? { ...x, days } : x
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </fieldset>
            )}
          </>
        );
      }}
    </TemplateFormShell>
  );
}

/* ── Focus time ────────────────────────────────────────────────────── */

interface FocusDraft {
  days: number[];
  start: string;
  end: string;
  clock: "own" | "zone";
  timeZone: string;
  weeklyMinHours: string;
}

const focusDraft = (v: FocusTimeValues, zone: string): FocusDraft => ({
  days: v.days,
  start: v.start,
  end: v.end,
  clock: v.timeZone ? "zone" : "own",
  timeZone: v.timeZone ?? zone,
  weeklyMinHours: v.weeklyMinHours !== undefined ? String(v.weeklyMinHours) : "",
});

const focusRaw = (d: FocusDraft) => ({
  days: d.days,
  start: d.start,
  end: d.end,
  timeZone: d.clock === "own" ? null : d.timeZone,
  ...(d.weeklyMinHours.trim() ? { weeklyMinHours: d.weeklyMinHours.trim() } : {}),
});

export function FocusTimeForm({
  doc,
  initial,
  teamTime,
  onApply,
  onCancel,
}: TemplateFormProps<"focus-time">) {
  const start = useMemo(() => focusDraft(initial, teamTime.zone), [initial, teamTime.zone]);
  return (
    <TemplateFormShell
      id="focus-time"
      doc={doc}
      initial={start}
      toRaw={focusRaw}
      onApply={onApply}
      onCancel={onCancel}
    >
      {({ draft, update, errors }) => (
        <>
          <p className="text-xs text-sub">No meetings, and messages wait unless they are urgent.</p>
          <DayPicker
            legend="Days"
            value={draft.days}
            error={errors.days}
            onChange={(days) => update({ days })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start" error={errors.start} required>
              {(c) => (
                <Input
                  {...c}
                  type="time"
                  value={draft.start}
                  onChange={(e) => update({ start: e.target.value })}
                />
              )}
            </Field>
            <Field label="End" error={errors.end} required>
              {(c) => (
                <Input
                  {...c}
                  type="time"
                  value={draft.end}
                  onChange={(e) => update({ end: e.target.value })}
                />
              )}
            </Field>
          </div>
          <RadioList<"own" | "zone">
            legend="On whose clock"
            name="focus-clock"
            value={draft.clock}
            options={[
              { value: "own", label: "Each person's own clock" },
              { value: "zone", label: "One time zone for everyone" },
            ]}
            onChange={(clock) => update({ clock })}
          />
          {draft.clock === "zone" && (
            <Field label="Time zone" error={errors.timeZone} required>
              {(c) => (
                <ZonePicker
                  control={c}
                  value={draft.timeZone}
                  now={teamTime.now}
                  onChange={(zone) => update({ timeZone: zone })}
                />
              )}
            </Field>
          )}
          <Field
            label="Hours of focus a week, at least"
            error={errors.weeklyMinHours}
            hint={`Optional, ${M.weeklyMinHoursMin} to ${M.weeklyMinHours}`}
          >
            {(c) => (
              <Input
                {...c}
                type="number"
                inputMode="numeric"
                min={M.weeklyMinHoursMin}
                max={M.weeklyMinHours}
                value={draft.weeklyMinHours}
                onChange={(e) => update({ weeklyMinHours: e.target.value })}
                className="max-w-[8rem]"
              />
            )}
          </Field>
        </>
      )}
    </TemplateFormShell>
  );
}

/* ── AI use ────────────────────────────────────────────────────────── */

interface AiDraft {
  neverIn: AiUseNeverIn[];
  neverInOther: string;
  review: AiUseReview | "";
  customerFacing: boolean;
  tools: string;
  shareWhere: string;
}

const aiDraft = (v: AiUseValues): AiDraft => ({
  neverIn: v.neverIn,
  neverInOther: v.neverInOther ?? "",
  review: v.review,
  customerFacing: v.customerFacing,
  tools: v.tools.join("\n"),
  shareWhere: v.shareWhere ?? "",
});

const aiRaw = (d: AiDraft) => ({
  neverIn: d.neverIn,
  neverInOther: d.neverInOther,
  review: d.review,
  customerFacing: d.customerFacing,
  tools: d.tools.split(/\r?\n/),
  shareWhere: d.shareWhere,
});

const NEVER_IN_OPTIONS = AI_USE_NEVER_IN.map((k) => ({ value: k, label: NEVER_IN_LABEL[k] }));
const REVIEW_OPTIONS = AI_USE_REVIEW.map((k) => ({ value: k, label: REVIEW_LABEL[k] }));

export function AiUseForm({ doc, initial, onApply, onCancel }: TemplateFormProps<"ai-use">) {
  const start = useMemo(() => aiDraft(initial), [initial]);
  return (
    <TemplateFormShell
      id="ai-use"
      doc={doc}
      initial={start}
      toRaw={aiRaw}
      onApply={onApply}
      onCancel={onCancel}
    >
      {({ draft, update, errors }) => (
        <>
          <p className="text-xs text-sub">
            These rules sit under Work, marked AI use. The tools you use and where you share prompts
            are kept with the charter, not as rules.
          </p>
          <CheckList<AiUseNeverIn>
            legend="Never goes into an AI tool"
            name="ai-never-in"
            options={NEVER_IN_OPTIONS}
            value={draft.neverIn}
            error={errors.neverIn}
            onChange={(neverIn) => update({ neverIn })}
          />
          <Field label="Anything else that never goes in" error={errors.neverInOther}>
            {(c) => (
              <Input
                {...c}
                value={draft.neverInOther}
                maxLength={M.aiNote}
                onChange={(e) => update({ neverInOther: e.target.value })}
              />
            )}
          </Field>
          <RadioList<AiUseReview>
            legend="How AI-assisted work is reviewed"
            name="ai-review"
            options={REVIEW_OPTIONS}
            value={draft.review}
            error={errors.review}
            onChange={(review) => update({ review })}
          />
          <label className="flex items-start gap-2 text-sm text-text pointer-coarse:min-h-11">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              checked={draft.customerFacing}
              onChange={(e) => update({ customerFacing: e.target.checked })}
            />
            <span>Add: a person reads anything customer-facing before it goes out</span>
          </label>
          <Field
            label="Tools we use"
            error={errors.tools}
            hint={`One per line, up to ${M.aiTools}`}
          >
            {(c) => (
              <Textarea
                {...c}
                rows={3}
                value={draft.tools}
                onChange={(e) => update({ tools: e.target.value })}
              />
            )}
          </Field>
          <Field label="Where we share prompts" error={errors.shareWhere}>
            {(c) => (
              <Input
                {...c}
                value={draft.shareWhere}
                maxLength={M.aiNote}
                onChange={(e) => update({ shareWhere: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
    </TemplateFormShell>
  );
}

/** A form's fields that can take focus, in page order. */
const FIELD =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';

/**
 * Scrolls an opened form into view and puts focus on its first field that
 * can take it (the ladder's first "Move up" is disabled, and a disabled
 * button never takes focus), else its first button that can.
 */
export function useFocusOnOpen(ref: { current: HTMLElement | null }, key: string | null) {
  useEffect(() => {
    if (!key) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    const target =
      el.querySelector<HTMLElement>(FIELD) ??
      el.querySelector<HTMLElement>("button:not([disabled])");
    target?.focus();
  }, [key, ref]);
}
