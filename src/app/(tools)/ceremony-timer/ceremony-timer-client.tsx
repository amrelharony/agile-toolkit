"use client";

import { useState, useEffect, useRef } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Play,
  Pause,
  RotateCcw,
  Users,
  X,
  Plus,
  ChevronRight,
  Timer,
  Maximize,
  Minimize,
} from "lucide-react";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CEREMONY_TIMER_ACTIONS } from "@/lib/history/event-actions";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  minutes: number;
}

const PRESETS: Preset[] = [
  { label: "Standup", minutes: 15 },
  { label: "Planning", minutes: 120 },
  { label: "Review", minutes: 60 },
  { label: "Retro", minutes: 90 },
  { label: "Refinement", minutes: 60 },
];

const SVG_SIZE = 280;
const STROKE_WIDTH = 10;
const RADIUS = (SVG_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Theme-aware color tokens. We intentionally use CSS custom properties so the
// timer adapts to light/dark without each call site needing to know the
// current theme. `--destructive` and `--chart-4` are defined on `:root` in
// globals.css and inherit into both themes; `--accent` overrides per theme.
function progressColor(fraction: number): string {
  if (fraction <= 0.05) return "var(--destructive)";
  if (fraction <= 0.2) return "var(--chart-4)";
  return "var(--accent)";
}

function glowColor(fraction: number): string {
  if (fraction <= 0.05) return "0 0 30px var(--destructive), 0 0 60px var(--destructive)";
  if (fraction <= 0.2) return "0 0 30px var(--chart-4), 0 0 60px var(--chart-4)";
  return "0 0 30px var(--accent), 0 0 60px var(--glowS)";
}

/**
 * Direct-to-browser alarm beep — completely separate from the toolkit's
 * sonification engine.
 *
 * Why a parallel audio path? The sonification engine respects a user
 * preference toggle in the header (Volume On/Off). The Ceremony Timer's
 * whole purpose is to alert the team that time is up — silently letting
 * a 60-minute planning meeting end without a single ding because someone
 * muted the toolkit's UI sounds is a primary-feature regression.
 *
 * The beep uses a freshly-created AudioContext so it isn't affected by
 * the toolkit's shared engine state (suspended context, mode gates).
 * Pattern: three rapid 600Hz beeps over 800ms.
 *
 * Browsers require a user gesture before audio can play; the user
 * always taps Start to begin the timer so the alarm fires inside a
 * gesture-derived context.
 */
function playFinishAlarm(): void {
  if (typeof window === "undefined") return;
  const Ctx =
    typeof window !== "undefined" &&
    (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    // Close the context after the last beep so it doesn't linger and
    // burn idle CPU. The 0.85s timeout covers all three beeps.
    const closeAt = ctx.currentTime + 0.85;

    const playBeep = (offset: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      // 880 Hz (A5) — bright, attention-grabbing, but not piercing
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
      // ADSR envelope avoids the click-pop of an instant on/off
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    };

    playBeep(0);
    playBeep(0.3);
    playBeep(0.6);

    setTimeout(
      () => {
        void ctx.close().catch(() => undefined);
      },
      (closeAt - ctx.currentTime) * 1000
    );
  } catch {
    /* AudioContext creation failed (sandboxed iframe, etc.) — fall back to
     * the existing sonify("finish") path which the caller invoked too */
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CeremonyTimerClient() {
  // Timer state
  const [totalSeconds, setTotalSeconds] = useState(0); // chosen duration
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Custom duration input
  const [customMin, setCustomMin] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  // Rotation mode
  const [rotationMode, setRotationMode] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [currentPerson, setCurrentPerson] = useState(0);
  const prevPersonRef = useRef(0);
  // BUG-T1-ceremony-timer-1: reset prevPersonRef when rotation mode
  // turns on OR when the participants list changes shape. Without this,
  // a previous session's index leaks: 3-person rotation finishes at
  // index 3, user toggles rotation off then back on with 5 new people,
  // and the rotation effect sees newPerson=0 vs prev=3 and spuriously
  // plays the "rotate" sound on the next tick.
  useEffect(() => {
    if (rotationMode) prevPersonRef.current = 0;
  }, [rotationMode]);
  useEffect(() => {
    prevPersonRef.current = Math.min(prevPersonRef.current, Math.max(0, participants.length - 1));
  }, [participants.length]);
  // Suppresses the rotation sonification when the active-person index changes
  // because a participant was removed (vs. because the timer rolled forward).
  // Without this, deleting the active participant plays "rotate" spuriously.
  const suppressRotateSonifyRef = useRef(false);

  // `useToolSonification` returns a callback memoized with `[toolId]`; since
  // toolId is a string literal here, `sonify` is stable across renders and
  // safe to include in effect deps without thrashing the interval.
  const sonify = useToolSonification("ceremony-timer");
  const { log } = useHistoryLogger("ceremony-timer");

  // Fullscreen — uses the browser Fullscreen API on the timer card so the
  // user gets a distraction-free view (browser hides chrome, address bar).
  // Listen for `fullscreenchange` so ESC / browser-driven exits keep state in sync.
  const cardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(document.fullscreenElement === cardRef.current);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = async () => {
    if (!cardRef.current) return;
    try {
      if (document.fullscreenElement === cardRef.current) {
        await document.exitFullscreen();
      } else {
        await cardRef.current.requestFullscreen();
      }
    } catch {
      // Some browsers (or sandboxed iframes) reject the request silently.
    }
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const fraction = totalSeconds > 0 ? remaining / totalSeconds : 1;
  const dashOffset = CIRCUMFERENCE * (1 - fraction);
  const color = progressColor(fraction);
  const glow = glowColor(fraction);

  const perPersonSeconds =
    rotationMode && participants.length > 0
      ? Math.floor(totalSeconds / participants.length)
      : totalSeconds;

  const currentPersonName =
    rotationMode && participants.length > 0 ? participants[currentPerson] : null;

  // ---------------------------------------------------------------------------
  // Timer tick
  // ---------------------------------------------------------------------------

  // R11-fix: anchor the countdown to a wall-clock `endsAt` rather
  // than decrementing once per setInterval tick. Browsers throttle
  // setInterval to ≥1s (often 60s+) when the tab is hidden, and the
  // Date.now() clock advances during laptop sleep — both made the
  // displayed remaining time drift past actual wall-time, missing
  // the ten-second + minute-mark alarms and rendering after
  // ceremonies actually ended. Now: stash `endsAtRef`, compute
  // remaining from the live clock each tick. On visibilitychange
  // we recompute immediately so the display catches up.
  const endsAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      endsAtRef.current = null;
      return;
    }
    // Establish endsAt the FIRST time `running` flips to true, based
    // on the current `remaining`. Subsequent renders during this run
    // don't re-anchor (otherwise pause/resume drift would re-emerge).
    if (endsAtRef.current === null) {
      endsAtRef.current = Date.now() + remaining * 1000;
    }
    let lastReported = remaining;
    const tick = () => {
      const endsAt = endsAtRef.current;
      if (endsAt === null) return;
      const next = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      // Fire alarms at threshold crossings against the previous tick's
      // value (so suspending the tab through the 11-sec mark still
      // emits the ten-second alarm on the next visible tick).
      if (lastReported > 10 && next <= 10 && next > 0) sonify("ten-seconds");
      else if (next > 0 && next !== lastReported && next % 60 === 0) sonify("minute-mark");
      lastReported = next;
      setRemaining(next);
    };
    intervalRef.current = setInterval(tick, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
    // `remaining` intentionally excluded — it changes every tick and
    // including it would re-run the effect every second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sonify]);

  // Stop the timer and fire the multi-channel finish alarm exactly once
  // when remaining reaches zero while running.
  //
  // Belt-and-braces design — `sonify("finish")` alone was unreliable:
  //   - It's gated by the sonification store's `enabled` flag, so a user
  //     who toggled sound off in the header chip got no audio AND no
  //     haptic (haptic forwards from the same call but checks a
  //     separate gate)
  //   - Browser AudioContext can auto-suspend after extended idle, and
  //     the suspended-resume race meant the first sound after suspension
  //     could be eaten by the engine's lazy resume()
  //   - Mobile users running the timer in a backgrounded tab got NO
  //     feedback at all when their ceremony ended
  //
  // The new layered alarm:
  //   1) sonify("finish")          — keep the existing chord through
  //                                  the sonification pipeline so
  //                                  full-mode users get the rich sound
  //                                  AND the haptic pattern
  //   2) navigator.vibrate(...)    — direct call, ignores haptic store
  //                                  gating. The whole point of the
  //                                  timer is to alert; even users who
  //                                  muted "sonification" still want
  //                                  to know their meeting is over
  //   3) document.title flash      — for the backgrounded-tab case.
  //                                  Restores on focus or after 5s
  //   4) timeUp visual banner      — large pulsing "Time's up!" replaces
  //                                  the prior tiny destructive-coloured
  //                                  span. Captured below in render
  useEffect(() => {
    if (!(running && remaining === 0)) return;
    setRunning(false);
    sonify("finish");

    // Guaranteed alarm beep — bypasses the sonification toggle so a
    // user who muted UI sounds still hears the timer end. Three
    // 880 Hz sine bursts over 800 ms.
    playFinishAlarm();

    // Direct Android vibration — iOS Safari silently ignores
    // navigator.vibrate (no API), which is fine; the visual banner
    // and audio chord still fire. The 7-element pattern matches the
    // timer-end haptic pattern but goes through the lower-level API
    // so it fires even if the haptics store is disabled.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate([200, 100, 200, 100, 200, 100, 400]);
      } catch {
        /* permission denied or device doesn't support */
      }
    }

    // Document title flash — for users whose tab is backgrounded. Many
    // users start a 90-minute retro timer and switch tabs to do other
    // work; without this, the timer ending was invisible to them until
    // they came back. Restore on focus or after 5 s, whichever comes
    // first.
    if (typeof document !== "undefined") {
      const originalTitle = document.title;
      document.title = "⏰ Time's up — Agile Toolkit";
      const restoreTimer = setTimeout(() => {
        if (document.title.startsWith("⏰")) document.title = originalTitle;
      }, 5000);
      const onFocus = () => {
        if (document.title.startsWith("⏰")) document.title = originalTitle;
        clearTimeout(restoreTimer);
      };
      window.addEventListener("focus", onFocus, { once: true });
    }
  }, [running, remaining, sonify]);

  // Person rotation -- check if we should switch person.
  // Guard against `perPersonSeconds === 0` (which happens when the user picks
  // a duration shorter than the participant count, e.g. 3s split across 5
  // people). Without the guard, `Math.floor(elapsed / 0)` becomes NaN on the
  // first tick and propagates into the rotation chip ("NaN / 5").
  useEffect(() => {
    if (!rotationMode || participants.length === 0 || totalSeconds === 0) return;
    if (perPersonSeconds <= 0) return;
    const elapsed = totalSeconds - remaining;
    const newPerson = Math.min(Math.floor(elapsed / perPersonSeconds), participants.length - 1);
    if (newPerson !== prevPersonRef.current) {
      prevPersonRef.current = newPerson;
      setCurrentPerson(newPerson);
      // Skip the rotation sound when the index moved because a participant
      // was just removed — that's a structural change, not a real rotation.
      if (suppressRotateSonifyRef.current) {
        suppressRotateSonifyRef.current = false;
      } else {
        sonify("rotate");
      }
    }
  }, [remaining, rotationMode, participants.length, totalSeconds, perPersonSeconds, sonify]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const selectPreset = (minutes: number) => {
    const secs = minutes * 60;
    setTotalSeconds(secs);
    setRemaining(secs);
    setRunning(false);
    setStarted(false);
    setCurrentPerson(0);
    prevPersonRef.current = 0;
    setShowCustom(false);
    log(CEREMONY_TIMER_ACTIONS.PRESET_CHANGED, { minutes });
  };

  const applyCustom = () => {
    const trimmed = customMin.trim();
    const mins = Number(trimmed);
    if (trimmed && Number.isFinite(mins) && mins > 0 && mins <= 480) {
      selectPreset(mins);
      setShowCustom(false);
      // Reset the input so the next time the user opens Custom they don't
      // see a stale value pre-filled from the prior session.
      setCustomMin("");
    }
  };

  const togglePlay = () => {
    if (remaining <= 0) return;
    if (!running) {
      sonify("start");
      // BUG-T1-ceremony-timer-2: only pre-decrement on the very FIRST
      // start. The prior unconditional pre-decrement also fired on
      // resume-from-pause, so pausing at 30s and immediately resuming
      // visibly jumped to 29s with no actual elapsed time. After
      // `started === true`, the interval tick handles the next decrement.
      if (!started) {
        setRemaining((prev) => (prev > 0 ? prev - 1 : prev));
      }
    }
    setStarted(true);
    setRunning((r) => !r);
    log(running ? CEREMONY_TIMER_ACTIONS.TIMER_PAUSED : CEREMONY_TIMER_ACTIONS.TIMER_STARTED, {
      remainingSeconds: remaining,
    });
  };

  const reset = () => {
    setRunning(false);
    setStarted(false);
    setRemaining(totalSeconds);
    setCurrentPerson(0);
    prevPersonRef.current = 0;
    log(CEREMONY_TIMER_ACTIONS.TIMER_RESET, { totalSeconds });
  };

  const addParticipant = () => {
    const name = nameInput.trim();
    if (name && !participants.includes(name)) {
      setParticipants((prev) => [...prev, name]);
      setNameInput("");
    }
  };

  const removeParticipant = (name: string) => {
    // Compute the post-removal state outside any setState updater so we
    // don't fall back into the "setState inside setState" anti-pattern that
    // was fixed in the timer-tick effect (React 18 StrictMode invokes
    // updaters twice; nested setState + ref mutation in an updater is unsafe).
    const nextLen = Math.max(0, participants.filter((p) => p !== name).length);
    const max = Math.max(0, nextLen - 1);
    const newCp = Math.min(currentPerson, max);
    const newPrev = Math.min(prevPersonRef.current, max);
    // Mark the next rotation index change as remove-driven so the rotation
    // effect doesn't play a "rotate" sound for what is structurally a
    // participant deletion.
    if (newCp !== currentPerson || newPrev !== prevPersonRef.current) {
      suppressRotateSonifyRef.current = true;
    }
    prevPersonRef.current = newPrev;
    setCurrentPerson(newCp);
    setParticipants((prev) => prev.filter((p) => p !== name));
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ToolPageWrapper
      toolId="ceremony-timer"
      title="Ceremony Timer"
      description="Time-box agile ceremonies with preset or custom durations. Optional per-person rotation for standups."
      category="Ceremonies"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ----------------------------------------------------------------- */}
        {/* Left column -- Timer display */}
        {/* ----------------------------------------------------------------- */}
        <Card
          ref={cardRef}
          className={`border-border/40 bg-surface ${
            isFullscreen ? "!bg-bg !border-0 !rounded-none flex items-center justify-center" : ""
          }`}
        >
          <CardContent
            className={`flex flex-col items-center gap-6 pt-8 pb-8 ${
              isFullscreen ? "scale-[1.6] sm:scale-[2.2]" : ""
            }`}
          >
            {/* SVG circular timer */}
            <div className="w-full max-w-[280px] mx-auto">
              <div
                className="relative aspect-square w-full"
                style={{
                  filter:
                    started && remaining > 0
                      ? `drop-shadow(${glow.split(",")[0].replace("0 0", "0 0")})`
                      : undefined,
                }}
              >
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="rotate-[-90deg]"
                >
                  {/* Track */}
                  <circle
                    cx={SVG_SIZE / 2}
                    cy={SVG_SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke="var(--surface-hover)"
                    strokeWidth={STROKE_WIDTH}
                  />
                  {/* Progress */}
                  <circle
                    cx={SVG_SIZE / 2}
                    cy={SVG_SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={color}
                    strokeWidth={STROKE_WIDTH}
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    style={{
                      transition: "stroke-dashoffset 0.4s linear, stroke 0.5s ease",
                      filter: started ? `drop-shadow(0 0 8px ${color})` : undefined,
                    }}
                  />
                </svg>

                {/* Center time display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className="font-data text-5xl tabular-nums tracking-tight"
                    style={{ color }}
                  >
                    {formatTime(remaining)}
                  </span>
                  {currentPersonName && started && (
                    <span className="mt-2 text-sm font-medium text-accent flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      {currentPersonName}
                    </span>
                  )}
                  {remaining === 0 && started && (
                    <span
                      // Pulsing block instead of small text — combined
                      // with the audio + vibration triggers, this is the
                      // VISUAL channel of the multi-modal alarm. Without
                      // animation the previous tiny destructive-coloured
                      // text was easy to miss across the room during a
                      // standup.
                      //
                      // `animate-pulse` is a Tailwind utility that the
                      // toolkit's reduced-motion CSS automatically clamps
                      // to a near-still state, so users with
                      // prefers-reduced-motion still see the banner
                      // without the pulse.
                      role="status"
                      aria-live="assertive"
                      className="mt-3 px-3 py-1 rounded-md text-base font-bold uppercase tracking-wider animate-pulse"
                      style={{
                        color: "var(--destructive)",
                        backgroundColor: "color-mix(in srgb, var(--destructive) 12%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--destructive) 35%, transparent)",
                      }}
                    >
                      Time&apos;s up!
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <Button
                size="lg"
                onClick={togglePlay}
                disabled={totalSeconds === 0}
                aria-label={running ? "Pause timer" : "Start timer"}
                aria-pressed={running}
                className="h-14 w-14 rounded-full p-0"
                style={{
                  backgroundColor: running ? "var(--surface-hover)" : "var(--accent)",
                  color: running ? "var(--accent)" : "var(--bg)",
                }}
              >
                {running ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={reset}
                disabled={!started}
                className="h-14 w-14 rounded-full p-0 border-border/40 hover:bg-surface-hover"
                aria-label="Reset timer"
              >
                <RotateCcw className="h-5 w-5 text-sub" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={toggleFullscreen}
                className="h-14 w-14 rounded-full p-0 border-border/40 hover:bg-surface-hover"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={isFullscreen ? "Exit fullscreen (Esc)" : "Enter fullscreen"}
              >
                {isFullscreen ? (
                  <Minimize className="h-5 w-5 text-sub" />
                ) : (
                  <Maximize className="h-5 w-5 text-sub" />
                )}
              </Button>
            </div>

            {/* Rotation status bar */}
            {rotationMode && participants.length > 0 && started && (
              <div className="w-full max-w-xs">
                <div className="flex gap-1">
                  {participants.map((p, i) => (
                    <div
                      key={`${i}-${p}`}
                      className="flex-1 h-2 rounded-full transition-colors duration-300"
                      style={{
                        backgroundColor:
                          i < currentPerson
                            ? "var(--accent)"
                            : i === currentPerson
                              ? color
                              : "var(--surface-hover)",
                      }}
                    />
                  ))}
                </div>
                <p className="text-center text-xs text-sub mt-2">
                  {currentPerson + 1} / {participants.length} &middot;{" "}
                  {formatTime(perPersonSeconds)} per person
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ----------------------------------------------------------------- */}
        {/* Right column -- Presets & Participants */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex flex-col gap-6">
          {/* Presets */}
          <Card className="border-border/40 bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-sub flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Ceremony Presets
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="ghost"
                  onClick={() => selectPreset(p.minutes)}
                  className={`justify-between h-11 px-4 text-sm ${
                    totalSeconds === p.minutes * 60 && !showCustom
                      ? "bg-accent/10 text-accent border border-accent/30"
                      : "text-sub hover:text-text hover:bg-surface-hover"
                  }`}
                >
                  <span>{p.label}</span>
                  <span className="font-data tabular-nums text-xs opacity-70">{p.minutes} min</span>
                </Button>
              ))}

              {/* Custom */}
              {!showCustom ? (
                <Button
                  variant="ghost"
                  onClick={() => setShowCustom(true)}
                  className="justify-between h-11 px-4 text-sm text-sub hover:text-text hover:bg-surface-hover"
                >
                  <span>Custom</span>
                  <span className="text-xs opacity-70">...</span>
                </Button>
              ) : (
                <div className="flex gap-2 mt-1">
                  <Input
                    type="number"
                    min={1}
                    max={480}
                    placeholder="Minutes"
                    value={customMin}
                    onChange={(e) => setCustomMin(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                    className="h-11 bg-surface-deep border-border/40 text-text font-data"
                  />
                  <Button
                    onClick={applyCustom}
                    className="h-11 bg-accent text-[var(--bg)] hover:bg-accent/80 font-medium"
                  >
                    Set
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Participants / Rotation */}
          <Card className="border-border/40 bg-surface">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-sub flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Rotation Mode
                </CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRotationMode((v) => !v)}
                  className={`h-7 px-3 text-xs rounded-full ${
                    rotationMode ? "bg-accent/10 text-accent" : "text-sub"
                  }`}
                >
                  {rotationMode ? "On" : "Off"}
                </Button>
              </div>
            </CardHeader>

            {rotationMode && (
              <CardContent className="flex flex-col gap-3">
                {/* Name input */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Add participant"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addParticipant()}
                    className="h-10 bg-surface-deep border-border/40 text-text text-sm"
                  />
                  <Button
                    size="icon"
                    onClick={addParticipant}
                    disabled={!nameInput.trim()}
                    className="h-10 w-10 shrink-0 bg-accent text-[var(--bg)] hover:bg-accent/80"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Participant list */}
                {participants.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {participants.map((name, i) => (
                      <div
                        // Index participates in the key so a list of two
                        // identical names (rare but possible after a future
                        // rename or paste) doesn't collapse into one row.
                        key={`${i}-${name}`}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                          started && i === currentPerson ? "bg-accent/10 text-accent" : "text-sub"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-data text-xs opacity-50">{i + 1}.</span>
                          {name}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeParticipant(name)}
                          disabled={started && running}
                          aria-label={`Remove ${name}`}
                          className="min-touch-coarse h-6 w-6 opacity-40 hover:opacity-100 hover:text-[var(--destructive)]"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {participants.length === 0 && (
                  <p className="text-xs text-sub/60 text-center py-2">
                    Add names to split time equally among participants.
                  </p>
                )}
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
