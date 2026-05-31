"use client";

/**
 * Voice dictation for the agent composer via the Web Speech API
 * (SpeechRecognition / webkitSpeechRecognition). Feature-detected: where the
 * API is missing the hook reports `supported: false` and the caller hides the
 * mic. Interim + final transcripts stream to `onResult`; recognition stops
 * itself on a pause (continuous = false), and we clean up on unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal structural types — the Web Speech API isn't in the TS DOM lib.
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
  onerror: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInput {
  supported: boolean;
  listening: boolean;
  start(): void;
  stop(): void;
}

export function useVoiceInput(onResult: (text: string, isFinal: boolean) => void): VoiceInput {
  const [listening, setListening] = useState(false);
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
    rec.lang = "en-US";
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
    rec.onerror = finish;
    recRef.current = rec;
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

  return { supported, listening, start, stop };
}
