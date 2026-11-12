import { afterEach, describe, expect, it, vi } from "vitest";
import { flashTitle, playChime, vibrate } from "@/lib/celebrate/chime";
import * as alarm from "@/app/(tools)/ceremony-timer/alarm";

/**
 * The time's-up signals moved out of the Ceremony Timer into lib/celebrate so
 * every timer sounds the same. The timer still imports them from "./alarm",
 * which hands over these very functions.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { AudioContext?: unknown }).AudioContext;
});

/** A stand-in AudioContext that records what it was asked to play. */
function fakeAudio() {
  const started: number[] = [];
  const closed = vi.fn(async () => {});
  const param = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  class FakeContext {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: "",
        frequency: param(),
        connect: vi.fn(),
        start: (at: number) => started.push(at),
        stop: vi.fn(),
      };
    }
    createGain() {
      return { gain: param(), connect: vi.fn() };
    }
    close = closed;
  }
  (window as { AudioContext?: unknown }).AudioContext = FakeContext;
  return { started, closed };
}

describe("the Ceremony Timer's alarm", () => {
  it("is the shared chime, buzz and flashing title", () => {
    expect(alarm.playChime).toBe(playChime);
    expect(alarm.vibrate).toBe(vibrate);
    expect(alarm.flashTitle).toBe(flashTitle);
  });
});

describe("playChime", () => {
  it("plays the beeps 0.3 s apart on a fresh context, then closes it", () => {
    vi.useFakeTimers();
    const audio = fakeAudio();
    playChime(3);
    expect(audio.started).toEqual([0, 0.3, 0.6]);
    expect(audio.closed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * 300 + 250);
    expect(audio.closed).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the browser has no audio", () => {
    expect(() => playChime()).not.toThrow();
  });
});

describe("vibrate", () => {
  it("buzzes the pattern where phones support it, and is quiet elsewhere", () => {
    const buzz = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate: buzz });
    vibrate([100, 50, 100]);
    expect(buzz).toHaveBeenCalledWith([100, 50, 100]);
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined });
    expect(() => vibrate()).not.toThrow();
  });
});

describe("flashTitle", () => {
  it("says time's up in the tab title, then puts it back after five seconds", () => {
    vi.useFakeTimers();
    document.title = "Ceremony Timer";
    flashTitle("Time's up");
    expect(document.title).toBe("⏰ Time's up — Agile Toolkit");
    vi.advanceTimersByTime(5000);
    expect(document.title).toBe("Ceremony Timer");
  });

  it("puts it back as soon as the tab gets focus", () => {
    vi.useFakeTimers();
    document.title = "Facilitator Timers";
    flashTitle("Break over");
    window.dispatchEvent(new Event("focus"));
    expect(document.title).toBe("Facilitator Timers");
  });
});
