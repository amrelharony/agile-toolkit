"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CalendarRange, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { useItemForm } from "@/components/shared/item-form";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember, useTeamRoster } from "@/lib/team/use-team-roster";
import type { CeremonyCadence } from "@/lib/sprints/cadence";
import { undoable } from "@/lib/utils/undoable";
import type { Validation } from "@/lib/utils/form";
import { CadenceForm } from "@/components/sprints/cadence-form";

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={
          done
            ? "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-xs font-semibold text-success"
            : "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-sub"
        }
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="text-sm font-semibold text-text">
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </h3>
        {children}
      </div>
    </li>
  );
}

/**
 * A name to add to the team: not blank, and not someone already on it
 * (trimmed, case-insensitive). A duplicate says so instead of vanishing.
 */
export function validateMemberName(
  raw: string,
  roster: readonly TeamMember[]
): Validation<{ name: string }, "name"> {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, errors: { name: "Type a name first." } };
  const existing = findRosterMember(roster, name);
  if (existing) return { ok: false, errors: { name: `${existing.name} is already on the team.` } };
  return { ok: true, values: { name } };
}

/**
 * Names typed one by one; each becomes a team member every tool can use.
 * Adding is the explicit click (or Enter). Removing takes them off the team
 * itself, so it says so, and Undo puts them back.
 */
function TeamQuickAdd() {
  const roster = useTeamRoster();
  const upsert = useWorkspaceStore((s) => s.upsertTeamMember);
  const removeMember = useWorkspaceStore((s) => s.removeTeamMember);

  const form = useItemForm<{ name: string }, { name: string }, "name">({
    initial: { name: "" },
    validate: (draft) => validateMemberName(draft.name, roster),
    onSave: ({ name }) => upsert({ id: `member_${crypto.randomUUID()}`, name }),
  });

  // The removed chip takes its focused button with it: once it's gone, focus
  // the next chip's button (the last one's when it was last), else the input.
  const listRef = useRef<HTMLUListElement>(null);
  const removed = useRef<{ id: string; index: number } | null>(null);
  const { formRef } = form;
  useEffect(() => {
    const gone = removed.current;
    if (!gone || roster.some((m) => m.id === gone.id)) return;
    removed.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    const next = buttons[Math.min(gone.index, buttons.length - 1)];
    if (next) next.focus();
    else formRef.current?.querySelector("input")?.focus();
  }, [roster, formRef]);

  const remove = (member: TeamMember, index: number) => {
    removed.current = { id: member.id, index };
    undoable({
      label: `Removed ${member.name} from the team`,
      description: "Standup, Capacity Planner, Mood Tracker and Kudos no longer list them.",
      apply: () => removeMember(member.id),
      // Same id, so mood entries and kudos that point at it link up again.
      revert: () => {
        const back = (useWorkspaceStore.getState().teamMembers ?? []).some(
          (m) => m.id === member.id
        );
        if (!back) upsert(member);
      },
    });
  };

  return (
    <div className="space-y-2">
      <form
        ref={form.formRef}
        onSubmit={form.submit}
        noValidate
        className="flex flex-wrap items-start gap-2"
      >
        <Field
          label="Team member name"
          hideLabel
          error={form.errors.name}
          className="w-full max-w-xs"
        >
          {(control) => (
            <Input
              {...control}
              value={form.draft.name}
              placeholder="Name, then Enter"
              onChange={(e) => form.update({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  form.submit();
                }
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="outline" size="sm" className="mt-0.5">
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add to the team
        </Button>
      </form>
      {roster.length > 0 && (
        <ul ref={listRef} className="flex flex-wrap gap-1.5" aria-label="Team members">
          {roster.map((m, i) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-0.5 text-xs text-text"
            >
              {m.name}
              <IconButton
                label={`Remove ${m.name} from the team`}
                icon={<X className="h-3 w-3" />}
                className="h-6 w-6 rounded-full text-sub hover:text-text"
                onClick={() => remove(m, i)}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-sub">
        Standup, Capacity Planner, Mood Tracker and Kudos use this list. You can skip it.
      </p>
    </div>
  );
}

/**
 * The first run: no sprint yet. An empty state with the example, then
 * three short steps (the team, the sprint, the ceremony times) and the way
 * to the tool index.
 */
export function StartFlow({
  onCreate,
  onExample,
  cadence,
  onCadence,
}: {
  onCreate: () => void;
  onExample: () => void;
  cadence: CeremonyCadence;
  onCadence: (patch: Partial<CeremonyCadence>) => void;
}) {
  const headingId = useId();
  const roster = useTeamRoster();
  const [timesOpen, setTimesOpen] = useState(false);
  const timesId = useId();

  return (
    <section aria-labelledby={headingId} className="space-y-4" data-chrome="start-flow">
      <EmptyState
        icon={CalendarRange}
        padding="md"
        action={<LoadExampleButton label="See an example first" onLoad={onExample} />}
      >
        <h2 id={headingId} className="font-display text-lg font-semibold text-text">
          Set up your sprint
        </h2>
        <p className="mx-auto mt-1 max-w-prose text-sm">
          No sprint yet. Three short steps, then this page shows your sprint: goal, burndown,
          today&apos;s standup, blockers and the next ceremony. Or look around an example first;
          nothing in it is saved.
        </p>
      </EmptyState>

      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <ol className="space-y-5">
          <Step n={1} title="Add your team" done={roster.length > 0}>
            <TeamQuickAdd />
          </Step>
          <Step n={2} title="Create the sprint">
            <p className="text-sm text-sub">
              A name, the first day and the length. Burndown, Velocity, Sprint Metrics and the
              forecasts all follow it.
            </p>
            <Button type="button" onClick={onCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Create the sprint
            </Button>
          </Step>
          <Step n={3} title="Set the ceremony times">
            <p className="text-sm text-sub">
              Daily at {cadence.dailyTime}, review at {cadence.reviewTime} and retro at{" "}
              {cadence.retroTime} on the last day. Change them now or later from the cockpit.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={timesOpen}
              aria-controls={timesOpen ? timesId : undefined}
              onClick={() => setTimesOpen((o) => !o)}
            >
              {timesOpen ? "Hide the times" : "Change the times"}
            </Button>
            {timesOpen && (
              <div id={timesId} className="pt-2">
                <CadenceForm cadence={cadence} onChange={onCadence} />
              </div>
            )}
          </Step>
        </ol>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Link href="/#all-tools" className="text-sm font-medium text-sub hover:text-accent">
            Just browse the tools
          </Link>
          <Link
            href="/team"
            className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-sub hover:text-accent"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Team page
          </Link>
        </div>
      </div>
    </section>
  );
}
