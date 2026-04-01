"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";

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

function progressColor(fraction: number): string {
  if (fraction <= 0.05) return "#ef4444"; // danger red
  if (fraction <= 0.2) return "#ffaa00"; // warning amber
  return "#00f0ff"; // accent cyan
}

function glowColor(fraction: number): string {
  if (fraction <= 0.05) return "0 0 30px #ef4444, 0 0 60px #ef444466";
  if (fraction <= 0.2) return "0 0 30px #ffaa00, 0 0 60px #ffaa0066";
  return "0 0 30px #00f0ff, 0 0 60px #00f0ff66";
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

  // Audio ref for switch alert
  const audioCtxRef = useRef<AudioContext | null>(null);

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
  // Audio beep for person switch
  // ---------------------------------------------------------------------------

  const playBeep = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Audio not available -- silent fallback
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Timer tick
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          setRunning(false);
          playBeep();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, playBeep]);

  // Person rotation -- check if we should switch person
  useEffect(() => {
    if (!rotationMode || participants.length === 0 || totalSeconds === 0) return;
    const elapsed = totalSeconds - remaining;
    const newPerson = Math.min(
      Math.floor(elapsed / perPersonSeconds),
      participants.length - 1
    );
    if (newPerson !== prevPersonRef.current) {
      prevPersonRef.current = newPerson;
      setCurrentPerson(newPerson);
      playBeep();
    }
  }, [remaining, rotationMode, participants.length, totalSeconds, perPersonSeconds, playBeep]);

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
  };

  const applyCustom = () => {
    const mins = parseInt(customMin, 10);
    if (mins > 0 && mins <= 480) {
      selectPreset(mins);
      setShowCustom(false);
    }
  };

  const togglePlay = () => {
    if (remaining <= 0) return;
    setStarted(true);
    setRunning((r) => !r);
  };

  const reset = () => {
    setRunning(false);
    setStarted(false);
    setRemaining(totalSeconds);
    setCurrentPerson(0);
    prevPersonRef.current = 0;
  };

  const addParticipant = () => {
    const name = nameInput.trim();
    if (name && !participants.includes(name)) {
      setParticipants((prev) => [...prev, name]);
      setNameInput("");
    }
  };

  const removeParticipant = (name: string) => {
    setParticipants((prev) => prev.filter((p) => p !== name));
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ToolPageWrapper
      title="Ceremony Timer"
      description="Time-box agile ceremonies with preset or custom durations. Optional per-person rotation for standups."
      category="Ceremonies"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ----------------------------------------------------------------- */}
        {/* Left column -- Timer display */}
        {/* ----------------------------------------------------------------- */}
        <Card className="border-border/40 bg-surface">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
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
                  stroke="#1e2540"
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
                  <span className="mt-2 text-sm font-semibold text-[#ef4444]">
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
                className="h-14 w-14 rounded-full p-0"
                style={{
                  backgroundColor: running ? "#1e2540" : "#00f0ff",
                  color: running ? "#00f0ff" : "#0a0e1a",
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
              >
                <RotateCcw className="h-5 w-5 text-sub" />
              </Button>
            </div>

            {/* Rotation status bar */}
            {rotationMode && participants.length > 0 && started && (
              <div className="w-full max-w-xs">
                <div className="flex gap-1">
                  {participants.map((p, i) => (
                    <div
                      key={p}
                      className="flex-1 h-2 rounded-full transition-colors duration-300"
                      style={{
                        backgroundColor:
                          i < currentPerson
                            ? "#00f0ff"
                            : i === currentPerson
                              ? color
                              : "#1e2540",
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
                    className="h-11 bg-accent text-[#0a0e1a] hover:bg-accent/80 font-medium"
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
                    className="h-10 w-10 shrink-0 bg-accent text-[#0a0e1a] hover:bg-accent/80"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Participant list */}
                {participants.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {participants.map((name, i) => (
                      <div
                        key={name}
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
                          className="h-6 w-6 opacity-40 hover:opacity-100 hover:text-[#ef4444]"
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
