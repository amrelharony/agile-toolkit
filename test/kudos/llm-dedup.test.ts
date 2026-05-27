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

import { detectDuplicate } from "@/lib/kudos/llm/dedup";
import { getAdapter } from "@/lib/llm/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import type { Kudos } from "@/lib/stores/workspace-types";

function freshKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kud_${Math.random().toString(36).slice(2, 14)}`,
    theme: "thank-you",
    toName: "Alice",
    fromName: "Bob",
    message: "Thanks for the deploy help",
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("kudos/llm/dedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no BYOK key is configured", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await detectDuplicate({ candidate: freshKudos(), recent: [] });
    expect(result).toBeNull();
  });

  it("short-circuits to {isDup:false} when recent is empty (no LLM call)", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const result = await detectDuplicate({ candidate: freshKudos(), recent: [] });
    expect(result).toEqual({ isDup: false, similarity: 0 });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("returns the matched dupId when the model points at a real prior", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const prior = freshKudos({ id: "kud_priorxxxxxxxxx", message: "thanks for the deploy" });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk(`{"isDup":true,"dupId":"kud_priorxxxxxxxxx","similarity":0.88}`);
        return { inputTokens: 50, outputTokens: 20 };
      }),
    });
    const result = await detectDuplicate({
      candidate: freshKudos({ message: "appreciate the deploy" }),
      recent: [prior],
    });
    expect(result?.isDup).toBe(true);
    expect(result?.dupId).toBe("kud_priorxxxxxxxxx");
    expect(result?.similarity).toBeCloseTo(0.88, 2);
  });

  it("rejects a hallucinated dupId (id not in the pool)", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const prior = freshKudos({ id: "kud_realone" });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk(`{"isDup":true,"dupId":"kud_phantom","similarity":0.7}`);
        return { inputTokens: 50, outputTokens: 20 };
      }),
    });
    const result = await detectDuplicate({ candidate: freshKudos(), recent: [prior] });
    // With a phantom dupId we collapse isDup to false so the caller
    // doesn't stamp a non-existent group on the wall.
    expect(result?.isDup).toBe(false);
    expect(result?.dupId).toBeUndefined();
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
        throw new Error("billing limit");
      }),
    });
    const result = await detectDuplicate({
      candidate: freshKudos(),
      recent: [freshKudos({ id: "kud_a" })],
    });
    expect(result).toBeNull();
  });

  it("returns isDup:false when the model is honest about no match", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk(`{"isDup":false,"dupId":null,"similarity":0.12}`);
        return { inputTokens: 50, outputTokens: 20 };
      }),
    });
    const result = await detectDuplicate({
      candidate: freshKudos({ message: "Completely different topic" }),
      recent: [freshKudos({ id: "kud_other", message: "Thanks for the deploy" })],
    });
    expect(result?.isDup).toBe(false);
    expect(result?.similarity).toBeCloseTo(0.12, 2);
  });
});
