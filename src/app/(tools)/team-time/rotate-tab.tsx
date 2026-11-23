"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Repeat, SkipForward, Trash2, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TEAM_TIME_ACTIONS } from "@/lib/history/event-actions";
import {
  CEREMONY_KINDS,
  CEREMONY_LABEL,
  WEEKDAY_LABEL,
  ceremonyTimeboxMinutes,
} from "@/lib/sprints/cadence";
import { TEAM_TIME_MAX, TOOL_TEXT_MAX, type TeamTimeRotation } from "@/lib/stores/workspace-types";
import { localDateTimeText, minutesText } from "@/lib/team-time/format";
import { rotationFrom, savedCadence, withHeld } from "@/lib/team-time/model";
import {
  ROTATION_PLAN_COUNT,
  burdenTotals,
  fairnessLine,
  nextOccurrences,
  rotationAttendees,
} from "@/lib/team-time/rotation";
import { BURDEN_LABEL } from "@/lib/team-time/slots";
import {
  validateRotation,
  type RotationField,
  type RotationOptionDraft,
} from "@/lib/team-time/validate";
import { localClock, zoneLabel } from "@/lib/team-time/zones";
import type { FormErrors } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import type { TeamTimeCtx } from "./context";
import { SELECT_CLASS, WEEK_ORDER, ZonePicker } from "./fields";

interface RotationDraftState {
  meeting: string;
  minutes: string;
  everyWeeks: number;
  startDate: string;
  mode: string;
  options: RotationOptionDraft[];
  /** Null: everyone. */
  attendees: string[] | null;
  meetingAuditId?: string;
}

function draftFor(ctx: TeamTimeCtx, r: TeamTimeRotation | null): RotationDraftState {
  if (r) {
    return {
      meeting: r.meeting,
      minutes: String(r.minutes),
      everyWeeks: r.everyWeeks,
      startDate: r.startDate,
      mode: r.mode,
      options: r.options.map((o) => ({
        id: o.id,
        label: o.label ?? "",
        weekday: o.weekday,
        time: o.time,
        timeZone: o.timeZone,
      })),
      attendees: r.attendees && r.attendees.length > 0 ? r.attendees : null,
      ...(r.meetingAuditId ? { meetingAuditId: r.meetingAuditId } : {}),
    };
  }
  const zones = Array.from(new Set(ctx.people.map((p) => p.timeZone)));
  return {
    meeting: "",
    minutes: "60",
    everyWeeks: 2,
    startDate: localClock(ctx.viewerZone, ctx.now).day,
    mode: "in-turn",
    options: [0, 1].map((i) => ({
      label: "",
      weekday: 2,
      time: i === 0 ? "09:00" : "16:00",
      timeZone: zones[i] ?? zones[0] ?? ctx.viewerZone,
    })),
    attendees: null,
  };
}

/** The rotation's schedule as Markdown, to paste. */
function scheduleText(ctx: TeamTimeCtx, r: TeamTimeRotation): string {
  const label = (id: string) => r.options.find((o) => o.id === id)?.label || "";
  return [
    `**${r.meeting}**`,
    "",
    ...nextOccurrences(r, ctx.people, ctx.now, ROTATION_PLAN_COUNT, { holidays: ctx.holidays }).map(
      (o) => {
        const outside = Object.entries(o.burdens)
          .filter(([, b]) => b > 0)
          .map(([id, b]) => `${ctx.name(id)} (${BURDEN_LABEL[b]})`);
        return `- ${localDateTimeText(ctx.zone, Date.parse(o.start))} ${zoneLabel(ctx.zone)}${label(o.optionId) ? `, ${label(o.optionId)}` : ""}${outside.length ? `: outside hours for ${outside.join(", ")}` : ""}`;
      }
    ),
  ].join("\n");
}

/**
 * Rotate: a meeting that moves between 2–4 times in turn or by who has had
 * it worst, its next 8 meetings with who they land outside hours for, each
 * attendee's late or night points and a fairness line; mark a meeting held
 * or skip it (a skip keeps the turn).
 */
export function RotateTab({ ctx }: { ctx: TeamTimeCtx }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-sub">
          A meeting that moves between times, so the same people don&apos;t always take the late
          call.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={editing === "new"}
          onClick={() => setEditing(editing === "new" ? null : "new")}
        >
          <Plus aria-hidden="true" />
          New rotation
        </Button>
      </div>
      {editing === "new" && (
        <RotationForm ctx={ctx} rotation={null} onDone={() => setEditing(null)} />
      )}
      {ctx.rotations.length === 0 && editing !== "new" ? (
        <p className="text-sm text-sub">No rotations yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Rotations">
          {ctx.rotations.map((r) =>
            editing === r.id ? (
              <li key={r.id}>
                <RotationForm ctx={ctx} rotation={r} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <RotationCard key={r.id} ctx={ctx} rotation={r} onEdit={() => setEditing(r.id)} />
            )
          )}
        </ul>
      )}
    </div>
  );
}

function RotationForm({
  ctx,
  rotation,
  onDone,
}: {
  ctx: TeamTimeCtx;
  rotation: TeamTimeRotation | null;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<RotationDraftState>(() => draftFor(ctx, rotation));
  const [errors, setErrors] = useState<FormErrors<RotationField>>({});
  const cadence = savedCadence(ctx.cadences);
  const picks = useMemo(
    () => [
      ...ctx.meetingAudits.map((m) => ({
        key: `audit:${m.id}`,
        name: m.meeting,
        minutes: m.minutes,
        auditId: m.id,
      })),
      ...(cadence
        ? CEREMONY_KINDS.map((k) => ({
            key: `ceremony:${k}`,
            name: CEREMONY_LABEL[k],
            minutes: ceremonyTimeboxMinutes(k, cadence.sprintLengthDays),
            auditId: undefined,
          }))
        : []),
    ],
    [ctx.meetingAudits, cadence]
  );
  const set = <K extends keyof RotationDraftState>(key: K, value: RotationDraftState[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setOption = (i: number, patch: Partial<RotationOptionDraft>) =>
    setDraft((d) => ({
      ...d,
      options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    }));
  const attending = (id: string) => draft.attendees === null || draft.attendees.includes(id);
  const toggleAttendee = (id: string, on: boolean) =>
    setDraft((d) => {
      const all = ctx.people.map((p) => p.id);
      const now = new Set(d.attendees ?? all);
      if (on) now.add(id);
      else now.delete(id);
      const list = all.filter((x) => now.has(x));
      return { ...d, attendees: list.length === all.length ? null : list };
    });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateRotation({
      meeting: draft.meeting,
      minutes: draft.minutes,
      everyWeeks: draft.everyWeeks,
      startDate: draft.startDate,
      mode: draft.mode,
      options: draft.options,
      ...(draft.attendees ? { attendees: draft.attendees } : {}),
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    const at = new Date().toISOString();
    const saved = rotationFrom(
      checked.values,
      rotation,
      rotation?.id ?? ctx.newId("ttrot"),
      () => ctx.newId("opt"),
      at
    );
    const next = draft.meetingAuditId ? { ...saved, meetingAuditId: draft.meetingAuditId } : saved;
    ctx.writer.put("rotations", next);
    ctx.record(TEAM_TIME_ACTIONS.ROTATION_SAVED, {
      rotationId: next.id,
      options: next.options.length,
      mode: next.mode,
    });
    ctx.announce(`Saved the rotation for ${next.meeting}`);
    onDone();
  };

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={rotation ? `Edit the rotation for ${rotation.meeting}` : "New rotation"}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Meeting" error={errors.meeting} required>
          {(control) => (
            <Input
              {...control}
              value={draft.meeting}
              maxLength={TOOL_TEXT_MAX.short}
              onChange={(e) => set("meeting", e.target.value)}
            />
          )}
        </Field>
        {picks.length > 0 && (
          <Field label="Or pick one" hint="From the Meeting Audit and your ceremonies">
            {(control) => (
              <select
                {...control}
                className={SELECT_CLASS}
                value=""
                onChange={(e) => {
                  const p = picks.find((x) => x.key === e.target.value);
                  if (!p) return;
                  setDraft((d) => ({
                    ...d,
                    meeting: p.name,
                    minutes: String(Math.min(480, Math.max(15, Math.round(p.minutes)))),
                    ...(p.auditId ? { meetingAuditId: p.auditId } : { meetingAuditId: undefined }),
                  }));
                }}
              >
                <option value="">Choose a meeting…</option>
                {picks.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({minutesText(p.minutes)})
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Length in minutes" error={errors.minutes} hint="15 to 480">
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={15}
              max={480}
              step={15}
              value={draft.minutes}
              onChange={(e) => set("minutes", e.target.value)}
            />
          )}
        </Field>
        <Field label="Meets every" error={errors.everyWeeks}>
          {(control) => (
            <select
              {...control}
              className={SELECT_CLASS}
              value={draft.everyWeeks}
              onChange={(e) => set("everyWeeks", Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "week" : `${n} weeks`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="First week"
          error={errors.startDate}
          hint="Each meeting falls on its time's weekday in its week"
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              value={draft.startDate}
              onChange={(e) => set("startDate", e.target.value)}
            />
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm text-text">How it moves</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {[
            ["in-turn", "In turn", "each time in order"],
            ["fairest", "Fairest", "the time that keeps the worst-off person's points lowest"],
          ].map(([value, label, hint]) => (
            <label
              key={value}
              className="inline-flex items-center gap-1.5 text-sm text-text pointer-coarse:min-h-11"
            >
              <input
                type="radio"
                name="tt-rotation-mode"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={draft.mode === value}
                onChange={() => set("mode", value)}
              />
              {label} <span className="text-xs text-sub">({hint})</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm text-text">
          Times it moves between (2 to {TEAM_TIME_MAX.options})
        </legend>
        {draft.options.map((o, i) => (
          <div
            key={o.id ?? `new-${i}`}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
          >
            <Field label={`Time ${i + 1}: label`} hint="Such as Europe morning">
              {(control) => (
                <Input
                  {...control}
                  value={o.label}
                  maxLength={TEAM_TIME_MAX.label}
                  onChange={(e) => setOption(i, { label: e.target.value })}
                />
              )}
            </Field>
            <Field label={`Time ${i + 1}: weekday`}>
              {(control) => (
                <select
                  {...control}
                  className={SELECT_CLASS}
                  value={o.weekday}
                  onChange={(e) => setOption(i, { weekday: Number(e.target.value) })}
                >
                  {WEEK_ORDER.map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_LABEL[d]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={`Time ${i + 1}: time`}>
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  value={o.time}
                  onChange={(e) => setOption(i, { time: e.target.value })}
                />
              )}
            </Field>
            <Field label={`Time ${i + 1}: on whose clock`}>
              {(control) => (
                <ZonePicker
                  control={control}
                  value={o.timeZone}
                  now={ctx.now}
                  onChange={(z) => setOption(i, { timeZone: z })}
                />
              )}
            </Field>
            {draft.options.length > 2 && (
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  size="sm"
                  variant="danger-ghost"
                  onClick={() =>
                    setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))
                  }
                >
                  <Trash2 aria-hidden="true" />
                  Remove time {i + 1}
                </Button>
              </div>
            )}
          </div>
        ))}
        {draft.options.length < TEAM_TIME_MAX.options && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                options: [
                  ...d.options,
                  {
                    label: "",
                    weekday: 2,
                    time: "12:00",
                    timeZone: d.options[0]?.timeZone ?? ctx.viewerZone,
                  },
                ],
              }))
            }
          >
            <Plus aria-hidden="true" />
            Add a time
          </Button>
        )}
        {errors.options && (
          <p className="text-xs text-danger" role="alert">
            {errors.options}
          </p>
        )}
      </fieldset>
      {ctx.people.length > 0 && (
        <fieldset>
          <legend className="text-sm text-text">Who attends</legend>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {ctx.people.map((p) => (
              <label
                key={p.id}
                className="inline-flex items-center gap-1.5 text-sm text-text pointer-coarse:min-h-11"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={attending(p.id)}
                  onChange={(e) => toggleAttendee(p.id, e.target.checked)}
                />
                {ctx.name(p.id)}
              </label>
            ))}
          </div>
          {errors.attendees && (
            <p className="mt-1 text-xs text-danger" role="alert">
              {errors.attendees}
            </p>
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {rotation ? "Save" : "Create rotation"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RotationCard({
  ctx,
  rotation: r,
  onEdit,
}: {
  ctx: TeamTimeCtx;
  rotation: TeamTimeRotation;
  onEdit: () => void;
}) {
  const headingId = useId();
  const plan = useMemo(
    () => nextOccurrences(r, ctx.people, ctx.now, ROTATION_PLAN_COUNT, { holidays: ctx.holidays }),
    [r, ctx.people, ctx.now, ctx.holidays]
  );
  const totals = useMemo(
    () => burdenTotals(r, ctx.people, ctx.now, ROTATION_PLAN_COUNT, { holidays: ctx.holidays }),
    [r, ctx.people, ctx.now, ctx.holidays]
  );
  const attendees = rotationAttendees(r, ctx.people);
  const optionLabel = (id: string) => {
    const o = r.options.find((x) => x.id === id);
    return o ? o.label || `${WEEKDAY_LABEL[o.weekday]} ${o.time} ${zoneLabel(o.timeZone)}` : "";
  };
  const first = plan[0];

  const mark = (skipped: boolean) => {
    if (!first) return;
    const prev = r;
    const label = `${skipped ? "Skipped" : "Marked held"}: ${r.meeting} on ${localDateTimeText(ctx.zone, Date.parse(first.start))}`;
    undoable({
      label,
      apply: () => {
        ctx.writer.put(
          "rotations",
          withHeld(
            r,
            { date: first.date, optionId: first.optionId },
            skipped,
            new Date().toISOString()
          )
        );
        if (skipped) ctx.record(TEAM_TIME_ACTIONS.OCCURRENCE_SKIPPED, { rotationId: r.id });
        else
          ctx.record(TEAM_TIME_ACTIONS.OCCURRENCE_HELD, {
            rotationId: r.id,
            optionId: first.optionId,
          });
      },
      revert: () => ctx.writer.put("rotations", prev),
    });
    ctx.announce(label);
  };

  const remove = () => {
    const label = `Deleted the rotation for ${r.meeting}`;
    undoable({
      label,
      apply: () => {
        ctx.writer.remove("rotations", r.id);
        ctx.record(TEAM_TIME_ACTIONS.ROTATION_REMOVED, { rotationId: r.id });
      },
      revert: () => ctx.writer.put("rotations", r),
    });
    ctx.announce(label);
  };

  return (
    <li
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={headingId}
            className="flex items-center gap-1.5 break-words font-medium text-text"
          >
            <Repeat className="h-4 w-4 text-sub" aria-hidden="true" />
            {r.meeting}
          </h3>
          <p className="text-xs text-sub">
            {minutesText(r.minutes)}, every {r.everyWeeks === 1 ? "week" : `${r.everyWeeks} weeks`},{" "}
            {r.mode === "fairest" ? "fairest" : "in turn"} · {attendees.length}{" "}
            {attendees.length === 1 ? "person" : "people"}
          </p>
          <p className="text-xs text-sub">
            {r.options
              .map(
                (o) =>
                  `${o.label ? `${o.label}: ` : ""}${WEEKDAY_LABEL[o.weekday]} ${o.time} ${zoneLabel(o.timeZone)}`
              )
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <CopyButton text={() => scheduleText(ctx, r)} label="Copy schedule" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Edit the rotation for ${r.meeting}`}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="danger-ghost"
            aria-label={`Delete the rotation for ${r.meeting}`}
            onClick={remove}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {plan.length === 0 ? (
        <p className="text-sm text-sub">No meetings ahead: check the times and the first week.</p>
      ) : (
        <ol className="space-y-1" aria-label={`The next meetings of ${r.meeting}`}>
          {plan.map((o, i) => {
            const outside = Object.entries(o.burdens).filter(([, b]) => b > 0);
            return (
              <li key={`${o.cycle}-${o.optionId}`} className="text-sm text-text">
                <span className="font-medium">
                  {localDateTimeText(ctx.zone, Date.parse(o.start))}
                </span>{" "}
                <span className="text-sub">{optionLabel(o.optionId)}</span>
                {outside.length > 0 ? (
                  <span className="text-xs text-sub">
                    {" "}
                    · outside hours for{" "}
                    {outside.map(([id, b]) => `${ctx.name(id)} (${BURDEN_LABEL[b]})`).join(", ")}
                  </span>
                ) : (
                  <span className="text-xs text-sub"> · in everyone&apos;s hours</span>
                )}
                {i === 0 && (
                  <span className="ml-2 inline-flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => mark(false)}>
                      <CheckCheck aria-hidden="true" />
                      Mark held
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => mark(true)}>
                      <SkipForward aria-hidden="true" />
                      Skip
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {totals.totals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-sub">
            Late or night points, held and planned (1 early or late, 2 at night or on a day off):{" "}
            {totals.totals.map((t) => `${ctx.name(t.personId)} ${t.points}`).join(", ")}
          </p>
          <p className="text-sm text-text" role="status">
            {fairnessLine(totals, ctx.name, ctx.place)}
          </p>
        </div>
      )}
      <p className="text-xs text-sub">
        Times on the {zoneLabel(ctx.zone)} clock. A meeting nobody skips counts as held a day after
        it starts.
      </p>
    </li>
  );
}
