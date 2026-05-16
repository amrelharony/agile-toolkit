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
    rotationMode && participants.length > 0
      ? participants[currentPerson]
      : null;

  // ---------------------------------------------------------------------------
  // Timer tick
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      // The previous version called setRunning(false) and sonify("finish")
      // from inside the setRemaining updater. React may invoke updaters
      // multiple times in Strict Mode (and during concurrent rendering),
      // which produced duplicate sonify("finish") emissions and a "setState
      // during setState" warning. The "did we just hit zero?" handling now
      // lives in a separate effect below that watches `remaining`.
      setRemaining((prev) => {
        if (prev <= 1) return 0;
        if (prev === 11) sonify("ten-seconds");
        else if (prev % 60 === 0 && prev > 0) sonify("minute-mark");
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, sonify]);

  // Stop the timer and play the finish sound exactly once when remaining
  // reaches zero while running. This is intentionally a separate effect so
  // setState calls don't happen inside another updater (see comment above).
  useEffect(() => {
    if (running && remaining === 0) {
      setRunning(false);
      sonify("finish");
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
    const newPerson = Math.min(
      Math.floor(elapsed / perPersonSeconds),
      participants.length - 1
    );
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
      // Decrement immediately on play so the display drops from N → N-1
      // right away instead of freezing at N for the full first second
      // (setInterval waits the full delay before its first invocation).
      setRemaining((prev) => (prev > 0 ? prev - 1 : prev));
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
            isFullscreen
              ? "!bg-bg !border-0 !rounded-none flex items-center justify-center"
              : ""
          }`}
        >
          <CardContent
            className={`flex flex-col items-center gap-6 pt-8 pb-8 ${
              isFullscreen ? "scale-[1.6] sm:scale-[2.2]" : ""
            }`}
          >
            {/* SVG circular timer */}
            <div
              className="relative"
              style={{
                width: SVG_SIZE,
                height: SVG_SIZE,
                filter:
                  started && remaining > 0
                    ? `drop-shadow(${glow.split(",")[0].replace("0 0", "0 0")})`
                    : undefined,
              }}
            >
              <svg
                width={SVG_SIZE}
                height={SVG_SIZE}
                viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
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
                    className="mt-2 text-sm font-semibold"
                    style={{ color: "var(--destructive)" }}
                  >
                    Time&apos;s up!
                  </span>
                )}
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
                {running ? (
                  <Pause className="h-6 w-6" />
                ) : (
                  <Play className="h-6 w-6 ml-0.5" />
                )}
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
                  <span className="font-data tabular-nums text-xs opacity-70">
                    {p.minutes} min
                  </span>
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
                    rotationMode
                      ? "bg-accent/10 text-accent"
                      : "text-sub"
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
                          started && i === currentPerson
                            ? "bg-accent/10 text-accent"
                            : "text-sub"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-data text-xs opacity-50">
                            {i + 1}.
                          </span>
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
