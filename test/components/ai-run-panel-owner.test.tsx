/**
 * Run with AI for the signed-in owner with no personal key: the AI Prompts
 * drawer's run panel asks the owner route's prompt.run and shows the text as
 * it streams in. A visitor with no key sees no change (Run stays off), and a
 * personal key keeps today's own-key run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
  adapterCall: vi.fn(),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

// The personal-key run's adapter, so nothing leaves the machine.
vi.mock("@/lib/llm/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/registry")>();
  return {
    ...actual,
    getAdapter: async (id: string) => ({
      id,
      models: [],
      defaultModelId: "test-model",
      call: h.adapterCall,
      testKey: async () => {},
    }),
  };
});

import AiRunPanel from "@/components/shared/ai-run-panel";
import { TOOL_AI_ERROR_TEXT } from "@/lib/ai/contract";
import { PROVIDER_META } from "@/lib/llm/registry";
import { useLlmStore } from "@/lib/stores/llm-store";

const enc = new TextEncoder();

function textStream(parts: string[], ending?: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(`data: ${JSON.stringify({ text: p })}\n\n`));
      if (ending) c.enqueue(enc.encode(`data: ${JSON.stringify({ error: ending })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.auth = { status: "authenticated", user: { id: "owner-1" } };
  h.adapterCall.mockReset();
  h.adapterCall.mockImplementation(async (params: { onChunk: (t: string) => void }) => {
    params.onChunk("Own key answer.");
    return { inputTokens: 10, outputTokens: 4 };
  });
  useLlmStore.setState({ activeProvider: null, providers: {} });
  fetchMock = vi.fn(async () => textStream(["Three themes ", "stood out."]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  useLlmStore.setState({ activeProvider: null, providers: {} });
  window.localStorage.removeItem("agile-toolkit:llm");
  vi.unstubAllGlobals();
});

describe("AiRunPanel for the owner without a personal key", () => {
  it("runs on the owner's gateway and shows the streamed text", async () => {
    const onResult = vi.fn();
    render(<AiRunPanel prompt="Summarise this retro." toolName="Retro" onResult={onResult} />);
    expect(screen.getByText("Amr's AI")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Three themes stood out.")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/tool");
    expect(JSON.parse(init.body as string)).toEqual({
      task: "prompt.run",
      input: { prompt: "Summarise this retro.", toolName: "Retro" },
    });
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        text: "Three themes stood out.",
        usage: { inputTokens: -1, outputTokens: -1 },
      })
    );
  });

  it("says when the answer stopped early", async () => {
    fetchMock.mockImplementation(async () => textStream(["Partial"], "time_limit"));
    render(<AiRunPanel prompt="Summarise this retro." toolName="Retro" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(
      await screen.findByText("The answer stopped early. Run it again for the rest.")
    ).toBeInTheDocument();
  });

  it("shows the route's refusal in plain words", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })
    );
    render(<AiRunPanel prompt="Summarise this retro." toolName="Retro" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(TOOL_AI_ERROR_TEXT.rate_limited)).toBeInTheDocument();
  });

  it("refuses a prompt over the limit without sending it", async () => {
    render(<AiRunPanel prompt={"x".repeat(24_001)} toolName="Retro" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/longer than Amr's AI takes/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AiRunPanel for a visitor without a key", () => {
  it("is unchanged: Run stays off and nothing is sent", () => {
    h.auth = null;
    render(<AiRunPanel prompt="Summarise this retro." toolName="Retro" />);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.queryByText("Amr's AI")).toBeNull();
  });
});

describe("AiRunPanel for the owner with a personal key", () => {
  it("keeps today's own-key run: the key's provider, never the owner route", async () => {
    useLlmStore.setState({
      activeProvider: "openai",
      providers: { openai: { apiKey: "placeholder-not-a-key", model: "test-model" } },
    });
    const onResult = vi.fn();
    render(<AiRunPanel prompt="Summarise this retro." toolName="Retro" onResult={onResult} />);
    expect(screen.queryByText("Amr's AI")).toBeNull();
    expect(screen.getByText(PROVIDER_META.openai.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Own key answer.")).toBeInTheDocument();
    expect(h.adapterCall).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/ai/tool")).toBe(false);
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        text: "Own key answer.",
        usage: { inputTokens: 10, outputTokens: 4 },
      })
    );
  });
});
