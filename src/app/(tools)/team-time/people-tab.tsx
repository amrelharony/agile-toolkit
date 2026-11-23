"use client";

import { useRef, useState } from "react";
import { Clock, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEAM_TIME_ACTIONS } from "@/lib/history/event-actions";
import type { TeamTimePerson } from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/names";
import { daysLabel, hoursText, localTimeText, placeLabel } from "@/lib/team-time/format";
import { editedPerson, newPerson, personRows, type PersonRow } from "@/lib/team-time/model";
import { burden } from "@/lib/team-time/slots";
import type { PersonValues } from "@/lib/team-time/validate";
import { offsetLabel, offsetMinutes } from "@/lib/team-time/zones";
import { undoable } from "@/lib/utils/undoable";
import type { TeamTimeCtx } from "./context";
import { PersonForm, blankDraft, draftOf } from "./person-form";

/** Who is being edited: a saved row, a roster member without one, or a new guest. */
type Editing =
  | { kind: "person"; id: string }
  | { kind: "member"; id: string }
  | { kind: "guest" }
  | null;

/**
 * People: every roster member (with "Set time zone" until they have a
 * row) and the guests, each with their zone, hours, days, office and their
 * local time now. One row per person; a delete has Undo.
 */
export function PeopleTab({ ctx }: { ctx: TeamTimeCtx }) {
  const [editing, setEditing] = useState<Editing>(null);
  const guestRef = useRef<HTMLButtonElement>(null);
  const rows = personRows(ctx.roster, ctx.people);
  const nowMs = ctx.now.getTime();

  const others = (id: string | null) => ctx.people.filter((p) => p.id !== id);

  const save = (prev: TeamTimePerson | null, values: PersonValues) => {
    const at = new Date().toISOString();
    const person = prev ? editedPerson(prev, values, at) : newPerson(values, ctx.newId("ttp"), at);
    ctx.writer.put("people", person);
    ctx.record(TEAM_TIME_ACTIONS.PERSON_SAVED, {
      personId: person.id,
      people: prev ? ctx.people.length : ctx.people.length + 1,
    });
    ctx.announce(`Saved ${values.name}: ${hoursText(values)} ${placeLabel(values)}`);
    setEditing(null);
  };

  const remove = (p: TeamTimePerson) => {
    const label = `Removed ${ctx.name(p.id)} from Team Time`;
    undoable({
      label,
      apply: () => {
        ctx.writer.remove("people", p.id);
        ctx.record(TEAM_TIME_ACTIONS.PERSON_REMOVED, { personId: p.id });
      },
      revert: () => ctx.writer.put("people", p),
    });
    ctx.announce(label);
    guestRef.current?.focus();
  };

  // The member the row is, or the one its name is: a row saved here links to the roster.
  const memberIdFor = (row: PersonRow | null) => (name: string) =>
    row?.member?.id ?? findRosterMember(ctx.roster, name)?.id;

  const formFor = (row: PersonRow | null) => {
    if (row?.person) {
      return (
        <PersonForm
          initial={draftOf(row.person)}
          others={others(row.person.id)}
          nameLocked={Boolean(row.member)}
          memberIdFor={memberIdFor(row)}
          submitLabel="Save"
          now={ctx.now}
          onSave={(v) => save(row.person, v)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const member = row?.member ?? null;
    return (
      <PersonForm
        initial={blankDraft(member ? { name: member.name, teamMemberId: member.id } : {})}
        others={others(null)}
        nameLocked={Boolean(member)}
        memberIdFor={memberIdFor(row)}
        submitLabel="Add"
        now={ctx.now}
        onSave={(v) => save(null, v)}
        onCancel={() => {
          setEditing(null);
          guestRef.current?.focus();
        }}
      />
    );
  };

  const isEditing = (row: PersonRow) =>
    editing !== null &&
    ((editing.kind === "person" && row.person?.id === editing.id) ||
      (editing.kind === "member" && !row.person && row.member?.id === editing.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-sub">
          Each person&apos;s zone and hours on their own clock. Nobody&apos;s zone is guessed.
        </p>
        <Button
          ref={guestRef}
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={editing?.kind === "guest"}
          onClick={() => setEditing(editing?.kind === "guest" ? null : { kind: "guest" })}
        >
          <UserPlus aria-hidden="true" />
          Add someone
        </Button>
      </div>
      {editing?.kind === "guest" && (
        <div className="rounded-lg border border-border bg-card p-3">{formFor(null)}</div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-sub">
          Nobody yet. Add the people on the Team page and they show here, or add someone above.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="People">
          {rows.map((row) => {
            const p = row.person;
            const key = p?.id ?? `member-${row.member?.id}`;
            const shown = p ? ctx.name(p.id) : (row.member?.name ?? "");
            const inHours = p ? burden(p, nowMs, nowMs + 60_000) === 0 : false;
            return (
              <li key={key} className="rounded-lg border border-border bg-card p-3">
                {isEditing(row) ? (
                  formFor(row)
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="break-words font-medium text-text">
                        {shown}
                        {!row.member && <span className="ml-2 text-xs text-sub">guest</span>}
                      </p>
                      {p ? (
                        <>
                          <p className="text-sm text-sub">
                            {placeLabel(p)} · {p.timeZone} (
                            {offsetLabel(offsetMinutes(p.timeZone, nowMs))})
                          </p>
                          <p className="text-sm text-text">
                            {hoursText(p)} their time · {daysLabel(p.workingDays)}
                            {p.officeDays?.length
                              ? ` · in the office ${daysLabel(p.officeDays)}`
                              : ""}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-sub">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            Now {localTimeText(p.timeZone, nowMs)},{" "}
                            {inHours ? "in hours" : "outside hours"}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-sub">No time zone yet.</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${shown}`}
                            onClick={() => setEditing({ kind: "person", id: p.id })}
                          >
                            <Pencil aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger-ghost"
                            aria-label={`Remove ${shown}`}
                            onClick={() => remove(p)}
                          >
                            <Trash2 aria-hidden="true" />
                            Remove
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="toolkit"
                          aria-label={`Set time zone for ${shown}`}
                          onClick={() => setEditing({ kind: "member", id: row.member!.id })}
                        >
                          Set time zone
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
