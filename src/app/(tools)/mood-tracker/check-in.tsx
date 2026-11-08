"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, UserPlus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { Validation } from "@/lib/utils/form";
import type { MoodEntry, TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/use-team-roster";
import {
  MOOD_NOTE_MAX,
  checkInFor,
  isMoodScore,
  moodDateProblem,
  type MoodScore,
} from "@/lib/team/mood";
import { DayField } from "../health-check/day-field";
import { FACES } from "./faces";
import { shortDay } from "./verdict";

export interface CheckInDraft {
  score: MoodScore | null;
  note: string;
}

/** A check-in needs a face; a note alone is kept as a draft, never saved with a stand-in mood. */
export function validateCheckIn(
  d: CheckInDraft
): Validation<{ score: MoodScore; note?: string }, keyof CheckInDraft> {
  if (!isMoodScore(d.score)) return { ok: false, errors: { score: "Pick a face." } };
  if (d.note.trim().length > MOOD_NOTE_MAX) {
    return { ok: false, errors: { note: `Keep it to ${MOOD_NOTE_MAX} characters.` } };
  }
  const note = d.note.trim();
  return { ok: true, values: { score: d.score, ...(note ? { note } : {}) } };
}

/** A new team member: a name not already on the roster. */
export function validateMember(
  roster: readonly TeamMember[],
  d: { name: string }
): Validation<{ name: string }, "name"> {
  const name = d.name.trim();
  if (!name) return { ok: false, errors: { name: "Enter a name." } };
  const existing = findRosterMember(roster, name);
  if (existing) return { ok: false, errors: { name: `${existing.name} is already on the team.` } };
  return { ok: true, values: { name } };
}

function MemberRow({
  member,
  day,
  entry,
  readOnly,
  takeFocus,
  onFocusTaken,
  onLog,
  onNote,
  onClear,
}: {
  member: TeamMember;
  day: string;
  entry: MoodEntry | undefined;
  readOnly: boolean;
  takeFocus: boolean;
  onFocusTaken: () => void;
  onLog: (score: MoodScore, note: string) => void;
  onNote: (note: string) => void;
  onClear: () => void;
}) {
  // A note-first placeholder from an older build has no mood yet.
  const real = entry && !entry.isPlaceholder ? entry : undefined;
  const [note, setNote] = useState(entry?.note ?? "");
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => setNote(entry?.note ?? ""), [entry?.note, day]);
  useEffect(() => {
    if (!takeFocus) return;
    groupRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    onFocusTaken();
  }, [takeFocus, onFocusTaken]);

  const typedOnly = !real && note.trim().length > 0;
  return (
    <li className="space-y-2 rounded-lg border border-border bg-bg p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-full text-sm text-text sm:w-40 sm:truncate">{member.name}</span>
        <div
          ref={groupRef}
          role="group"
          // Where the page puts focus after this person's check-in is cleared.
          data-focus-key={`faces:${member.id}`}
          aria-label={`Mood for ${member.name} on ${shortDay(day)}`}
          className="flex w-full flex-1 flex-wrap gap-1.5 sm:w-auto"
        >
          {FACES.map((f) => {
            const on = real?.score === f.score;
            return (
              <button
                key={f.score}
                type="button"
                disabled={readOnly}
                onClick={() => onLog(f.score, note)}
                aria-pressed={on}
                className={cn(
                  "min-w-[60px] pointer-coarse:min-h-11 flex-1 rounded-md border py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60",
                  on
                    ? cn("border-border", f.bg, f.text)
                    : "border-border text-sub hover:border-accent/40"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {entry && (
          <IconButton
            label={`Clear ${member.name}'s check-in for ${shortDay(day)}`}
            icon={<Eraser className="h-4 w-4" aria-hidden="true" />}
            disabled={readOnly}
            onClick={onClear}
          />
        )}
      </div>
      <Textarea
        value={note}
        maxLength={MOOD_NOTE_MAX}
        disabled={readOnly}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          // An existing check-in takes the note in place; without one it waits for a face.
          if (real && note.trim() !== (real.note ?? "")) onNote(note);
        }}
        placeholder="Note (optional)"
        rows={2}
        className="resize-none bg-surface text-xs"
        aria-label={`Note for ${member.name}`}
      />
      {typedOnly && (
        <p className="text-xs text-sub">
          Pick a face to save the note with {member.name}&apos;s mood.
        </p>
      )}
      {entry?.isPlaceholder && (
        <p className="text-xs text-sub">
          A note was saved without a mood. Pick a face, or clear it.
        </p>
      )}
    </li>
  );
}

export interface CheckInCardProps {
  members: readonly TeamMember[];
  entries: readonly MoodEntry[];
  day: string;
  today: string;
  readOnly: boolean;
  /** The member to focus after the heatmap picked a cell. */
  focusMemberId: string | null;
  onFocusTaken: () => void;
  onDay: (day: string) => void;
  onLog: (memberId: string, day: string, score: MoodScore, note: string) => void;
  onNote: (entry: MoodEntry, note: string) => void;
  onClear: (entry: MoodEntry, memberName: string) => void;
  onAddMember: (name: string) => void;
}

/**
 * Named check-ins for a day: each person (or the facilitator for them)
 * picks a face, with an optional note; a past day can be filled in, never
 * a future one. Picking a face saves; a note waits for one.
 */
export function CheckInCard({
  members,
  entries,
  day,
  today,
  readOnly,
  focusMemberId,
  onFocusTaken,
  onDay,
  onLog,
  onNote,
  onClear,
  onAddMember,
}: CheckInCardProps) {
  const memberForm = useItemForm<{ name: string }, { name: string }, "name">({
    initial: { name: "" },
    validate: (d) => validateMember(members, d),
    onSave: (v) => onAddMember(v.name),
  });
  return (
    <div className="space-y-4">
      <DayField
        label="Check-ins for"
        value={day}
        max={today}
        problem={(d) => moodDateProblem(d, today)}
        onChange={onDay}
        hint={
          day === today
            ? "Today. Pick an earlier day to fill in a missed one."
            : `Filling in ${shortDay(day)}.`
        }
        disabled={readOnly}
      />
      {members.length > 0 && (
        <ul className="space-y-2" aria-label={`Check-ins for ${shortDay(day)}`}>
          {members.map((m) => (
            <MemberRow
              key={`${m.id}:${day}`}
              member={m}
              day={day}
              entry={checkInFor(entries, m.id, day)}
              readOnly={readOnly}
              takeFocus={focusMemberId === m.id}
              onFocusTaken={onFocusTaken}
              onLog={(score, note) => onLog(m.id, day, score, note)}
              onNote={(note) => {
                const e = checkInFor(entries, m.id, day);
                if (e) onNote(e, note);
              }}
              onClear={() => {
                const e = checkInFor(entries, m.id, day);
                if (e) onClear(e, m.name);
              }}
            />
          ))}
        </ul>
      )}
      <fieldset disabled={readOnly}>
        <legend className="sr-only">Add someone to the team</legend>
        <ItemForm
          form={memberForm}
          submitLabel="Add to the team"
          submitIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
        >
          <Field
            label={members.length === 0 ? "Add your first team member" : "Add someone to the team"}
            error={memberForm.errors.name}
            hint="They join the team roster, which Standup, Kudos and the other team tools share."
          >
            {(props) => (
              <Input
                {...props}
                value={memberForm.draft.name}
                onChange={(e) => memberForm.update({ name: e.target.value })}
                className="max-w-xs"
              />
            )}
          </Field>
        </ItemForm>
      </fieldset>
    </div>
  );
}
