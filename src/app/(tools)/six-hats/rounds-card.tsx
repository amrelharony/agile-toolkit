"use client";

import { useEffect, useState } from "react";
import { Check, ChevronLeft, Pause, Play, RotateCcw, SkipForward, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SectionCard } from "@/components/shared/section-card";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import type { SixHatsSession } from "@/lib/stores/workspace-types";
import {
  formatClock,
  timerRemaining,
  useDockTimer,
  type DockedTimer,
} from "@/lib/timer/dock-timer";
import { formatDate } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import { hatInfo } from "./hats";
import {
  SIX_HATS_PATH,
  currentIndex,
  halfTimeHint,
  isAdoptedSession,
  isLastRound,
  isRoundClock,
  sessionStatus,
} from "./session";

export interface RoundClock {
  /** The docked clock when it is this session's current round. */
  timer: DockedTimer | null;
  /** Another page's clock holding the dock (a ceremony, a standup turn). */
  holder: DockedTimer | null;
  /** Seconds left on this round's clock; null when it isn't timed. */
  remaining: number | null;
  running: boolean;
}

/**
 * The round's clock, read from the app's docked timer: it keeps running on
 * the dock while the facilitator opens another tool, and pausing it there
 * holds here. Ticks once a second while it runs.
 */
export function useRoundClock(session: SixHatsSession | null): RoundClock {
  const dock = useDockTimer((s) => s.timer);
  const ours = session !== null && isRoundClock(dock, session);
  const running = ours && dock !== null && dock.endsAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useVisibilityTick(running, 1000, () => setNow(Date.now()));
  // A start, pause or restart shows at once, not on the next tick.
  useEffect(() => setNow(Date.now()), [dock]);
  return {
    timer: ours ? dock : null,
    holder: dock && dock.href !== SIX_HATS_PATH ? dock : null,
    remaining: ours && dock ? timerRemaining(dock, now) : null,
    running,
  };
}

/**
 * The rounds of a session: where it is, the clock, and the controls to
 * start, move on, skip or go back. Nothing moves or starts by itself.
 */
export function RoundsCard({
  session,
  onStart,
  onNext,
  onBack,
  onTime,
  onReplaceDock,
  onReopen,
  onToSummary,
}: {
  session: SixHatsSession;
  onStart: () => void;
  /** Next hat, or Skip hat (`skipped`). */
  onNext: (skipped: boolean) => void;
  onBack: () => void;
  /** Start, or restart, this round's clock. */
  onTime: () => void;
  /** Stop another page's docked timer and time this round instead. */
  onReplaceDock: () => void;
  onReopen: () => void;
  onToSummary: () => void;
}) {
  const clock = useRoundClock(session);
  const status = sessionStatus(session);
  const i = currentIndex(session);
  const n = session.order.length;
  // Earlier thoughts given a topic: a discussion that never had rounds, so
  // none are shown as done and no minutes as chosen (until it's reopened).
  const untimed = status === "closed" && isAdoptedSession(session);

  return (
    <SectionCard
      title="Rounds"
      icon={Timer}
      titleSuffix={
        untimed ? undefined : (
          <span className="text-xs font-normal text-sub">
            {n} × {session.roundMinutes} min
          </span>
        )
      }
    >
      {untimed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-sub">
            These thoughts were logged before sessions had timed rounds. Reopen it to add thoughts
            or run rounds.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onReopen} data-focus="reopen">
            Reopen session
          </Button>
        </div>
      ) : (
        <ol className="scroll-x-snap gap-2 pb-1" aria-label="Rounds">
          {session.order.map((hat, k) => {
            const info = hatInfo(hat);
            const state =
              status === "closed" || (i !== null && k < i) ? "done" : k === i ? "current" : "next";
            return (
              <li
                key={k}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  state === "current"
                    ? "border-accent bg-accent/10 font-medium text-text"
                    : "border-border text-sub"
                )}
              >
                {state === "done" && <Check className="h-3 w-3" aria-hidden="true" />}
                <span className={cn("h-2.5 w-2.5 rounded-full", info.swatch)} aria-hidden="true" />
                <span>
                  {k + 1}. {info.name}
                </span>
                {state !== "next" && (
                  <span className="sr-only">{state === "done" ? ", done" : ", now"}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {status === "not-started" && n > 0 && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-sub">
            Not started. Round 1 is the{" "}
            <span className={cn("font-medium", hatInfo(session.order[0]).text)}>
              {hatInfo(session.order[0]).name} hat
            </span>
            : {hatInfo(session.order[0]).hint}
          </p>
          <Button type="button" onClick={onStart} className="gap-1" data-focus="start-round">
            <Play className="h-4 w-4" aria-hidden="true" />
            Start round 1
          </Button>
        </div>
      )}

      {status === "in-round" && i !== null && (
        <InRound
          session={session}
          index={i}
          clock={clock}
          onNext={onNext}
          onBack={onBack}
          onTime={onTime}
          onReplaceDock={onReplaceDock}
          onToSummary={onToSummary}
        />
      )}

      {status === "closed" && !untimed && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-sub">
            Closed {formatDate(session.closedAt!)}. Reopen it to add thoughts or run more rounds.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onReopen} data-focus="reopen">
            Reopen session
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function InRound({
  session,
  index,
  clock,
  onNext,
  onBack,
  onTime,
  onReplaceDock,
  onToSummary,
}: {
  session: SixHatsSession;
  index: number;
  clock: RoundClock;
  onNext: (skipped: boolean) => void;
  onBack: () => void;
  onTime: () => void;
  onReplaceDock: () => void;
  onToSummary: () => void;
}) {
  const info = hatInfo(session.order[index]);
  const last = isLastRound(session);
  const half = halfTimeHint(session);
  const next = last ? null : hatInfo(session.order[index + 1]);
  const prev = index > 0 ? hatInfo(session.order[index - 1]) : null;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-base font-medium text-text">
            Round {index + 1} of {session.order.length}:{" "}
            <span className={info.text}>{info.name} hat</span>
            <span className="text-sm font-normal text-sub"> · {info.focus}</span>
          </h3>
          <p className="text-sm text-sub">{info.hint}</p>
          {half && <p className="mt-1 text-xs text-sub">{half}</p>}
        </div>
        <ClockView clock={clock} onTime={onTime} />
      </div>

      {clock.holder && !clock.timer && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
        >
          <p className="min-w-0 flex-1">
            The docked timer is running “{clock.holder.label}” for another page, so this round isn’t
            timed.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onReplaceDock}>
            Stop it and time this round
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {next ? (
          <>
            <Button
              type="button"
              onClick={() => onNext(false)}
              className="gap-1"
              data-focus="next-hat"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              Next hat: {next.name}
            </Button>
            <Button type="button" variant="outline" onClick={() => onNext(true)}>
              Skip the {info.name} hat
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-sub">
              Last round. Write the Blue-hat summary, then close the session.
            </p>
            <Button type="button" variant="outline" onClick={onToSummary} data-focus="to-summary">
              Write the summary
            </Button>
          </>
        )}
        {prev && (
          <Button type="button" variant="ghost" onClick={onBack} className="gap-1 text-sub">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to {prev.name}
          </Button>
        )}
      </div>
    </div>
  );
}

function ClockView({ clock, onTime }: { clock: RoundClock; onTime: () => void }) {
  if (!clock.timer || clock.remaining === null) {
    if (clock.holder) return null;
    return (
      <Button type="button" size="sm" variant="outline" onClick={onTime} className="gap-1">
        <Timer className="h-4 w-4" aria-hidden="true" />
        Time this round
      </Button>
    );
  }
  const done = clock.remaining === 0;
  const { pause, resume } = useDockTimer.getState();
  return (
    <div className="flex items-center gap-1">
      <span
        role="timer"
        className={cn(
          "font-mono text-2xl tabular-nums",
          done ? "text-warning" : clock.running ? "text-text" : "text-sub"
        )}
      >
        <span className="sr-only">Time left in this round: </span>
        {done ? "Time's up" : formatClock(clock.remaining)}
      </span>
      {!done && (
        <IconButton
          label={clock.running ? "Pause the round's clock" : "Resume the round's clock"}
          icon={
            clock.running ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )
          }
          onClick={() => (clock.running ? pause() : resume())}
        />
      )}
      <IconButton
        label="Restart the round's clock"
        icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
        onClick={onTime}
      />
    </div>
  );
}
