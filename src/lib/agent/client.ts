"use client";

import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import { useAgentStore } from "./store";
import { buildSystemPrompt } from "./system-prompt";
import { executeToolUse } from "./execute-tool";
import { appendMessages } from "./persist";
import type {
  ChatMessage,
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "./types";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOOL_USE_ROUNDS = 10;

interface StreamOptions {
  userId: string;
  toolId?: string | null;
  /** When provided, the client persists every new message into this
   *  conversation. When omitted, messages stay local. */
  conversationId?: string | null;
  /** Cancellation handle for long-running streams. */
  signal?: AbortSignal;
}

/**
 * Send a user message and drive the tool-use loop until Claude stops.
 *
 * Streaming path:
 *   1. Decide server-proxy vs BYOK by probing /api/agent/stream (GET).
 *   2. Build the messages array + tools from the registry.
 *   3. Open SSE. Accumulate text into the assistant message; capture
 *      tool_use blocks.
 *   4. On stop_reason="tool_use", execute each tool (via executeToolUse),
 *      append the tool_result message, and loop.
 *   5. Stop on stop_reason ∈ {"end_turn","max_tokens","stop_sequence"}
 *      or after MAX_TOOL_USE_ROUNDS iterations.
 *
 * UI integration: writes go through `useAgentStore` so the conversation
 * view re-renders on every chunk and tool-use.
 */
export async function sendUserMessage(
  text: string,
  opts: StreamOptions
): Promise<void> {
  const store = useAgentStore.getState();

  // Append the user's message immediately so the UI shows it.
  const userMsg: ChatMessage = {
    id: msgId(),
    role: "user",
    content: [{ type: "text", text }],
    createdAt: new Date().toISOString(),
  };
  store.appendMessage(userMsg);
  store.setError(null);
  store.setStreaming(true);

  // Background-persist the user message (don't block on it).
  if (opts.conversationId) void appendMessages(opts.conversationId, [userMsg]);

  try {
    await runToolUseLoop(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setError(msg);
  } finally {
    useAgentStore.getState().setStreaming(false);
  }
}

async function runToolUseLoop(opts: StreamOptions): Promise<void> {
  const mode = await detectMode();
  const tools = registry.toClaudeTools();
  const system = buildSystemPrompt({ toolId: opts.toolId ?? null });

  for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
    const messages = wireMessages(useAgentStore.getState().messages);
    const body = {
      model: defaultModel(),
      max_tokens: 4096,
      stream: true,
      system,
      tools,
      messages,
    };

    const stopReason = await openOneClaudeTurn(mode, body, opts.signal);

    if (stopReason !== "tool_use") return;

    // Pick up the assistant's tool_use blocks from the just-appended message.
    const lastAssistant = useAgentStore
      .getState()
      .messages.slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const toolUses = lastAssistant.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
    if (toolUses.length === 0) return;

    // Execute each tool_use in order, accumulating results as a single
    // tool-role message (Anthropic groups them in one turn).
    const results: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      const result = await executeToolUse(tu, {
        userId: opts.userId,
        confirm: makeConfirmHandler(tu),
        autoApprove: useAgentStore.getState().autoApprove,
      });
      results.push(result);
    }
    const toolMsg: ChatMessage = {
      id: msgId(),
      role: "tool",
      content: results,
      createdAt: new Date().toISOString(),
    };
    useAgentStore.getState().appendMessage(toolMsg);
    if (opts.conversationId) void appendMessages(opts.conversationId, [toolMsg]);
  }

  // Round budget exhausted. Do ONE final no-tools turn so Claude can
  // wrap up with a summary of what it accomplished + what's pending,
  // instead of leaving the conversation mid-stream with a bare tool
  // result. Caps the total cost at MAX+1 turns.
  try {
    const messages = wireMessages(useAgentStore.getState().messages);
    await openOneClaudeTurn(
      mode,
      {
        model: defaultModel(),
        max_tokens: 1024,
        stream: true,
        system: `${system}\n\nIMPORTANT: You have exhausted the tool-use round budget for this turn. Summarise what you accomplished, what failed, and what remains — do NOT request more tools.`,
        // No tools — Claude can only produce text.
        messages,
      },
      opts.signal
    );
  } catch {
    /* best-effort wrap-up; if it fails, the user still sees prior turns */
  }
  useAgentStore.getState().setError("Reached tool-use round limit (10). Send a follow-up if more is needed.");
}

/**
 * Open one Claude turn over SSE, accumulate text + tool_use blocks into
 * an assistant message in the store, and return the stop_reason.
 */
async function openOneClaudeTurn(
  mode: "server" | "client",
  body: Record<string, unknown>,
  signal: AbortSignal | undefined
): Promise<string> {
  const response = await openStream(mode, body, signal);
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`agent stream failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  // Start a fresh assistant message — we'll fill its content as deltas
  // arrive. The store provides patchLastAssistant for this.
  const assistantMsg: ChatMessage = {
    id: msgId(),
    role: "assistant",
    content: [],
    createdAt: new Date().toISOString(),
  };
  useAgentStore.getState().appendMessage(assistantMsg);

  // Anthropic SSE parser. We maintain `blocks[index]` for each
  // content_block_start, then append text deltas / accumulate tool_use
  // input_json deltas, and finalise on content_block_stop.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stopReason = "end_turn";

  type WipBlock =
    | { kind: "text"; text: string }
    | { kind: "tool_use"; id: string; name: string; jsonAccum: string };
  const wip = new Map<number, WipBlock>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalise CRLF → LF: some HTTP proxies (corporate, certain
    // Cloudflare modes) rewrite the SSE event separator to \r\n\r\n,
    // which the prior `indexOf("\n\n")` parser missed entirely.
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let nl: number;
    while ((nl = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      handleSseChunk(chunk, wip, (sr) => (stopReason = sr));
      flushAssistant(wip);
    }
  }
  flushAssistant(wip);
  return stopReason;
}

function handleSseChunk(
  raw: string,
  wip: Map<number, { kind: "text"; text: string } | { kind: "tool_use"; id: string; name: string; jsonAccum: string }>,
  onStop: (reason: string) => void
): void {
  // Each SSE chunk is N lines beginning with `event:` and `data:`.
  let dataLine = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      dataLine = line.slice(5).trim();
    }
  }
  if (!dataLine) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return;
  }
  const type = payload.type as string;
  const index = (payload.index as number) ?? 0;

  if (type === "content_block_start") {
    const cb = payload.content_block as Record<string, unknown> | undefined;
    if (!cb) return;
    if (cb.type === "text") {
      wip.set(index, { kind: "text", text: "" });
    } else if (cb.type === "tool_use") {
      wip.set(index, {
        kind: "tool_use",
        id: cb.id as string,
        name: cb.name as string,
        jsonAccum: "",
      });
    }
  } else if (type === "content_block_delta") {
    const block = wip.get(index);
    if (!block) return;
    const delta = payload.delta as Record<string, unknown> | undefined;
    if (!delta) return;
    if (block.kind === "text" && delta.type === "text_delta") {
      block.text += String(delta.text ?? "");
    } else if (block.kind === "tool_use" && delta.type === "input_json_delta") {
      block.jsonAccum += String(delta.partial_json ?? "");
    }
  } else if (type === "content_block_stop") {
    // No-op — we already track partial state by index.
  } else if (type === "message_delta") {
    const delta = payload.delta as Record<string, unknown> | undefined;
    const sr = delta?.stop_reason as string | undefined;
    if (sr) onStop(sr);
  }
}

function flushAssistant(
  wip: Map<number, { kind: "text"; text: string } | { kind: "tool_use"; id: string; name: string; jsonAccum: string }>
): void {
  const content: ContentBlock[] = [];
  const indices = Array.from(wip.keys()).sort((a, b) => a - b);
  for (const i of indices) {
    const block = wip.get(i);
    if (!block) continue;
    if (block.kind === "text") {
      content.push({ type: "text", text: block.text });
    } else {
      // tool_use: parse the accumulated input JSON if possible.
      let input: Record<string, unknown> = {};
      if (block.jsonAccum) {
        try {
          input = JSON.parse(block.jsonAccum);
        } catch {
          // Likely mid-stream — render with the partial JSON in the input.
          input = { _partial: block.jsonAccum };
        }
      }
      content.push({ type: "tool_use", id: block.id, name: block.name, input });
    }
  }
  useAgentStore.getState().patchLastAssistant(content);
}

async function openStream(
  mode: "server" | "client",
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  if (mode === "server") {
    return fetch("/api/agent/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }
  const cfg = getActiveConfig();
  if (!cfg || cfg.provider !== "anthropic") {
    throw new Error(
      "No Anthropic API key available. Configure one in AI Settings (BYOK) or set ANTHROPIC_API_KEY on the server."
    );
  }
  return fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ ...body, model: cfg.model }),
    signal,
  });
}

/**
 * Probe the server route to learn which transport to use.
 * Cached for the session; flips when ANTHROPIC_API_KEY changes on the
 * server you'd need a full page reload anyway.
 */
let cachedMode: "server" | "client" | null = null;
async function detectMode(): Promise<"server" | "client"> {
  if (cachedMode) return cachedMode;
  try {
    const res = await fetch("/api/agent/stream", { method: "GET" });
    if (res.ok) {
      const json = (await res.json()) as { mode?: string };
      cachedMode = json.mode === "server" ? "server" : "client";
    } else {
      cachedMode = "client";
    }
  } catch {
    cachedMode = "client";
  }
  return cachedMode;
}

function defaultModel(): string {
  const cfg = getActiveConfig();
  if (cfg?.provider === "anthropic") return cfg.model;
  // Server-side default (overridable in the route handler too).
  return "claude-opus-4-7";
}

/**
 * Map our internal ChatMessage[] to Anthropic's wire format:
 *   - role "tool" → role "user" with tool_result blocks
 *     (Anthropic doesn't have a "tool" role; tool results ride as user msgs)
 *   - role "user" stays user
 *   - role "assistant" stays assistant
 *   - id/createdAt are dropped (Anthropic doesn't want them)
 */
function wireMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: ContentBlock[] }> {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "user", content: m.content };
    }
    if (m.role === "assistant") {
      // tool_use names should be in Anthropic format (underscores). Stored
      // names already are (the streaming parser captures whatever the model
      // emitted), so this is a no-op safeguard against future drift.
      const content = m.content.map((c) =>
        c.type === "tool_use" ? { ...c, name: claudeNameFromId(c.name) } : c
      );
      return { role: "assistant", content };
    }
    return { role: "user", content: m.content };
  });
}

function makeConfirmHandler(block: ToolUseBlock): (summary: string) => Promise<boolean> {
  return async (summary: string) => {
    const store = useAgentStore.getState();
    return await new Promise<boolean>((resolve) => {
      // Surface the real tool_use_id + action name + input to the UI so
      // the confirmation card can show what's actually being approved.
      // The card calls window.__agentResolveConfirm__ to fulfil this.
      const dotted = registry.resolve(block.name)?.id ?? block.name;
      store.setPendingToolUse({
        toolUseId: block.id,
        actionId: block.name,
        resolvedActionId: dotted,
        input: block.input,
        summary,
      });
      (globalThis as Record<string, unknown>).__agentResolveConfirm__ = (ok: boolean) => {
        store.setPendingToolUse(null);
        delete (globalThis as Record<string, unknown>).__agentResolveConfirm__;
        resolve(ok);
      };
    });
  };
}

function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
