"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Plus, Sparkles, Trash2, Vote, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cheer } from "@/lib/celebrate/cheer";
import { TEAM_TIME_ACTIONS } from "@/lib/history/event-actions";
import { pollLinkHref } from "@/lib/quick-vote/link";
import { icsFile } from "@/lib/sprints/ics";
import {
  TEAM_TIME_ANSWERS,
  TEAM_TIME_MAX,
  TOOL_TEXT_MAX,
  type TeamTimeAnswer,
  type TeamTimePoll,
} from "@/lib/stores/workspace-types";
import { localDateTimeText, minutesText, slotLabel } from "@/lib/team-time/format";
import { inviteMarkdown, pollCalendarEntry } from "@/lib/team-time/invite";
import {
  chosenPoll,
  newPoll,
  reopenedPoll,
  sortedSlots,
  withAnswer,
  withSlot,
  withoutSlot,
} from "@/lib/team-time/model";
import { MINUTE_MS } from "@/lib/team-time/overlap";
import {
  ANSWER_LABEL,
  BURDEN_LABEL,
  QUICK_VOTE_SLOTS,
  answerNames,
  answerRowIndex,
  bestSlot,
  burden,
  fillFromHours,
  quickVoteLabels,
  rankSlots,
  tallies,
  type RankedSlot,
} from "@/lib/team-time/slots";
import { validatePoll, type PollField } from "@/lib/team-time/validate";
import { localClock, wallToUtc, zoneLabel } from "@/lib/team-time/zones";
import { exportToICS } from "@/lib/utils/export";
import type { FormErrors } from "@/lib/utils/form";
import { undoable } from "@/lib/utils/undoable";
import type { TeamTimeCtx } from "./context";
import { SELECT_CLASS } from "./fields";

/** How many ranked times "Suggest times" shows. */
const SUGGESTED = 8;

/** Where focus goes once no poll is left to delete: New poll. */
const NO_POLL_LEFT = "none";

/** The id of a poll time's Remove or Answers button, under the poll card's own id. */
const slotButtonId = (card: string, slotId: string, which: "remove" | "answers") =>
  `${card}-slot-${slotId}-${which}`;

/** A time typed on the display clock ("YYYY-MM-DD" and "HH:MM") as an ISO instant, or null. */
function typedStart(day: string, time: string, zone: string): string | null {
  return wallToUtc(day, time, zone)?.toISOString() ?? null;
}

/**
 * Find a time: a poll with its title, length and times (suggested from
 * everyone's hours, or typed on the display clock), then the facilitator
 * records who can make each one and chooses one. The chosen time goes to a
 * calendar file or an invite; a live vote goes through Quick Vote. After a
 * poll is deleted, focus goes to the next poll's Delete (the one before at
 * the end), or to New poll when none is left.
 */
export function PollTab({ ctx }: { ctx: TeamTimeCtx }) {
  const [creating, setCreating] = useState(false);
  const ids = useId();
  const deleteId = (id: string) => `${ids}-poll-${id}-delete`;
  const newPollRef = useRef<HTMLButtonElement>(null);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  // The deleted card's button is gone with it: keyboard focus would fall to the page.
  useEffect(() => {
    if (!focusAfter) return;
    const target =
      focusAfter === NO_POLL_LEFT ? newPollRef.current : document.getElementById(focusAfter);
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  // Called after the delete, with the list as it was drawn (the poll still in it).
  const removed = (id: string) => {
    const at = ctx.polls.findIndex((p) => p.id === id);
    const next = ctx.polls[at + 1] ?? ctx.polls[at - 1];
    setFocusAfter(next ? deleteId(next.id) : NO_POLL_LEFT);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-sub">
          Offer a few times, record who can make each, then choose one.
        </p>
        <Button
          ref={newPollRef}
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={creating}
          onClick={() => setCreating((c) => !c)}
        >
          <Plus aria-hidden="true" />
          New poll
        </Button>
      </div>
      {creating && <NewPoll ctx={ctx} onDone={() => setCreating(false)} />}
      {ctx.polls.length === 0 && !creating ? (
        <p className="text-sm text-sub">No polls yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Polls">
          {ctx.polls.map((p) => (
            <PollCard
              key={p.id}
              ctx={ctx}
              poll={p}
              deleteId={deleteId(p.id)}
              onRemoved={() => removed(p.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewPoll({ ctx, onDone }: { ctx: TeamTimeCtx; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [starts, setStarts] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<RankedSlot[] | null>(null);
  const [day, setDay] = useState(() => localClock(ctx.zone, ctx.now.getTime() + 86_400_000).day);
  const [time, setTime] = useState("14:00");
  const [errors, setErrors] = useState<FormErrors<PollField | "typed">>({});

  const toggle = (start: string, on: boolean) =>
    setStarts((list) =>
      on ? Array.from(new Set([...list, start])) : list.filter((s) => s !== start)
    );

  const suggest = () => {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 15 || n > 480) {
      setErrors({ minutes: "A meeting is 15 to 480 minutes, in whole minutes." });
      return;
    }
    setErrors({});
    setSuggested(rankSlots(ctx.people, { minutes: n, from: ctx.now, days: 7, limit: SUGGESTED }));
  };

  const addTyped = () => {
    const start = typedStart(day, time, ctx.zone);
    if (!start) {
      setErrors({ typed: "Enter a date and a time." });
      return;
    }
    if (Date.parse(start) <= Date.now()) {
      setErrors({ typed: "A new time has to be in the future." });
      return;
    }
    setErrors({});
    toggle(start, true);
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const checked = validatePoll({ title, minutes, starts }, { now: Date.now(), added: starts });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    const at = new Date().toISOString();
    const poll = newPoll(checked.values, ctx.newId("ttpoll"), () => ctx.newId("slot"), at);
    ctx.writer.put("polls", poll);
    ctx.record(TEAM_TIME_ACTIONS.POLL_CREATED, {
      pollId: poll.id,
      slots: poll.slots.length,
      minutes: poll.minutes,
    });
    ctx.announce(`Created the poll “${poll.title}” with ${poll.slots.length} times`);
    onDone();
  };

  return (
    <form
      onSubmit={create}
      noValidate
      aria-label="New poll"
      className="space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it's for" error={errors.title} required>
          {(control) => (
            <Input
              {...control}
              value={title}
              maxLength={TOOL_TEXT_MAX.short}
              placeholder="Sprint Review"
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Length in minutes" error={errors.minutes} hint="15 to 480">
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={15}
              max={480}
              step={15}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="space-y-2">
        <Button
          type="button"
          size="sm"
          variant="toolkit"
          onClick={suggest}
          disabled={ctx.people.length === 0}
        >
          <Wand2 aria-hidden="true" />
          Suggest times
        </Button>
        {ctx.people.length === 0 && (
          <p className="text-xs text-sub">Add people on the People tab to get suggestions.</p>
        )}
        {suggested && (
          <fieldset>
            <legend className="text-sm text-text">
              The next 7 days, fewest people outside their hours first ({zoneLabel(ctx.zone)})
            </legend>
            <ul className="mt-1 space-y-1">
              {suggested.map((s) => (
                <li key={s.start}>
                  <label className="flex items-start gap-2 text-sm text-text pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      checked={starts.includes(s.start)}
                      onChange={(e) => toggle(s.start, e.target.checked)}
                    />
                    <span>
                      {localDateTimeText(ctx.zone, Date.parse(s.start))}{" "}
                      <span className="text-sub">
                        (
                        {s.night + s.outside === 0
                          ? "in everyone's hours"
                          : `${s.outside} early or late, ${s.night} at night or a day off`}
                        )
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm text-text">Or add a time ({zoneLabel(ctx.zone)})</legend>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="Date" hideLabel>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            )}
          </Field>
          <Field label="Time" hideLabel>
            {(control) => (
              <Input
                {...control}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            )}
          </Field>
          <Button type="button" size="sm" variant="outline" onClick={addTyped}>
            Add time
          </Button>
        </div>
        {errors.typed && (
          <p className="text-xs text-danger" role="alert">
            {errors.typed}
          </p>
        )}
      </fieldset>
      {starts.length > 0 && (
        <ul aria-label="Times offered" className="flex flex-wrap gap-1">
          {[...starts].sort().map((s) => (
            <li key={s}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove ${localDateTimeText(ctx.zone, Date.parse(s))}`}
                onClick={() => toggle(s, false)}
              >
                {localDateTimeText(ctx.zone, Date.parse(s))}
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {errors.slots && (
        <p className="text-xs text-danger" role="alert">
          {errors.slots}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Create poll
          {starts.length > 0
            ? ` with ${starts.length} ${starts.length === 1 ? "time" : "times"}`
            : ""}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PollCard({
  ctx,
  poll,
  deleteId,
  onRemoved,
}: {
  ctx: TeamTimeCtx;
  poll: TeamTimePoll;
  /** Its Delete button's id, for the tab to move focus to after another poll goes. */
  deleteId: string;
  /** The poll is deleted: the tab moves focus on. */
  onRemoved: () => void;
}) {
  const headingId = useId();
  const [open, setOpen] = useState<string | null>(null);
  const [day, setDay] = useState(() => localClock(ctx.zone, ctx.now.getTime() + 86_400_000).day);
  const [time, setTime] = useState("14:00");
  const [addError, setAddError] = useState<string | null>(null);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const t = tallies(poll);
  const best = bestSlot(poll);
  const slots = sortedSlots(poll);
  const closed = poll.status === "closed";
  // After a time is removed, the next one's Remove (its Answers once one time is left).
  const [slotFocus, setSlotFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!slotFocus) return;
    const target =
      document.getElementById(slotButtonId(headingId, slotFocus, "remove")) ??
      document.getElementById(slotButtonId(headingId, slotFocus, "answers"));
    target?.focus();
    setSlotFocus(null);
  }, [slotFocus, headingId]);
  const chosen = poll.slots.find((s) => s.id === poll.chosenSlotId) ?? null;
  // Each person's answer row is under the roster's name today, or the name their row keeps.
  const names = answerNames(ctx.people, ctx.name);
  const rowOf = new Map(
    ctx.people.map((p) => [p.id, answerRowIndex(poll.answers, names.get(p.id) ?? [])])
  );
  const at = () => new Date().toISOString();
  const pickOf = (personId: string, slotId: string): TeamTimeAnswer | "" =>
    poll.answers[rowOf.get(personId) ?? -1]?.picks[slotId] ?? "";
  const theirs = new Set(rowOf.values());
  const outsiders = poll.answers.filter((_, i) => !theirs.has(i));

  const answer = (personId: string, slotId: string, value: TeamTimeAnswer | "") => {
    const [name = "", ...aliases] = names.get(personId) ?? [];
    const next = withAnswer(poll, name, slotId, value || null, at(), aliases);
    if (next === poll) return;
    ctx.writer.put("polls", next);
    ctx.record(TEAM_TIME_ACTIONS.POLL_ANSWERED, { pollId: poll.id, answers: next.answers.length });
  };

  const fill = () => {
    const prev = poll;
    const next = { ...poll, answers: fillFromHours(poll, ctx.people, names), updatedAt: at() };
    // A poll keeps up to 50 answers: say who couldn't be added.
    const leftOut = ctx.people.filter((p) => {
      const all = names.get(p.id) ?? [];
      return all.length > 0 && answerRowIndex(next.answers, all) < 0;
    }).length;
    const note =
      leftOut > 0
        ? `A poll keeps up to ${TEAM_TIME_MAX.answers} people's answers, so ${leftOut} ${leftOut === 1 ? "person wasn't" : "people weren't"} filled in.`
        : null;
    setFillNote(note);
    undoable({
      label: "Filled the answers from everyone's hours",
      apply: () => {
        ctx.writer.put("polls", next);
        ctx.record(TEAM_TIME_ACTIONS.POLL_ANSWERED, {
          pollId: poll.id,
          answers: next.answers.length,
        });
      },
      revert: () => {
        ctx.writer.put("polls", prev);
        setFillNote(null);
      },
    });
    ctx.announce(
      note
        ? `Filled the answers from everyone's hours. ${note}`
        : "Filled the answers from everyone's hours"
    );
  };

  const choose = (slotId: string) => {
    const prev = poll;
    const label = `Chose ${slotLabel(poll.slots.find((s) => s.id === slotId)?.start ?? "")} for ${poll.title}`;
    undoable({
      label,
      apply: () => {
        ctx.writer.put("polls", chosenPoll(poll, slotId, at()));
        ctx.record(TEAM_TIME_ACTIONS.SLOT_CHOSEN, { pollId: poll.id, slotId });
        if (!ctx.preview) cheer("team-time", "agreed");
      },
      revert: () => ctx.writer.put("polls", prev),
    });
    ctx.announce(label);
  };

  const remove = () => {
    const label = `Deleted the poll “${poll.title}”`;
    undoable({
      label,
      apply: () => {
        ctx.writer.remove("polls", poll.id);
        ctx.record(TEAM_TIME_ACTIONS.POLL_REMOVED, { pollId: poll.id });
      },
      revert: () => ctx.writer.put("polls", poll),
    });
    ctx.announce(label);
    onRemoved();
  };

  const removeSlot = (slotId: string) => {
    const prev = poll;
    const label = `Removed ${slotLabel(poll.slots.find((s) => s.id === slotId)?.start ?? "")} from the poll “${poll.title}”`;
    const i = slots.findIndex((s) => s.id === slotId);
    const next = slots[i + 1] ?? slots[i - 1];
    undoable({
      label,
      apply: () => ctx.writer.put("polls", withoutSlot(poll, slotId, at())),
      revert: () => ctx.writer.put("polls", prev),
    });
    ctx.announce(label);
    if (next) setSlotFocus(next.id);
  };

  const addSlot = () => {
    const start = typedStart(day, time, ctx.zone);
    if (!start) {
      setAddError("Enter a date and a time.");
      return;
    }
    const checked = validatePoll(
      {
        title: poll.title,
        minutes: poll.minutes,
        starts: [...poll.slots.map((s) => s.start), start],
      },
      { now: Date.now(), added: [start] }
    );
    if (!checked.ok) {
      setAddError(Object.values(checked.errors)[0] ?? "That time can't be added.");
      return;
    }
    setAddError(null);
    ctx.writer.put("polls", withSlot(poll, ctx.newId("slot"), start, at()));
  };

  const saveCalendar = () => {
    const entry = pollCalendarEntry(
      poll,
      ctx.people,
      ctx.name,
      typeof window === "undefined" ? "" : window.location.origin
    );
    if (!entry) return;
    exportToICS(icsFile([entry], new Date()), "team-time-meeting");
  };

  return (
    <li
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="break-words font-medium text-text">
            {poll.title}
          </h3>
          <p className="text-xs text-sub">
            {minutesText(poll.minutes)} · {closed ? "closed" : "open"} · {poll.answers.length}{" "}
            {poll.answers.length === 1 ? "person" : "people"} answered
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {!closed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={fill}
              disabled={ctx.people.length === 0}
            >
              <Sparkles aria-hidden="true" />
              Fill from hours
            </Button>
          )}
          {closed && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => ctx.writer.put("polls", reopenedPoll(poll, at()))}
            >
              Reopen
            </Button>
          )}
          <Button
            id={deleteId}
            type="button"
            size="sm"
            variant="danger-ghost"
            aria-label={`Delete the poll ${poll.title}`}
            onClick={remove}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {fillNote && (
        <p className="text-xs text-sub" role="status">
          {fillNote}
        </p>
      )}

      {chosen && (
        <div className="space-y-2 rounded-md border border-success bg-success/10 p-2" role="status">
          <p className="text-sm text-text">
            Chosen: <span className="font-medium">{slotLabel(chosen.start)}</span> (
            {localDateTimeText(ctx.zone, Date.parse(chosen.start))} {zoneLabel(ctx.zone)})
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={saveCalendar}>
              <CalendarPlus aria-hidden="true" />
              Add to calendar
            </Button>
            <CopyButton
              text={() => inviteMarkdown(poll, ctx.people, ctx.name)}
              label="Copy invite"
            />
          </div>
        </div>
      )}

      <ul className="space-y-2" aria-label={`Times for ${poll.title}`}>
        {slots.map((s) => {
          const start = Date.parse(s.start);
          const tally = t[s.id];
          const isBest = best === s.id && !closed;
          return (
            <li key={s.id} className="rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    {localDateTimeText(ctx.zone, start)}{" "}
                    <span className="text-xs font-normal text-sub">({slotLabel(s.start)})</span>
                    {isBest && <span className="ml-2 text-xs text-success">most can make it</span>}
                    {poll.chosenSlotId === s.id && (
                      <span className="ml-2 text-xs text-success">chosen</span>
                    )}
                  </p>
                  <p className="text-xs text-sub">
                    {tally.yes} yes · {tally.maybe} if needed · {tally.no} no
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    id={slotButtonId(headingId, s.id, "answers")}
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={open === s.id}
                    onClick={() => setOpen(open === s.id ? null : s.id)}
                  >
                    {open === s.id ? "Hide answers" : "Answers"}
                  </Button>
                  {!closed && (
                    <Button
                      type="button"
                      size="sm"
                      variant="toolkit"
                      aria-label={`Choose ${slotLabel(s.start)}`}
                      onClick={() => choose(s.id)}
                    >
                      <Check aria-hidden="true" />
                      Choose
                    </Button>
                  )}
                  {!closed && poll.slots.length > 1 && (
                    <Button
                      id={slotButtonId(headingId, s.id, "remove")}
                      type="button"
                      size="sm"
                      variant="danger-ghost"
                      aria-label={`Remove ${slotLabel(s.start)}`}
                      onClick={() => removeSlot(s.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              {open === s.id && (
                <ul className="mt-2 space-y-1" aria-label={`Who can make ${slotLabel(s.start)}`}>
                  {ctx.people.map((p) => {
                    const b = burden(p, start, start + poll.minutes * MINUTE_MS);
                    const label = `${ctx.name(p.id)}, ${slotLabel(s.start)}`;
                    return (
                      <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <span className="min-w-0 text-sm text-text">
                          {ctx.name(p.id)}{" "}
                          <span className="text-xs text-sub">
                            {localDateTimeText(p.timeZone, start)}, {BURDEN_LABEL[b]}
                          </span>
                        </span>
                        <select
                          aria-label={label}
                          className={`${SELECT_CLASS} w-32`}
                          value={pickOf(p.id, s.id)}
                          disabled={closed}
                          onChange={(e) =>
                            answer(p.id, s.id, e.target.value as TeamTimeAnswer | "")
                          }
                        >
                          <option value="">No answer</option>
                          {TEAM_TIME_ANSWERS.map((a) => (
                            <option key={a} value={a}>
                              {ANSWER_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </li>
                    );
                  })}
                  {outsiders.length > 0 && (
                    <li className="text-xs text-sub">
                      Also answered:{" "}
                      {outsiders
                        .map(
                          (a) =>
                            `${a.name} (${a.picks[s.id] ? ANSWER_LABEL[a.picks[s.id]] : "no answer"})`
                        )
                        .join(", ")}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {!closed && (
        <div className="space-y-2">
          {poll.slots.length < TEAM_TIME_MAX.slots && (
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label={`Another date (${zoneLabel(ctx.zone)})`} hideLabel>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                  />
                )}
              </Field>
              <Field label={`Another time (${zoneLabel(ctx.zone)})`} hideLabel>
                {(control) => (
                  <Input
                    {...control}
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                )}
              </Field>
              <Button type="button" size="sm" variant="outline" onClick={addSlot}>
                Add a time
              </Button>
            </div>
          )}
          {addError && (
            <p className="text-xs text-danger" role="alert">
              {addError}
            </p>
          )}
          <p className="text-sm">
            <Link
              href={pollLinkHref(poll.title, quickVoteLabels(poll))}
              className="inline-flex items-center gap-1 text-accent underline underline-offset-2"
            >
              <Vote className="h-4 w-4" aria-hidden="true" />
              Vote on it in Quick Vote
            </Link>{" "}
            <span className="text-xs text-sub">
              The first {Math.min(QUICK_VOTE_SLOTS, poll.slots.length)} times, in UTC; switch the
              poll to Multi there.
            </span>
          </p>
        </div>
      )}
    </li>
  );
}
