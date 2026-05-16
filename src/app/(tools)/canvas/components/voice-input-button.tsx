"use client";

/**
 * Voice input → sticky (Phase 33).
 *
 * Tap the mic button, dictate, and a sticky note with the transcript
 * appears at the centre of the current viewport. Built on the browser's
 * built-in Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
 * — no external service, no network cost, no API key.
 *
 * Browser support:
 *   - Chrome / Edge: ✅ full support
 *   - Safari 14.1+: ✅ behind `webkit` prefix
 *   - Firefox: ❌ no support — we fall back to a disabled-tooltip button
 *
 * UX rules:
 *   - Click once to start recording → button glows red + announces
 *     "Listening…" via aria-live.
 *   - Click again (or press Esc) to commit the current transcript as a
 *     sticky and stop recording.
 *   - Auto-stops on silence after ~2s — speech API fires `onend` and
 *     we commit whatever we got. If transcript is empty, no sticky.
 *
 * Why agile: retros and standups are the canonical "one person types
 * while everyone talks" scenario. Voice-to-sticky removes the bottleneck
 * — anyone can dictate their own card without context-switching.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WhiteboardObject, WhiteboardSticky } from "@/lib/stores/workspace-types";
import { emitSignal } from "@/lib/signals/signal-bus";
import { useCanvasStore } from "../use-canvas-store";

// The Web Speech API surface is two interfaces (`SpeechRecognition`
// and `SpeechRecognitionEvent`) that TypeScript's lib.dom only ships
// behind unstable flags. We declare a tiny structural type that
// captures only what we use — narrower than `any` and tolerant of the
// `webkit` prefix.
interface MinimalSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  // `resultIndex` is the index of the first result in this event that
  // is new since the previous `onresult` fire. We must use it as the
  // iteration start — iterating from 0 every time double-counts finals
  // in continuous mode.
  onresult: ((ev: {
    results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>>;
    resultIndex: number;
  }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
}

type SpeechRecognitionCtor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Stable, sufficiently-unique id generator. `Math.random().toString(36)
// .slice(2, 11)` can return as little as one character (when the random
// value happens to encode to a short base36 string) — collisions become
// statistically certain on a busy board. Prefer `crypto.randomUUID` and
// fall back to a timestamp-anchored hybrid that is always ≥ 16 chars.
// The random tail is padded so a short base36 encoding still produces
// a fixed-width id rather than a 9-char string that may collide.
function makeStickyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `wb_${crypto.randomUUID()}`;
  }
  return `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9).padEnd(7, "0")}`;
}

interface Props {
  /** Active board id — required to place the sticky on the right board. */
  boardId: string;
  /** Centre of the viewport in world coords — used as the drop point
   * so the sticky lands where the user is looking. Captured at the
   * moment the mic is tapped, NOT at commit time, so the sticky drops
   * where the user *was* looking rather than chasing the camera. */
  worldCenter: () => { x: number; y: number };
  /** When true, dictation is disabled (e.g. viewer / share-link mode). */
  readOnly?: boolean;
}

export function VoiceInputButton({ boardId, worldCenter, readOnly = false }: Props) {
  const upsert = useWorkspaceStore((s) => s.upsertWhiteboardObject);
  const setSelection = useCanvasStore((s) => s.setSelection);

  const [supported, setSupported] = useState(false);
  // `connecting` is the brief window between user-tap and the mic
  // actually opening (permission prompt + driver warm-up). We do NOT
  // claim "Listening" until the recognizer fires `onstart`.
  const [connecting, setConnecting] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  // React-tracked mirror of the live transcript so the `aria-live`
  // region actually re-renders when new finals arrive. Refs are not
  // observed by React, so screen readers never heard the original
  // ref-backed version.
  const [liveText, setLiveText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognizerRef = useRef<MinimalSpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  // Captured at start() time so commit lands where the user hit the
  // mic, not where they happen to be looking when onend fires.
  const startWorldRef = useRef<{ x: number; y: number } | null>(null);
  // The most recent `commitSticky` callback, refreshed on every render.
  // The recognizer's `onend` runs much later than the render that
  // installed it, so reading from a ref dodges the stale-closure trap
  // where `objects` / `stickyColor` / `worldCenter` snapshot at start().
  const commitStickyRef = useRef<(text: string) => boolean>(() => false);

  // Detect support on mount. The check runs on the client only (the
  // SSR pass would always return false).
  useEffect(() => {
    setSupported(!!getSpeechRecognitionCtor());
  }, []);

  // Commit the transcript as a sticky. Returns true if a sticky was
  // created (so the caller can flash a success indicator).
  const commitSticky = useCallback(
    (text: string): boolean => {
      // Cap to MAX_TEXT_LEN (matches the peer-validator ceiling in
      // diff-sync). Without this, a long dictation session would build
      // a sticky.content that exceeds the validator and silently
      // refuses to replicate — the sticky shows up locally but stays
      // invisible to peers, which feels broken.
      const trimmed = text.trim().slice(0, 50_000);
      if (!trimmed) return false;
      // Snapshot at recording-start, not commit-time. Falls back to
      // a fresh worldCenter() call if for some reason we don't have a
      // snapshot (defensive — shouldn't happen in normal flow).
      const drop = startWorldRef.current ?? worldCenter();
      const { x, y } = drop;
      const id = makeStickyId();
      const now = new Date().toISOString();
      // z above every existing object ON THIS BOARD so the sticky
      // lands on top of its peers — not above objects on other boards
      // (those z-values are irrelevant and inflating maxZ wastes
      // headroom).
      const objects = useWorkspaceStore.getState().whiteboardObjects;
      const stickyColor = useCanvasStore.getState().stickyColor;
      let maxZ = 0;
      for (const o of objects ?? []) {
        if (o.boardId === boardId && o.z > maxZ) maxZ = o.z;
      }
      const w = 220;
      const h = 180;
      const sticky: WhiteboardSticky = {
        id,
        boardId,
        type: "sticky",
        x: x - w / 2,
        y: y - h / 2,
        w,
        h,
        z: maxZ + 1,
        version: 1,
        content: trimmed,
        color: stickyColor,
        createdAt: now,
        updatedAt: now,
      };
      upsert(sticky as WhiteboardObject);
      setSelection([id]);
      // Cross-tool signal — activity log + AI insights consume this
      // to surface voice-dictated content alongside typed stickies.
      emitSignal({
        kind: "whiteboard.objectCreated",
        at: now,
        toolId: "canvas",
        payload: { boardId, objectId: id, objectType: "sticky", source: "voice" },
      });
      return true;
    },
    [worldCenter, boardId, upsert, setSelection],
  );

  // Keep the ref pointed at the latest commitSticky so the recognizer's
  // onend callback (installed once at start()) sees current state.
  useEffect(() => {
    commitStickyRef.current = commitSticky;
  }, [commitSticky]);

  const stop = useCallback(() => {
    const r = recognizerRef.current;
    if (r) {
      // Idempotent — the recognizer may already be in a terminal state
      // from a prior stop()/abort() or a natural onend.
      try { r.stop(); } catch { /* ignore — race with onend */ }
    }
  }, []);

  const start = useCallback(() => {
    if (readOnly) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice input not supported in this browser.");
      return;
    }
    setError(null);
    transcriptRef.current = "";
    setLiveText("");
    setInterim("");
    // Snapshot the drop point NOW. The user's mental model is "the
    // sticky drops where I hit the mic," not "wherever the viewport
    // ends up 30 seconds later."
    startWorldRef.current = worldCenter();
    const r = new Ctor();
    r.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    r.continuous = true;
    r.interimResults = true;
    // Rare driver issue: r.start() returns successfully but neither
    // onstart nor onerror ever fire (Chrome 126 on Linux Wayland with
    // PipeWire was a documented case). Without this timeout, the UI
    // sits at "Opening mic" forever and the only escape is a page
    // reload. Cleared in onstart / onerror so the happy path is
    // unaffected.
    const startTimer = setTimeout(() => {
      // Re-read state via the recognizer reference rather than the
      // captured `connecting`/`listening` (which would be stale by the
      // time the timer fires).
      if (recognizerRef.current === r) {
        setError("Microphone failed to open. Try again.");
        setConnecting(false);
        setListening(false);
        try { r.abort(); } catch { /* ignore */ }
        recognizerRef.current = null;
      }
    }, 5_000);
    r.onresult = (ev) => {
      // Speech API delivers an array of result groups; each group has
      // one or more alternatives. We always read the top alternative.
      // Start from `ev.resultIndex` so we never double-count finals
      // that we already absorbed on prior fires.
      let final = "";
      let live = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const group = ev.results[i];
        const top = group[0];
        if (!top) continue;
        if (top.isFinal) final += top.transcript;
        else live += top.transcript;
      }
      if (final) {
        transcriptRef.current += final;
        // Mirror into state so aria-live actually announces it.
        setLiveText(transcriptRef.current);
      }
      setInterim(live);
    };
    r.onstart = () => {
      // Mic is actually open now — promote connecting → listening.
      clearTimeout(startTimer);
      setConnecting(false);
      setListening(true);
    };
    r.onerror = (e) => {
      clearTimeout(startTimer);
      const msg = e.error === "not-allowed"
        ? "Microphone permission denied."
        : e.error === "no-speech"
          ? "No speech detected."
          : `Voice input error${e.message ? `: ${e.message}` : ""}.`;
      setError(msg);
      // Clear both, since onerror can fire before onstart promotes us.
      setConnecting(false);
      setListening(false);
    };
    r.onend = () => {
      clearTimeout(startTimer);
      setConnecting(false);
      setListening(false);
      // Commit the accumulated FINAL transcript only. Read fresh state
      // via the ref — the closure-captured `commitSticky` at install
      // time may be stale by now.
      commitStickyRef.current(transcriptRef.current);
      transcriptRef.current = "";
      setLiveText("");
      setInterim("");
      startWorldRef.current = null;
      recognizerRef.current = null;
    };
    // Flip connecting BEFORE start() so the UI shows feedback during
    // the permission prompt. Do NOT flip listening yet — onstart will.
    setConnecting(true);
    try {
      r.start();
      // Only adopt the recognizer if start() didn't throw — otherwise
      // a rapid double-click leaves a stale reference behind.
      recognizerRef.current = r;
    } catch (err) {
      // start() can throw if called while already running on some
      // browsers, or if the user denied permission previously.
      clearTimeout(startTimer);
      recognizerRef.current = null;
      setConnecting(false);
      setListening(false);
      setError(err instanceof Error ? err.message : "Voice input failed to start.");
    }
  }, [readOnly, worldCenter]);

  // Esc key cancels and commits whatever we have. Bubble phase so that
  // any open modal / inline editor / form field gets first shot at the
  // key — voice input is a passive overlay and shouldn't pre-empt the
  // user's text-input dismissal flow. (Capture-phase Esc here was
  // closing voice recording even when the user was trying to clear an
  // IME composition in a comment textarea.)
  useEffect(() => {
    if (!listening && !connecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      // stopPropagation only after deciding to act — avoids fighting
      // stacked overlays in capture order.
      e.stopPropagation();
      stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, connecting, stop]);

  // Stop the recognizer on unmount to avoid leaking an active mic
  // session if the user navigates away mid-recording. Critically, we
  // null out the handlers BEFORE aborting — abort() still fires onend
  // synchronously on some engines, and that handler closes over the
  // old `boardId`, which would commit a phantom sticky on the wrong
  // board.
  useEffect(() => {
    return () => {
      const r = recognizerRef.current;
      recognizerRef.current = null;
      if (r) {
        r.onresult = null;
        r.onstart = null;
        r.onend = null;
        r.onerror = null;
        try { r.abort(); } catch { /* ignore */ }
      }
    };
  }, []);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice input is not supported in this browser (try Chrome, Edge, or Safari)."
        className="inline-flex items-center justify-center w-8 h-8 rounded text-sub/40 cursor-not-allowed"
        aria-label="Voice input (not supported)"
        data-canvas-export-ignore="true"
      >
        <MicOff className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }

  if (readOnly) {
    return (
      <button
        type="button"
        disabled
        title="View-only — voice input disabled."
        className="inline-flex items-center justify-center w-8 h-8 rounded text-sub/40 cursor-not-allowed"
        aria-label="Voice input (view-only)"
        data-canvas-export-ignore="true"
      >
        <Mic className="w-4 h-4" aria-hidden="true" />
      </button>
    );
  }

  const active = listening || connecting;

  return (
    <>
      <button
        type="button"
        onClick={() => (active ? stop() : start())}
        title={
          connecting
            ? "Opening microphone…"
            : listening
              ? "Stop dictating — Esc also commits"
              : "Dictate a sticky note"
        }
        aria-label={active ? "Stop voice input" : "Start voice input"}
        aria-pressed={active}
        aria-busy={connecting}
        className={`inline-flex items-center justify-center w-8 h-8 rounded transition-colors ${
          listening
            ? "bg-red-500/20 text-red-300 ring-2 ring-red-500/60 animate-pulse"
            : connecting
              ? "bg-amber-500/20 text-amber-300 ring-2 ring-amber-500/60"
              : "text-sub hover:text-text hover:bg-surface-deep"
        }`}
        data-canvas-export-ignore="true"
      >
        <Mic className="w-4 h-4" aria-hidden="true" />
      </button>
      {/* aria-live region announces transcript progress for screen readers. */}
      <span className="sr-only" role="status" aria-live="polite">
        {connecting ? "Opening microphone." : listening ? `Listening: ${liveText}${interim ? " " + interim : ""}` : ""}
      </span>
      {active && (
        <div
          // z-[9999] (not z-50) so the listening indicator stays
          // visible while a card-detail modal or comment drawer is
          // open — those use z-[9999]. An open mic is sensitive
          // state; hiding it behind a modal makes users forget they
          // are still recording.
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-surface border border-red-400/40 rounded-full px-4 py-2 shadow-xl flex items-center gap-2 max-w-[80vw]"
          data-canvas-export-ignore="true"
        >
          {/* Distinct animation per state so users can tell at a glance
              whether the mic is actively listening (steady pulse) vs.
              still opening the mic (ping ripple). Sharing the pulse
              between both states made the amber-connecting dot
              indistinguishable from the red-listening dot. */}
          <span
            className={`w-2 h-2 rounded-full ${listening ? "bg-red-500 animate-pulse" : "bg-amber-400 animate-ping"}`}
            aria-hidden="true"
          />
          <span className="text-xs text-red-200 font-mono uppercase tracking-wider">
            {connecting ? "Opening mic" : "Listening"}
          </span>
          <span className="text-xs text-text truncate max-w-[60vw]">
            {liveText}
            {interim && <span className="text-sub italic"> {interim}</span>}
          </span>
          <button
            type="button"
            onClick={stop}
            className="text-[10px] uppercase font-mono text-sub hover:text-text ml-1"
          >
            Stop
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-amber-400/40 rounded-full px-4 py-2 shadow-xl"
          data-canvas-export-ignore="true"
        >
          <span className="text-xs text-amber-200">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[10px] uppercase font-mono text-sub hover:text-text ml-2"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
