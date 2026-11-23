"use client";

/**
 * Voice dictation for the chat's composer via the Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). Feature-detected: where the
 * API is missing the hook reports `supported: false` and the caller hides the
 * mic. Interim + final transcripts stream to `onResult`, each time the whole
 * of what was heard since `start()` (the caller adds it to what was in the box
 * then, with joinDictation, so nothing typed is lost); recognition stops
 * itself on a pause (continuous = false), and we clean up on unmount.
 *
 * It listens in the browser's own language (navigator.language), so an
 * Arabic or a French browser dictates in Arabic or French; en-US where the
 * browser names none.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal structural types: the Web Speech API isn't in the TS DOM lib.
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent {
  results: SRResultList;
}
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The language dictation listens for when the browser names none. */
export const FALLBACK_DICTATION_LANG = "en-US";

/** The browser's own language, which dictation listens for. */
export function dictationLang(): string {
  return (typeof navigator !== "undefined" && navigator.language) || FALLBACK_DICTATION_LANG;
}

/**
 * Map a SpeechRecognition error code to an actionable user message, or null to
 * stay silent (`no-speech` and `aborted` are benign: the user just paused, or
 * the dictation was stopped). Plain sentences, no dashes. Exported for tests.
 */
export function voiceErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "not-allowed":
      return "Microphone access was blocked. Allow it for this site in your browser to dictate.";
    case "service-not-allowed":
      return "Speech recognition is unavailable. It may be turned off in your browser, or you're offline.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected and turned on.";
    case "network":
      return "Speech recognition couldn't reach the network. Check your connection and try again.";
    case "language-not-supported":
      return "Dictation doesn't work in this browser's language yet. Type the message instead.";
    default:
      return null;
  }
}

/**
 * The box's text with `heard` (what dictation has heard so far) added after
 * what was there when it started (`existing`), never in place of it: on a new
 * line when the box ends with one, else after one space. What was heard is
 * trimmed; nothing heard leaves the box as it was.
 */
export function joinDictation(existing: string, heard: string): string {
  const words = heard.trim();
  if (!words) return existing;
  if (!existing.trim()) return words;
  if (/\n[ \t]*$/.test(existing)) return existing.replace(/[ \t]+$/, "") + words;
  return `${existing.trimEnd()} ${words}`;
}

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  /** Set when recognition fails (e.g. mic permission blocked); null otherwise. */
  error: string | null;
  start(): void;
  stop(): void;
}

export function useVoiceInput(onResult: (text: string, isFinal: boolean) => void): VoiceInput {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const supported = getRecognitionCtor() !== null;

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
    },
    []
  );

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = dictationLang();
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: SREvent) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r && r[0]) text += r[0].transcript;
      }
      const last = e.results[e.results.length - 1];
      onResultRef.current(text, last?.isFinal ?? false);
    };
    const finish = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onend = finish;
    rec.onerror = (e) => {
      finish();
      const msg = voiceErrorMessage(e?.error);
      if (msg) setError(msg);
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      finish();
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
  }, []);

  return { supported, listening, error, start, stop };
}
