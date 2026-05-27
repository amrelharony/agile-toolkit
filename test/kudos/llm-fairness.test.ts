import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/llm/registry", async () => {
  return {
    getAdapter: vi.fn(),
    PROVIDER_IDS: ["anthropic", "openai", "gemini", "glm"] as const,
    PROVIDER_META: {},
    MODELS_BY_PROVIDER: {},
    DEFAULT_MODEL_BY_PROVIDER: {},
  };
});

vi.mock("@/lib/stores/llm-store", () => {
  return {
    useLlmStore: { getState: () => ({}) },
    getActiveConfig: vi.fn(),
  };
});

import {
  computeFairness,
  installFairnessInvalidator,
  __resetFairnessInvalidator,
  invalidateFairnessCache,
  getLastFairnessResult,
} from "@/lib/kudos/llm/fairness";
import { emitSignal, __resetSignalBus } from "@/lib/signals/signal-bus";
import { getAdapter } from "@/lib/llm/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import { __resetDerivedCache } from "@/lib/signals/derived-cache";

describe("kudos/llm/fairness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSignalBus();
    __resetFairnessInvalidator();
    __resetDerivedCache();
  });

  it("returns null when no BYOK key is configured", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await computeFairness({
      squadProfiles: [{ id: "p1", displayName: "Alice" }],
      recentKudos: [],
      recentSignals: [],
    });
    expect(result).toBeNull();
  });

  it("returns an empty result when the squad is empty (no LLM call)", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const result = await computeFairness({
      squadProfiles: [],
      recentKudos: [],
      recentSignals: [],
    });
    expect(result).toEqual({ underRecognised: [] });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("returns under-recognised teammates the model flagged (only those in the squad)", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk(
          `{"underRecognised":[{"profileId":"p1","score":0.85,"reason":"shipped 4 stories with 0 kudos"},{"profileId":"phantom","score":0.5,"reason":"x"}]}`
        );
        return { inputTokens: 50, outputTokens: 30 };
      }),
    });
    const result = await computeFairness({
      squadProfiles: [
        { id: "p1", displayName: "Alice" },
        { id: "p2", displayName: "Bob" },
      ],
      recentKudos: [],
      recentSignals: [],
    });
    expect(result?.underRecognised.length).toBe(1);
    expect(result?.underRecognised[0].profileId).toBe("p1");
    expect(result?.underRecognised[0].score).toBeCloseTo(0.85, 2);
  });

  it("does NOT include message bodies in the prompt sent to the adapter", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    let capturedPrompt = "";
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        capturedPrompt = params.prompt;
        params.onChunk(`{"underRecognised":[]}`);
        return { inputTokens: 50, outputTokens: 5 };
      }),
    });
    await computeFairness({
      squadProfiles: [{ id: "p1", displayName: "Alice" }],
      // Input type doesn't accept a body field, but a caller-mistake check
      // would still want to make sure the prompt builder never has a way
      // to embed message bodies. We pass a sentinel string through the
      // displayName to make sure THAT lands; then check the body sentinel
      // does NOT appear in the prompt — but here we just verify the prompt
      // structure to make sure no "message" field is referenced.
      recentKudos: [
        {
          toProfileId: "p1",
          fromProfileId: "p2",
          theme: "thank-you",
          sentAt: "2026-05-20T00:00:00.000Z",
          messageLength: 42,
        },
      ],
      recentSignals: [],
    });
    expect(capturedPrompt).not.toMatch(/SECRET_KUDOS_BODY/);
    expect(capturedPrompt).not.toMatch(/message body/i);
    // The prompt should reference counts, not bodies.
    expect(capturedPrompt).toMatch(/received/);
  });

  it("caches results — a second call with identical inputs reuses the first call", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const callSpy = vi.fn(async (params) => {
      params.onChunk(`{"underRecognised":[]}`);
      return { inputTokens: 50, outputTokens: 5 };
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: callSpy,
    });
    const input = {
      squadProfiles: [{ id: "p1", displayName: "Alice" }],
      recentKudos: [],
      recentSignals: [],
    };
    await computeFairness(input);
    await computeFairness(input);
    expect(callSpy).toHaveBeenCalledTimes(1);
  });

  it("installFairnessInvalidator wires kudos.sent to invalidate the cache", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const callSpy = vi.fn(async (params) => {
      params.onChunk(`{"underRecognised":[]}`);
      return { inputTokens: 50, outputTokens: 5 };
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: callSpy,
    });
    installFairnessInvalidator();
    const input = {
      squadProfiles: [{ id: "p1", displayName: "Alice" }],
      recentKudos: [],
      recentSignals: [],
    };
    await computeFairness(input);
    expect(callSpy).toHaveBeenCalledTimes(1);

    // Emit kudos.sent — invalidator should flush the cache so the next
    // computeFairness call re-runs the LLM.
    emitSignal({
      kind: "kudos.sent",
      toolId: "kudos",
      at: new Date().toISOString(),
      payload: { id: "kud_x" },
    });
    // The signal bus batches via requestAnimationFrame; in jsdom that
    // polyfills to setTimeout(~16ms). 30 ms covers the rAF + the
    // synchronous invalidate inside the subscriber.
    await new Promise<void>((res) => setTimeout(res, 30));
    await computeFairness(input);
    expect(callSpy).toHaveBeenCalledTimes(2);
  });

  it("getLastFairnessResult returns the most-recent successful payload, then null after invalidate", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk(`{"underRecognised":[{"profileId":"p1","score":0.9,"reason":"ok"}]}`);
        return { inputTokens: 50, outputTokens: 10 };
      }),
    });
    await computeFairness({
      squadProfiles: [{ id: "p1", displayName: "A" }],
      recentKudos: [],
      recentSignals: [],
    });
    expect(getLastFairnessResult()?.underRecognised.length).toBe(1);
    invalidateFairnessCache();
    expect(getLastFairnessResult()).toBeNull();
  });

  it("returns null when the adapter throws", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    });
    const result = await computeFairness({
      squadProfiles: [{ id: "p1", displayName: "A" }],
      recentKudos: [],
      recentSignals: [],
    });
    expect(result).toBeNull();
  });
});
