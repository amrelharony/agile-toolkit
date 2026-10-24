"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Maximize, Minimize, Pause, Play, SkipForward, StepForward, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatClock } from "@/lib/timer/dock-timer";
import { cn } from "@/lib/utils";
import { shortClock, type Agenda } from "./agenda";
import type { RunView } from "./run";
import { SHORTCUT_KEYS } from "./shortcuts";

const SVG_SIZE = 280;
const STROKE_WIDTH = 10;
const RADIUS = (SVG_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The ring's colour, as theme variables so it follows light, dark and high
 * contrast: the accent while there's time, amber near the end, and the
 * warning colour once the segment runs over (with "over" said in text too).
 */
function ringColor(fraction: number, over: boolean): string {
  if (over) return "var(--warning)";
  if (fraction <= 0.05) return "var(--destructive)";
  if (fraction <= 0.2) return "var(--chart-4)";
  return "var(--accent)";
}

/** "+0:42" once past zero, else the countdown "09:30". */
function countText(left: number): string {
  return left < 0 ? `+${shortClock(-left)}` : formatClock(left);
}

export interface TimerFaceProps {
  agenda: Agenda;
  view: RunView;
  /** There is a length to run (a Custom time-box needs one first). */
  canStart: boolean;
  onToggle: () => void;
  onNextSpeaker: () => void;
  onSkipSpeaker: () => void;
  onNextSegment: () => void;
  /** The Restart control (it confirms and offers Undo), shown once started. */
  restart: ReactNode;
  chime: boolean;
  onChime: (on: boolean) => void;
}

/**
 * The countdown for the segment that's on, the speaker who's up, the whole
 * meeting's time left, and the controls. Fullscreen puts this card alone
 * on the screen for a shared room or call.
 */
export function TimerFace({
  agenda,
  view,
  canStart,
  onToggle,
  onNextSpeaker,
  onSkipSpeaker,
  onNextSegment,
  restart,
  chime,
  onChime,
}: TimerFaceProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chimeId = useId();

  // Kept in sync with Esc and other browser-driven exits.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === cardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!cardRef.current) return;
    try {
      if (document.fullscreenElement === cardRef.current) await document.exitFullscreen();
      else await cardRef.current.requestFullscreen();
    } catch {
      // Some browsers (and sandboxed iframes) refuse; the page still works.
    }
  };

  const { segment, speakers } = view;
  const multi = agenda.segments.length > 1;
  const planned = segment?.seconds ?? 0;
  const left = view.segmentLeft;
  const over = view.started && !view.finished && left < 0;
  const fraction = planned > 0 ? Math.max(0, left) / planned : 1;
  const color = view.finished ? "var(--accent)" : ringColor(fraction, over);
  const isLast = view.index >= agenda.segments.length - 1;
  const turnTaking = Boolean(segment?.speakers && speakers);
  const current = speakers?.current ?? null;
  const turnLeft = current ? current.shareSeconds - current.spentSeconds : 0;

  return (
    <Card
      ref={cardRef}
      className={cn(
        "border-border bg-surface",
        isFullscreen && "!rounded-none !border-0 !bg-bg flex items-center justify-center"
      )}
    >
      <CardContent
        className={cn(
          "flex flex-col items-center gap-5 pb-8 pt-6",
          isFullscreen && "scale-[1.4] sm:scale-[2]"
        )}
      >
        <p className="text-center text-sm text-sub">
          <span className="font-medium text-text">{agenda.label}</span>
          {multi && (
            <>
              {" · "}
              {view.finished
                ? "finished"
                : `segment ${view.index + 1} of ${agenda.segments.length}`}
            </>
          )}
        </p>

        <div className="mx-auto w-full max-w-[280px]">
          <div className="relative aspect-square w-full">
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              preserveAspectRatio="xMidYMid meet"
              className="rotate-[-90deg]"
              aria-hidden="true"
            >
              <circle
                cx={SVG_SIZE / 2}
                cy={SVG_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="var(--surface-hover)"
                strokeWidth={STROKE_WIDTH}
              />
              <circle
                cx={SVG_SIZE / 2}
                cy={SVG_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - (over ? 1 : fraction))}
                style={{ transition: "stroke-dashoffset 0.4s linear, stroke 0.5s ease" }}
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
              {view.finished ? (
                <>
                  <span className="font-data text-4xl tabular-nums tracking-tight text-text">
                    {formatClock(view.totalSpent)}
                  </span>
                  <span className="text-sm text-sub">in total</span>
                </>
              ) : (
                <>
                  <span
                    role="timer"
                    className="font-data text-5xl tabular-nums tracking-tight"
                    style={{ color }}
                  >
                    {countText(left)}
                  </span>
                  {over ? (
                    <span className="animate-pulse rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-sm font-semibold uppercase tracking-wider text-warning">
                      Over time
                    </span>
                  ) : null}
                  {multi && segment && (
                    <span className="line-clamp-2 text-sm font-medium text-text">
                      {segment.label}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {!view.finished && turnTaking && (
          <p className="text-center text-sm">
            {current ? (
              <>
                <span className="text-sub">{view.started ? "Speaking: " : "Up first: "}</span>
                <span className="font-medium text-accent">{current.name}</span>
                <span className="text-sub"> · </span>
                {turnLeft < 0 ? (
                  <span className="font-medium text-warning">+{shortClock(-turnLeft)} over</span>
                ) : (
                  <span className="text-sub">
                    {shortClock(turnLeft)} {view.started ? "left" : "each"}
                  </span>
                )}
              </>
            ) : (
              <span className="text-sub">Everyone has spoken.</span>
            )}
          </p>
        )}

        {view.started && !view.finished && (
          <p className="text-center text-xs text-sub">
            {view.totalLeft >= 0
              ? `Overall ${formatClock(view.totalLeft)} left of ${formatClock(view.totalPlanned)}`
              : `Overall +${shortClock(-view.totalLeft)} over ${formatClock(view.totalPlanned)}`}
            {multi && Math.abs(view.drift) >= 60 && (
              <>
                {" · "}
                <span className={view.drift > 0 ? "text-warning" : undefined}>
                  {shortClock(Math.abs(view.drift))}{" "}
                  {view.drift > 0 ? "behind the agenda" : "ahead of the agenda"}
                </span>
              </>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            size="lg"
            onClick={onToggle}
            disabled={!canStart || view.finished}
            aria-label={view.running ? "Pause timer" : "Start timer"}
            aria-keyshortcuts={SHORTCUT_KEYS.toggle}
            className={cn(
              "h-14 w-14 rounded-full p-0",
              view.running
                ? "bg-surface-hover text-accent hover:bg-surface-hover/80"
                : "bg-accent text-[var(--bg)] hover:bg-accent/80"
            )}
          >
            {view.running ? (
              <Pause className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 h-6 w-6" aria-hidden="true" />
            )}
          </Button>
          {turnTaking && (
            <>
              <Button
                variant="outline"
                onClick={onNextSpeaker}
                disabled={!view.started || view.finished || !current}
                aria-keyshortcuts={SHORTCUT_KEYS["next-speaker"]}
                className="gap-1.5"
              >
                <StepForward className="h-4 w-4" aria-hidden="true" />
                Next speaker
              </Button>
              <Button
                variant="ghost"
                onClick={onSkipSpeaker}
                disabled={!view.started || view.finished || !current}
                aria-keyshortcuts={SHORTCUT_KEYS["skip-speaker"]}
                className="gap-1.5"
              >
                <UserX className="h-4 w-4" aria-hidden="true" />
                Skip speaker
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={onNextSegment}
            disabled={!view.started || view.finished}
            aria-keyshortcuts={SHORTCUT_KEYS["next-segment"]}
            className="gap-1.5"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
            {isLast ? "Finish" : "Next segment"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {view.started && restart}
          <IconButton
            label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            icon={
              isFullscreen ? (
                <Minimize className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Maximize className="h-5 w-5" aria-hidden="true" />
              )
            }
            className="text-sub hover:text-text"
            onClick={() => void toggleFullscreen()}
          />
          <div className="flex items-center gap-2">
            <Switch id={chimeId} checked={chime} onCheckedChange={onChime} />
            <Label htmlFor={chimeId} className="text-sm text-sub">
              Chime when time is up
            </Label>
          </div>
        </div>

        {!isFullscreen && (
          <p className="text-center text-xs text-sub">
            Keys: <Kbd>Space</Kbd> start or pause
            {turnTaking && (
              <>
                {" · "}
                <Kbd>N</Kbd> next speaker · <Kbd>S</Kbd> skip
              </>
            )}
            {" · "}
            <Kbd>Shift</Kbd>+<Kbd>N</Kbd> {isLast ? "finish" : "next segment"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-deep px-1 font-mono text-xs text-text">
      {children}
    </kbd>
  );
}
