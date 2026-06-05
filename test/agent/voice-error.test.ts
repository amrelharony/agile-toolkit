/**
 * Voice dictation error messages — distinct, actionable copy per SpeechRecognition
 * error code, and silence for benign ones.
 */

import { describe, it, expect } from "vitest";
import { voiceErrorMessage } from "@/lib/agent/mascot/use-voice-input";

describe("voiceErrorMessage", () => {
  it("distinguishes a blocked mic from an unavailable speech service", () => {
    expect(voiceErrorMessage("not-allowed")).toMatch(/microphone access was blocked/i);
    expect(voiceErrorMessage("service-not-allowed")).toMatch(/unavailable/i);
    expect(voiceErrorMessage("not-allowed")).not.toBe(voiceErrorMessage("service-not-allowed"));
  });

  it("surfaces hardware and network failures", () => {
    expect(voiceErrorMessage("audio-capture")).toMatch(/no microphone/i);
    expect(voiceErrorMessage("network")).toMatch(/network/i);
  });

  it("stays silent (null) for benign or unknown codes", () => {
    expect(voiceErrorMessage("no-speech")).toBeNull();
    expect(voiceErrorMessage("aborted")).toBeNull();
    expect(voiceErrorMessage(undefined)).toBeNull();
    expect(voiceErrorMessage("something-unexpected")).toBeNull();
  });
});
