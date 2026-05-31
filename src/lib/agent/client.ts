"use client";

import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import { useAgentStore } from "./store";
import { buildSystemPrompt } from "./system-prompt";
import { relevantActions as relevantActionsForQuery } from "./mascot/kb";
import { executeToolUse } from "./execute-tool";
import { appendMessages } from "./persist";
import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from "./types";

/** Text of the most recent user message (joined text blocks), or "" if none. */
function lastUserText(messages: ChatMessage[]): string {
  const last = messages.filter((m) => m.role === "user").at(-1);
  if (!last) return "";
  return last.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join(" ")
    .trim();
}

/**
 * Agent client — drives the tool-use loop against GLM (z.ai) via the
 * OpenAI-compatible chat completions API.
 *
 * Internal message shape stays Anthropic-flavoured (TextBlock /
 * ToolUseBlock / ToolResultBlock) so the UI, store, and Supabase
 * persistence are untouched. Translation to OpenAI's wire format
 * happens in `wireMessages()`; the SSE parser converts OpenAI's
 * `chat.completion.chunk` deltas back into our internal WIP blocks.
 *
 * Stop reasons (OpenAI → internal):
 *   "tool_calls"     → "tool_use"       (continue the loop)
 *   "stop"/"length"  → "end_turn"       (terminate)
 *   "content_filter" → "end_turn"
 */

// BUG-G3: align with the LLM Settings dialog and the openai-compatible
// glmAdapter, both of which target open.bigmodel.cn. The prior z.ai
// endpoint required separate keys that users got no warning about; the
// settings dialog's "Test" button would succeed and the agent would
// then 401 on the same key. Both endpoints are CSP-allowed.
const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-4.5-flash";
const MAX_TOOL_USE_ROUNDS = 10;
/** Guard against schema-violation wedges: if the same action returns
 *  is_error twice in a row with the same arg-shape, stop retrying. */
const MAX_SAME_ERROR_REPEATS = 2;

interface StreamOptions {
  userId: string;
  toolId?: string | null;
  /** When provided, the client persists every new message into this
   *  conversation. When omitted, messages stay local. */
  conversationId?: string | null;
  /** Cancellation handle for long-running streams. */
  signal?: AbortSignal;
}

/** Module-scoped abort controller for the current in-flight send. Cleared
 *  on completion. UI callers (sheet close, route change, unmount) call
 *  `abortInFlight()` to terminate the stream. (BUG-G4) */
let currentController: AbortController | null = null;
export function abortInFlight(): void {
  currentController?.abort();
  currentController = null;
  // Clear pending confirmation so a stale card doesn't survive the abort.
  // (BUG-G18)
  useAgentStore.getState().setPendingToolUse(null);
}

export async function sendUserMessage(text: string, opts: StreamOptions): Promise<void> {
  const store = useAgentStore.getState();

  // If a previous send is still running for any reason (shouldn't happen
  // because the UI gates the input), abort it first.
  if (currentController) {
    currentController.abort();
  }
  const controller = new AbortController();
  currentController = controller;
  // Chain caller-supplied signal so external abort still works.
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const optsWithSignal: StreamOptions = { ...opts, signal: controller.signal };

  const userMsg: ChatMessage = {
    id: msgId(),
    role: "user",
    content: [{ type: "text", text }],
    createdAt: new Date().toISOString(),
  };
  store.appendMessage(userMsg);
  store.setError(null);
  store.setStreaming(true);

  if (opts.conversationId) void appendMessages(opts.conversationId, [userMsg]);

  try {
    await runToolUseLoop(optsWithSignal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BUG-G18: clear pending confirmation when the loop errors so the
    // UI doesn't leave a wedged card pointing at a settled promise.
    useAgentStore.getState().setPendingToolUse(null);
    // Don't surface the abort as a user-visible error.
    if (!(err instanceof Error && err.name === "AbortError")) {
      store.setError(msg);
    }
  } finally {
    useAgentStore.getState().setStreaming(false);
    if (currentController === controller) currentController = null;
  }
}

async function runToolUseLoop(opts: StreamOptions): Promise<void> {
  const { mode, serverModel } = await detectMode();
  const tools = registry.toOpenAiTools();
  // KB help (RAG-lite): focus the model on the actions most relevant to the
  // latest user message, picked from the registry index.
  const latestUserText = lastUserText(useAgentStore.getState().messages);
  const relevantActions = latestUserText ? relevantActionsForQuery(latestUserText) : [];
  const system = buildSystemPrompt({ toolId: opts.toolId ?? null, relevantActions });
  // BUG-G11: wedge guard. Track (actionId → consecutive-error-count) so a
  // model that keeps retrying the same broken tool_use call doesn't burn
  // every round in the budget.
  const errorRepeats = new Map<string, number>();

  for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
    const messages = wireMessages(useAgentStore.getState().messages, system);
    const body = {
      model: pickModel(mode, serverModel),
      stream: true,
      max_tokens: 4096,
      tools,
      tool_choice: "auto",
      messages,
    };

    const stopReason = await openOneTurn(mode, body, opts.signal);

    if (stopReason !== "tool_use") {
      // BUG-G6: persist the assistant message after the turn settles.
      // Without this, reload yields invalid wire format (orphan tool_result
      // blocks referencing tool_call_ids that don't exist in any preceding
      // assistant message).
      maybePersistLastAssistant(opts.conversationId);
      return;
    }

    // BUG-G6: persist the assistant message so its tool_call_ids are
    // recoverable on reload, before we append the tool-role response.
    maybePersistLastAssistant(opts.conversationId);

    // Collect the tool_use blocks the streaming parser captured.
    const lastAssistant = useAgentStore
      .getState()
      .messages.slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const toolUses = lastAssistant.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
    if (toolUses.length === 0) return;

    // Execute each tool_use in order, accumulating results as a single
    // tool-role message. wireMessages will fan this out to one OpenAI
    // tool-role message per result on the next iteration.
    const results: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      const result = await executeToolUse(tu, {
        userId: opts.userId,
        confirm: makeConfirmHandler(tu),
        autoApprove: useAgentStore.getState().autoApprove,
      });
      results.push(result);
      // Track schema-failure repetition.
      if (result.is_error) {
        const n = (errorRepeats.get(tu.name) ?? 0) + 1;
        errorRepeats.set(tu.name, n);
      } else {
        errorRepeats.delete(tu.name);
      }
    }
    const toolMsg: ChatMessage = {
      id: msgId(),
      role: "tool",
      content: results,
      createdAt: new Date().toISOString(),
    };
    useAgentStore.getState().appendMessage(toolMsg);
    if (opts.conversationId) void appendMessages(opts.conversationId, [toolMsg]);

    // BUG-G11: bail if any action has wedged on repeated errors.
    let wedged = false;
    errorRepeats.forEach((n) => {
      if (n >= MAX_SAME_ERROR_REPEATS) wedged = true;
    });
    if (wedged) {
      useAgentStore
        .getState()
        .setError(
          "An action kept failing the same way; stopping the tool-use loop to avoid burning tokens. Refine your request and try again."
        );
      return;
    }
  }

  // Round budget exhausted — one final no-tools turn so the model can
  // summarise instead of leaving the conversation mid-stream on a tool
  // result. Capped via tool_choice=none so the model can't loop again.
  try {
    const messages = wireMessages(
      useAgentStore.getState().messages,
      `${system}\n\nIMPORTANT: You have exhausted the tool-use round budget for this turn. Summarise what you accomplished, what failed, and what remains — do NOT request more tools.`
    );
    await openOneTurn(
      mode,
      {
        model: pickModel(mode, serverModel),
        stream: true,
        max_tokens: 1024,
        tool_choice: "none",
        messages,
      },
      opts.signal
    );
  } catch {
    /* best-effort wrap-up */
  }
  useAgentStore
    .getState()
    .setError("Reached tool-use round limit (10). Send a follow-up if more is needed.");
}

/**
 * Open one chat-completion turn over SSE, accumulate text + tool_calls
 * into an assistant message in the store, and return our internal
 * stop_reason ("tool_use" or "end_turn").
 */
async function openOneTurn(
  mode: AgentMode,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined
): Promise<string> {
  const response = await openStream(mode, body, signal);
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`agent stream failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const assistantMsg: ChatMessage = {
    id: msgId(),
    role: "assistant",
    content: [],
    createdAt: new Date().toISOString(),
  };
  useAgentStore.getState().appendMessage(assistantMsg);

  // OpenAI / GLM streaming parser:
  //   data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}
  //   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":...,"function":{"name":...,"arguments":""}}]},...}]}
  //   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{...}"}}]},...}]}
  //   data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
  //   data: [DONE]
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stopReason = "end_turn";

  /** Text accumulates as a single content block (OpenAI emits one
   *  content stream, not multiple addressable blocks like Anthropic). */
  const wip: WipState = { textParts: [], toolCalls: new Map() };

  // BUG-G8: release the body's reader lock in finally so the stream
  // doesn't sit half-locked until GC after we return.
  try {
    while (true) {
      // Honour aborts mid-stream — break out and cancel the reader.
      if (signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      const { value, done } = await reader.read();
      if (done) break;
      // Normalise CRLF → LF: some HTTP proxies rewrite the SSE separator.
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const sr = handleSseChunk(chunk, wip);
        if (sr) stopReason = sr;
        flushAssistant(wip);
      }
    }
    // Tail flush in case the server closed without a trailing \n\n.
    if (buf.trim().length > 0) {
      const sr = handleSseChunk(buf, wip);
      if (sr) stopReason = sr;
    }
    flushAssistant(wip);
    return stopReason;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

interface WipToolCall {
  id: string;
  name: string;
  jsonAccum: string;
}

interface WipState {
  textParts: string[];
  /** Keyed by the streaming index (NOT the registry id). OpenAI emits
   *  tool_calls in sparse order — each chunk targets an index that
   *  refers back to the same call as previous chunks. */
  toolCalls: Map<number, WipToolCall>;
}

/**
 * Parse one SSE chunk; mutate WIP state; return the new internal
 * stop_reason if this chunk carried one, otherwise null.
 */
function handleSseChunk(raw: string, wip: WipState): string | null {
  // Each chunk is N lines; we only care about `data:` lines. Per the SSE
  // spec, multiple consecutive `data:` lines within one event are joined
  // with "\n" before parsing — the prior implementation overwrote and
  // silently dropped all but the last. (BUG-G5)
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const dataLine = dataLines.join("\n").trimEnd();
  if (!dataLine) return null;
  if (dataLine === "[DONE]") return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return null;
  }

  const choices = payload.choices as
    | Array<{
        delta?: {
          content?: string;
          reasoning_content?: string; // GLM thinking models — ignored
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>
    | undefined;
  if (!choices || choices.length === 0) return null;
  const choice = choices[0];
  const delta = choice.delta ?? {};

  // Text deltas.
  if (typeof delta.content === "string" && delta.content.length > 0) {
    wip.textParts.push(delta.content);
  }

  // Tool-call deltas. Each entry refers to a specific call by index;
  // we accumulate `id`, `name`, and a JSON string for `arguments`.
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const existing = wip.toolCalls.get(tc.index) ?? {
        id: "",
        name: "",
        jsonAccum: "",
      };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.jsonAccum += tc.function.arguments;
      wip.toolCalls.set(tc.index, existing);
    }
  }

  if (choice.finish_reason) {
    return mapFinishReason(choice.finish_reason);
  }
  return null;
}

function mapFinishReason(openAi: string): string {
  if (openAi === "tool_calls") return "tool_use";
  // "stop", "length", "content_filter" all terminate the loop.
  return "end_turn";
}

function flushAssistant(wip: WipState): void {
  const content: ContentBlock[] = [];
  const text = wip.textParts.join("");
  if (text.length > 0) {
    content.push({ type: "text", text });
  }
  // Tool calls in stream-index order.
  const indices = Array.from(wip.toolCalls.keys()).sort((a, b) => a - b);
  for (const i of indices) {
    const tc = wip.toolCalls.get(i);
    if (!tc) continue;
    let input: Record<string, unknown> = {};
    if (tc.jsonAccum) {
      try {
        input = JSON.parse(tc.jsonAccum);
      } catch {
        // Mid-stream — render the partial JSON so the UI shows progress.
        input = { _partial: tc.jsonAccum };
      }
    }
    content.push({
      type: "tool_use",
      id: tc.id || `tc_${i}`,
      name: tc.name,
      input,
    });
  }
  useAgentStore.getState().patchLastAssistant(content);
}

async function openStream(
  mode: AgentMode,
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
  // BYOK: must be GLM provider configured in AI Settings.
  const cfg = getActiveConfig();
  if (!cfg || cfg.provider !== "glm") {
    throw new Error(
      "No GLM key available. Configure one in AI Settings (BYOK → GLM) or set GLM_API_KEY on the server."
    );
  }
  // BUG-G3: this endpoint matches the LLM Settings dialog's glmAdapter
  // (open.bigmodel.cn). The settings dialog's "Test" button validates
  // against this same endpoint, so a key the user tested successfully
  // there will also work here.
  return fetch(GLM_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ ...body, model: cfg.model || DEFAULT_MODEL }),
    signal,
  });
}

type AgentMode = "server" | "client";

interface ModeProbe {
  mode: AgentMode;
  serverModel: string | null;
}

/**
 * Probe the server route to learn which transport to use AND which
 * model the server is configured for (so the client doesn't have to
 * second-guess). Cached for the session.
 */
let cachedProbe: ModeProbe | null = null;
async function detectMode(): Promise<ModeProbe> {
  if (cachedProbe) return cachedProbe;
  try {
    const res = await fetch("/api/agent/stream", { method: "GET" });
    if (res.ok) {
      const json = (await res.json()) as { mode?: string; model?: string | null };
      cachedProbe = {
        mode: json.mode === "server" ? "server" : "client",
        serverModel: typeof json.model === "string" ? json.model : null,
      };
    } else {
      cachedProbe = { mode: "client", serverModel: null };
    }
  } catch {
    cachedProbe = { mode: "client", serverModel: null };
  }
  return cachedProbe;
}

function pickModel(mode: AgentMode, serverModel: string | null): string {
  if (mode === "server" && serverModel) return serverModel;
  const cfg = getActiveConfig();
  if (cfg?.provider === "glm" && cfg.model) return cfg.model;
  return DEFAULT_MODEL;
}

/**
 * Translate our internal ChatMessage[] (Anthropic-flavoured content
 * blocks) into OpenAI's wire format:
 *
 *   role "user" with [{type:"text",text}]
 *     → {role:"user", content: "text"}
 *   role "assistant" with text + tool_use blocks
 *     → {role:"assistant", content: text|null, tool_calls: [{id, type:"function", function:{name, arguments}}]}
 *   role "tool" with N tool_result blocks
 *     → N × {role:"tool", tool_call_id, content}
 *
 * The system prompt becomes the first message (OpenAI doesn't have a
 * separate `system` field like Anthropic).
 */
function wireMessages(messages: ChatMessage[], system: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.role === "user") {
      const text = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      out.push({ role: "user", content: text });
      continue;
    }

    if (m.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];
      for (const c of m.content) {
        if (c.type === "text") textParts.push(c.text);
        else if (c.type === "tool_use") {
          // BUG-G7: drop tool_use blocks whose `input` is `{_partial:"…"}`
          // (length-truncated mid-stream). Re-serialising the partial JSON
          // string as `arguments` causes the next turn to send an orphan
          // tool_call that the API rejects with 400.
          const input = (c.input ?? {}) as Record<string, unknown>;
          if ("_partial" in input && Object.keys(input).length === 1) {
            continue;
          }
          toolCalls.push({
            id: c.id,
            type: "function",
            function: {
              // Defensive: action ids stored in dots-format become
              // OpenAI-format underscores. The streaming parser already
              // emits OpenAI-format names; this is a no-op safeguard.
              name: claudeNameFromId(c.name),
              arguments: JSON.stringify(input),
            },
          });
        }
      }
      const msg: Record<string, unknown> = { role: "assistant" };
      msg.content = textParts.join("") || null;
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }

    // role "tool" — fan out one OpenAI tool message per result block.
    for (const c of m.content) {
      if (c.type !== "tool_result") continue;
      const content =
        typeof c.content === "string" ? c.content : c.content.map((b) => b.text).join("");
      out.push({
        role: "tool",
        tool_call_id: c.tool_use_id,
        content,
      });
    }
  }

  return out;
}

function makeConfirmHandler(block: ToolUseBlock): (summary: string) => Promise<boolean> {
  return async (summary: string) => {
    const store = useAgentStore.getState();
    return await new Promise<boolean>((resolve) => {
      const dotted = registry.resolve(block.name)?.id ?? block.name;
      // BUG-G9: stash the resolver on the pending object itself.
      // Previous implementation stored it on globalThis, so a second
      // concurrent confirmation overwrote the first and the first
      // promise hung forever, wedging the loop.
      let resolved = false;
      const settle = (approved: boolean) => {
        if (resolved) return;
        resolved = true;
        store.setPendingToolUse(null);
        resolve(approved);
      };
      store.setPendingToolUse({
        toolUseId: block.id,
        actionId: block.name,
        resolvedActionId: dotted,
        input: block.input,
        summary,
        resolve: settle,
      });
    });
  };
}

/** Persist the most-recent assistant message to Supabase if a
 *  conversation is active. Called between turns so the tool_call_id
 *  references in subsequent tool-role messages are recoverable on
 *  reload. (BUG-G6) */
function maybePersistLastAssistant(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  const msgs = useAgentStore.getState().messages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant") {
      void appendMessages(conversationId, [msgs[i]]);
      return;
    }
  }
}

function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
