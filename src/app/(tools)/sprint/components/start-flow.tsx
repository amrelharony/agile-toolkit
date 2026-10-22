"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { CalendarRange, Eye, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { nameKey, useTeamRoster } from "@/lib/team/use-team-roster";
import type { CeremonyCadence } from "@/lib/sprints/cadence";
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

/** Names typed one by one; each becomes a team member every tool can use. */
function TeamQuickAdd() {
  const roster = useTeamRoster();
  const upsert = useWorkspaceStore((s) => s.upsertTeamMember);
  const remove = useWorkspaceStore((s) => s.removeTeamMember);
  const [name, setName] = useState("");
  const inputId = useId();

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (roster.some((m) => nameKey(m.name) === nameKey(trimmed))) {
      setName("");
      return;
    }
    upsert({ id: `member_${crypto.randomUUID()}`, name: trimmed });
    setName("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={inputId} className="sr-only">
          Team member name
        </label>
        <Input
          id={inputId}
          value={name}
          placeholder="Name, then Enter"
          className="max-w-xs"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </div>
      {roster.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Team members">
          {roster.map((m) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text"
            >
              {m.name}
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                className="rounded-full p-0.5 text-sub hover:text-text"
                onClick={() => remove(m.id)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
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
 * The first run: no sprint yet. Three short steps — the team, the sprint,
 * the ceremony times — plus an example to look around and the way to the
 * tool index.
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
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
      data-chrome="start-flow"
    >
      <div className="flex items-start gap-3">
        <CalendarRange className="mt-1 h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h2 id={headingId} className="font-display text-lg font-semibold text-text">
            Set up your sprint
          </h2>
          <p className="text-sm text-sub">
            Three short steps, then this page shows your sprint: goal, burndown, today&apos;s
            standup, blockers and the next ceremony.
          </p>
        </div>
      </div>

      <ol className="mt-5 space-y-5">
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
        <Button type="button" variant="outline" onClick={onExample}>
          <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
          See an example first
        </Button>
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
    </section>
  );
}
