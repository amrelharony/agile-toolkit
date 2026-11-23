/**
 * Voice dictation: distinct, actionable copy per SpeechRecognition error code
 * (plain sentences, no dashes) and silence for benign ones; dictation that
 * adds to what was typed instead of replacing it; and the browser's own
 * language to listen for.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  FALLBACK_DICTATION_LANG,
  dictationLang,
  joinDictation,
  useVoiceInput,
  voiceErrorMessage,
} from "@/lib/agent/mascot/use-voice-input";

const CODES = [
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "network",
  "language-not-supported",
];

describe("voiceErrorMessage", () => {
  it("distinguishes a blocked mic from an unavailable speech service", () => {
    expect(voiceErrorMessage("not-allowed")).toMatch(/microphone access was blocked/i);
    expect(voiceErrorMessage("service-not-allowed")).toMatch(/unavailable/i);
    expect(voiceErrorMessage("not-allowed")).not.toBe(voiceErrorMessage("service-not-allowed"));
  });

  it("surfaces hardware, network and language failures", () => {
    expect(voiceErrorMessage("audio-capture")).toMatch(/no microphone/i);
    expect(voiceErrorMessage("network")).toMatch(/network/i);
    expect(voiceErrorMessage("language-not-supported")).toMatch(/language/i);
  });

  it("writes each message as plain sentences: no dashes, ending in a full stop", () => {
    for (const code of CODES) {
      const message = voiceErrorMessage(code)!;
      expect(message, code).not.toMatch(/[—–]| - /);
      expect(message, code).toMatch(/\.$/);
    }
  });

  it("stays silent (null) for benign or unknown codes", () => {
    expect(voiceErrorMessage("no-speech")).toBeNull();
    expect(voiceErrorMessage("aborted")).toBeNull();
    expect(voiceErrorMessage(undefined)).toBeNull();
    expect(voiceErrorMessage("something-unexpected")).toBeNull();
  });
});

describe("joinDictation", () => {
  it("adds what was heard after what was typed, with one space", () => {
    expect(joinDictation("Add to the retro:", "flaky CI")).toBe("Add to the retro: flaky CI");
    expect(joinDictation("Add to the retro:   ", "  flaky CI ")).toBe("Add to the retro: flaky CI");
  });

  it("starts the words on the box's new line when it ends with one", () => {
    expect(joinDictation("First point\n", "second point")).toBe("First point\nsecond point");
    expect(joinDictation("First point\n\n  ", "second")).toBe("First point\n\nsecond");
  });

  it("is just the words over an empty box, and leaves the box alone when nothing was heard", () => {
    expect(joinDictation("", "plan the sprint")).toBe("plan the sprint");
    expect(joinDictation("  \n", "plan the sprint")).toBe("plan the sprint");
    expect(joinDictation("Typed so far", "")).toBe("Typed so far");
    expect(joinDictation("Typed so far", "   ")).toBe("Typed so far");
  });

  it("replaces only its own words as they firm up: each result is joined to the same start", () => {
    const start = "Add to the retro:";
    const interim = joinDictation(start, "flaky");
    const final = joinDictation(start, "flaky CI builds");
    expect(interim).toBe("Add to the retro: flaky");
    expect(final).toBe("Add to the retro: flaky CI builds");
  });
});

/** A stand-in for the browser's SpeechRecognition, keeping the last one made. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = true;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
}

describe("the language dictation listens for", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    FakeRecognition.last = null;
  });

  it("is the browser's own, or en-US where it names none", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("ar-EG");
    expect(dictationLang()).toBe("ar-EG");
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    expect(dictationLang()).toBe(FALLBACK_DICTATION_LANG);
  });

  it("is what the recognition is set to when dictation starts", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useVoiceInput(() => {}));
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(FakeRecognition.last?.lang).toBe("fr-FR");
    expect(FakeRecognition.last?.start).toHaveBeenCalledTimes(1);
    expect(result.current.listening).toBe(true);
  });

  it("says why it stopped in plain words, and nothing for a pause", () => {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
    const { result } = renderHook(() => useVoiceInput(() => {}));
    act(() => result.current.start());
    act(() => FakeRecognition.last?.onerror?.({ error: "no-speech" }));
    expect(result.current.listening).toBe(false);
    expect(result.current.error).toBeNull();
    act(() => result.current.start());
    act(() => FakeRecognition.last?.onerror?.({ error: "not-allowed" }));
    expect(result.current.error).toBe(voiceErrorMessage("not-allowed"));
  });
});
