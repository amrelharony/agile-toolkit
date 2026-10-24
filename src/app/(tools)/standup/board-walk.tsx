"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Hand, Mic, Pause, Play, SkipForward, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/shared/section-card";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { sprintHref, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { entryFor, previousEntry } from "@/lib/standup/entries";
import { useDockTimer } from "@/lib/timer/dock-timer";
import type { StandupEntry, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { EXAMPLE_SPRINT_NAME } from "./example";
import { personKey, shortDay } from "./model";
import { AwayButton, AwayList, TeamLink } from "./people";
import {
  autoTurnSeconds,
  nextSpeaker,
  pauseTurn,
  publishTurn,
  resumeTurn,
  skipSpeaker,
  startWalk,
  takeTurn,
  turnClock,
  turnRemaining,
  turnState,
  useStandupWalk,
  withDockState,
  type TurnState,
  type Walk,
} from "./walk";

const NO_STORIES: Story[] = [];

/** The board's columns as a person walks it; a backlog story in the sprint reads as to do. */
const COLUMNS: { label: string; statuses: readonly StoryStatus[] }[] = [
  { label: "To do", statuses: ["backlog", "todo"] },
  { label: "In progress", statuses: ["in_progress"] },
  { label: "Review", statuses: ["review"] },
  { label: "Done", statuses: ["done"] },
];

/** Fixed turn lengths besides "Auto" (the Daily Scrum shared out). */
const TURN_OPTIONS = [60, 90, 120, 180] as const;

/** One person's stories on the sprint the walk is over. */
interface PersonBoard {
  stories: Story[];
  sprintName: string;
  /** The sprint board, to move the cards after the standup. */
  href?: string;
}

const CHIP: Record<TurnState, { label: string; className: string }> = {
  speaking: { label: "Speaking", className: "border-accent/40 bg-accent/10 text-accent" },
  spoke: { label: "Spoke", className: "border-success/30 bg-success/10 text-success" },
  skipped: { label: "Skipped, not yet", className: "border-warning/30 bg-warning/10 text-warning" },
  waiting: { label: "Not yet", className: "border-border bg-card text-sub" },
};

function PersonBoardView({ name, board }: { name: string; board: PersonBoard | null }) {
  if (!board) {
    return (
      <p className="text-sm text-sub">
        No sprint to walk yet.{" "}
        <Link href="/sprint-planning" className="text-accent underline-offset-2 hover:underline">
          Plan a sprint
        </Link>{" "}
        and give its stories owners, and each person&apos;s cards show here.
      </p>
    );
  }
  const boardLink = board.href && (
    <Link href={board.href} className="text-accent underline-offset-2 hover:underline">
      Open the sprint board
    </Link>
  );
  if (board.stories.length === 0) {
    return (
      <p className="text-sm text-sub">
        No stories on {board.sprintName} have {name} as owner. {boardLink}
      </p>
    );
  }
  const blocked = board.stories.filter((s) => s.blocked && s.status !== "done").length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-sub">
        {name}&apos;s stories on {board.sprintName}
        {blocked > 0 && <span className="text-danger">, {blocked} blocked</span>}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = board.stories.filter((s) => col.statuses.includes(s.status));
          return (
            <section
              key={col.label}
              aria-label={`${col.label}: ${list.length}`}
              className="min-w-0 rounded-md border border-border bg-surface-deep p-2"
            >
              <div className="mb-1 flex items-center justify-between gap-1 text-xs font-medium text-sub">
                {col.label}
                <span className="font-data">{list.length}</span>
              </div>
              <ul className="space-y-1">
                {list.map((s) => (
                  <li key={s.id} className="break-words text-xs text-text">
                    {s.title}
                    {typeof s.points === "number" && (
                      <span className="font-data text-sub"> · {s.points} pt</span>
                    )}
                    {s.blocked && s.status !== "done" && (
                      <span className="text-danger"> · blocked</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {boardLink && <p className="text-xs">{boardLink}</p>}
    </div>
  );
}

/**
 * Live mode: the Daily Scrum run person by person over the sprint board.
 * Each turn shows that person's stories by status (and the blocked ones)
 * and what they planned last time, with a clock for the turn that also
 * docks on other pages. Next speaker, Skip for now (they stay "not yet"),
 * give someone the floor, or mark them out of today's standup.
 */
export function BoardWalk({
  order,
  away,
  entries,
  today,
  exampleStories,
  isExamplePerson,
  onTurn,
  onAway,
  onBack,
}: {
  /** Who speaks, in order (lib: speakingOrder). */
  order: readonly string[];
  away: readonly string[];
  entries: readonly StandupEntry[];
  today: string;
  /** The example's board while the example is loaded (never saved). */
  exampleStories: readonly Story[] | null;
  isExamplePerson: (name: string) => boolean;
  /** The speaker changed (null once the walk ends). */
  onTurn: (name: string | null) => void;
  onAway: (name: string) => void;
  onBack: (name: string) => void;
}) {
  const { sprints, selected, select } = useSelectedSprint();
  const stories = useWorkspaceStore((s) => s.stories ?? NO_STORIES);
  const stored = useStandupWalk((s) => s.walk);
  const setWalk = useStandupWalk((s) => s.setWalk);
  const walk = stored && stored.date === today ? stored : null;
  const announce = useAnnounce();

  const [turnChoice, setTurnChoice] = useState<number | "auto">("auto");
  const autoSeconds = autoTurnSeconds(order.length);
  const turnSeconds = turnChoice === "auto" ? autoSeconds : turnChoice;

  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(walk?.current && walk.endsAt !== null);
  useVisibilityTick(running, 1000, () => setNow(Date.now()));
  const remaining = walk ? turnRemaining(walk, now) : 0;

  const onTurnRef = useRef(onTurn);
  useEffect(() => {
    onTurnRef.current = onTurn;
  });

  // Back on the page mid-walk: pick up a pause or resume made from the
  // docked timer, and let the form follow the current speaker again.
  useEffect(() => {
    const w = useStandupWalk.getState().walk;
    if (!w || w.date !== today) return;
    const synced = withDockState(w, useDockTimer.getState().timer);
    if (synced !== w) setWalk(synced);
    if (w.current) onTurnRef.current(w.current);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Time's up: said once per turn, never by sound.
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!walk?.current || walk.endsAt === null || remaining > 0) return;
    if (announcedRef.current === walk.current) return;
    announcedRef.current = walk.current;
    announce(`Time's up for ${walk.current}`, "assertive");
  }, [walk, remaining, announce]);

  const commit = (next: Walk | null, message?: string) => {
    if (personKey(next?.current) !== personKey(walk?.current)) {
      announcedRef.current = null;
      onTurn(next?.current ?? null);
    }
    setWalk(next);
    setNow(Date.now());
    publishTurn(next);
    if (message) announce(message);
  };

  // The turn length (on Auto it follows who's in today) applies from the next turn on.
  const withLength = (w: Walk): Walk => ({ ...w, turnSeconds });

  const start = () => {
    const w = startWalk(order, today, turnSeconds, Date.now());
    commit(w, w.current ? `${w.current}'s turn` : undefined);
  };
  const next = () => {
    if (!walk) return;
    const w = nextSpeaker(withLength(walk), order, Date.now());
    commit(w, w.current ? `${w.current}'s turn` : "Everyone has had a turn");
  };
  const skip = () => {
    if (!walk?.current) return;
    const w = skipSpeaker(withLength(walk), order, Date.now());
    commit(
      w,
      w.current === walk.current
        ? "Nobody else is waiting"
        : `Skipped ${walk.current}. ${w.current}'s turn`
    );
  };
  const give = (name: string) => {
    if (!walk) return;
    commit(takeTurn(withLength(walk), name, Date.now()), `${name}'s turn`);
  };
  const togglePause = () => {
    if (!walk) return;
    const t = Date.now();
    commit(running ? pauseTurn(walk, t) : resumeTurn(walk, t), running ? "Paused" : "Resumed");
  };
  const end = () => commit(null, "Standup ended");

  const boardFor = (name: string): PersonBoard | null => {
    if (exampleStories && isExamplePerson(name)) {
      return {
        stories: exampleStories.filter((s) => personKey(s.owner) === personKey(name)),
        sprintName: EXAMPLE_SPRINT_NAME,
      };
    }
    if (!selected) return null;
    return {
      stories: stories.filter(
        (s) => s.sprintId === selected.id && personKey(s.owner) === personKey(name)
      ),
      sprintName: selected.name,
      href: sprintHref("/kanban", selected.id),
    };
  };
  const unowned = selected
    ? stories.filter((s) => s.sprintId === selected.id && !s.owner?.trim() && s.status !== "done")
        .length
    : 0;

  const current = walk?.current ?? null;
  const lastPlan = current ? previousEntry(entries, current, today) : undefined;
  const spokenInOrder = walk ? order.filter((n) => walk.spoken.includes(personKey(n))).length : 0;
  const clockTone = remaining <= 0 ? "text-danger" : remaining <= 15 ? "text-warning" : "text-text";

  return (
    <SectionCard
      title="Walk the board"
      icon={Mic}
      contentClassName="space-y-4"
      actions={
        sprints.length > 0 ? (
          <SprintPicker
            sprints={sprints}
            selectedId={selected?.id}
            onSelect={select}
            allowCreate={false}
          />
        ) : undefined
      }
    >
      {order.length === 0 ? (
        <p className="text-sm text-sub">
          Nobody to call on yet. Add your team on the{" "}
          <Link href="/team" className="text-accent underline-offset-2 hover:underline">
            Team page
          </Link>
          , or post the first update.
        </p>
      ) : !walk ? (
        <div className="space-y-3">
          <p className="text-sm text-sub">
            {order.length} {order.length === 1 ? "person" : "people"}, about{" "}
            <span className="font-data text-text">{turnClock(turnSeconds)}</span> each in a
            15-minute Daily Scrum. Each person talks to their own cards on the board.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Each turn" className="w-40">
              {(props) => (
                <select
                  {...props}
                  value={String(turnChoice)}
                  onChange={(e) =>
                    setTurnChoice(e.target.value === "auto" ? "auto" : Number(e.target.value))
                  }
                  className="h-11 rounded-md border border-border bg-surface-deep px-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent md:h-9"
                >
                  <option value="auto">Auto ({turnClock(autoSeconds)})</option>
                  {TURN_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {turnClock(s)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button type="button" onClick={start} className="gap-1">
              <Play className="h-4 w-4" aria-hidden="true" />
              Start the standup
            </Button>
          </div>
        </div>
      ) : current ? (
        <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-sub">
                Speaking now · turn {Math.min(order.length, spokenInOrder + 1)} of {order.length}
              </p>
              <p className="break-words font-display text-lg text-text">{current}</p>
            </div>
            <span
              role="timer"
              aria-label={
                remaining > 0
                  ? `${turnClock(remaining)} left`
                  : `Time's up, ${turnClock(-remaining)} over`
              }
              className={cn("font-data text-2xl tabular-nums", clockTone)}
            >
              {turnClock(remaining)}
            </span>
          </div>
          {lastPlan && lastPlan.today.trim() && (
            <p className="break-words text-sm text-sub">
              <span className="text-text">Planned on {shortDay(lastPlan.date)}:</span>{" "}
              {lastPlan.today}
            </p>
          )}
          <PersonBoardView name={current} board={boardFor(current)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={next} className="gap-1">
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              Next speaker
            </Button>
            <Button type="button" variant="outline" onClick={skip}>
              Skip for now
            </Button>
            <IconButton
              label={running ? "Pause the turn" : "Resume the turn"}
              icon={running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              onClick={togglePause}
            />
            <Button type="button" variant="ghost" onClick={end} className="gap-1">
              <Square className="h-4 w-4" aria-hidden="true" />
              End standup
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
          <p className="flex items-center gap-2 text-sm text-text" role="status">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            Everyone has had a turn.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={end}>
            End standup
          </Button>
        </div>
      )}

      {selected && unowned > 0 && (
        <p className="text-xs text-sub">
          {unowned} open {unowned === 1 ? "story" : "stories"} on {selected.name}{" "}
          {unowned === 1 ? "has" : "have"} no owner yet.
        </p>
      )}

      {order.length > 0 && (
        <ol aria-label="Speaking order" className="space-y-1.5">
          {order.map((name, i) => {
            const state = turnState(walk, name);
            const posted = Boolean(entryFor(entries, name, today));
            return (
              <li
                key={name}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-md border px-3 py-1",
                  state === "speaking" ? "border-accent/40 bg-accent/10" : "border-border bg-card"
                )}
              >
                <span className="w-5 shrink-0 font-data text-xs text-sub" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{name}</span>
                {posted && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="max-sm:sr-only">Posted</span>
                  </span>
                )}
                {walk && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-xs",
                      CHIP[state].className
                    )}
                  >
                    {CHIP[state].label}
                  </span>
                )}
                {walk && state !== "speaking" && (
                  <IconButton
                    label={`Give ${name} the floor`}
                    icon={<Hand className="h-4 w-4" />}
                    className="text-sub hover:text-text"
                    onClick={() => give(name)}
                  />
                )}
                <AwayButton name={name} onAway={onAway} />
              </li>
            );
          })}
        </ol>
      )}
      <AwayList away={away} onBack={onBack} />
      <TeamLink />
    </SectionCard>
  );
}
