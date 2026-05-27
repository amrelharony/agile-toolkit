import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The sentiment module dynamically imports the LLM adapter via the
// registry, so we stub the registry module ENTIRELY before importing
// the helper. The vi.mock factory runs before module loading, so the
// test never touches a real provider adapter.
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

import { analyseSentiment } from "@/lib/kudos/llm/sentiment";
import { getAdapter } from "@/lib/llm/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";

describe("kudos/llm/sentiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no BYOK key is configured", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const result = await analyseSentiment({ message: "great job", theme: "awesome" });
    expect(result).toBeNull();
    // Should never even reach the adapter call.
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("parses a well-formed JSON response into a KudosSentiment", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const adapterCall = vi.fn(async (params) => {
      params.onChunk('{"label":"positive","confidence":0.92,"tone":["grateful","warm"]}');
      return { inputTokens: 10, outputTokens: 20 };
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: adapterCall,
    });
    const result = await analyseSentiment({
      message: "Thanks for the thorough review yesterday — it caught the off-by-one I'd missed.",
      theme: "thank-you",
    });
    expect(result).toEqual({
      label: "positive",
      confidence: 0.92,
      tone: ["grateful", "warm"],
    });
  });

  it("recognises a backhanded message by label", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk('{"label":"backhanded","confidence":0.8,"tone":["sarcastic"]}');
        return { inputTokens: 10, outputTokens: 20 };
      }),
    });
    const result = await analyseSentiment({ message: "Thanks I guess", theme: "thank-you" });
    expect(result?.label).toBe("backhanded");
  });

  it("returns null on a malformed (non-JSON) response", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk("hello there I am a chatty model not following instructions");
        return { inputTokens: 10, outputTokens: 5 };
      }),
    });
    const result = await analyseSentiment({ message: "great", theme: "awesome" });
    expect(result).toBeNull();
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
        throw new Error("network down");
      }),
    });
    const result = await analyseSentiment({ message: "great job", theme: "awesome" });
    expect(result).toBeNull();
  });

  it("rejects an invalid label (unknown enum value)", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk('{"label":"angry","confidence":0.9,"tone":[]}');
        return { inputTokens: 10, outputTokens: 5 };
      }),
    });
    const result = await analyseSentiment({ message: "ok", theme: "awesome" });
    expect(result).toBeNull();
  });

  it("tolerates a markdown-fenced response", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        params.onChunk('```json\n{"label":"neutral","confidence":0.5,"tone":["calm"]}\n```');
        return { inputTokens: 10, outputTokens: 5 };
      }),
    });
    const result = await analyseSentiment({ message: "ok thanks", theme: "thank-you" });
    expect(result?.label).toBe("neutral");
    expect(result?.tone).toEqual(["calm"]);
  });

  it("caps the message at 1000 chars before prompting the model", async () => {
    (getActiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-haiku-4-5",
    });
    const longMessage = "x".repeat(5000);
    let capturedPrompt = "";
    (getAdapter as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "anthropic",
      call: vi.fn(async (params) => {
        capturedPrompt = params.prompt;
        params.onChunk('{"label":"neutral","confidence":0.5,"tone":[]}');
        return { inputTokens: 10, outputTokens: 5 };
      }),
    });
    await analyseSentiment({ message: longMessage, theme: "awesome" });
    // The original message had 5000 chars; the prompt should NOT contain
    // all of them — the helper slices to 1000 before embedding. Count
    // 'x' only inside the <message>…</message> tags so unrelated 'x'
    // chars in the template ("exact fields") don't skew the assertion.
    const messageMatch = capturedPrompt.match(/<message>([\s\S]*?)<\/message>/);
    const body = messageMatch ? messageMatch[1] : "";
    const xCount = (body.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThanOrEqual(1000);
  });
});
