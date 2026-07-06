"use client";

import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import { useAgentStore } from "./store";
import { buildSystemPrompt } from "./system-prompt";
import { relevantActions as relevantActionsForQuery, rankActionIds } from "./mascot/kb";
import { recentUserText, toolNamesInHistory } from "./tool-selection";
import { parseRateLimitHeaders } from "./rate-limit";
import { executeToolUse } from "./execute-tool";
import { appendMessages, recordChatUsage } from "./persist";
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

/**
 * Whether the finishing send (whose controller is `mine`) still owns the shared
 * `streaming` flag and may reset it. A newer send that superseded this one will
 * have set `currentController` to its OWN controller — in that case this send
 * must NOT clear streaming, or it would flip the flag off mid-stream for the new
 * send. `null` means we finished/aborted cleanly with no successor, so reset.
 */
export function ownsStreamingReset(
  current: AbortController | null,
  mine: AbortController
): boolean {
  return current === mine || current === null;
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
    // Only clear streaming if no newer send has taken over (otherwise we'd flip
    // the flag off mid-stream for that send — see ownsStreamingReset).
    if (ownsStreamingReset(currentController, controller)) {
      useAgentStore.getState().setStreaming(false);
    }
    if (currentController === controller) currentController = null;
  }
}

/** Max tool schemas sent to the model per turn when the KB can focus the ask. */
const MAX_TOOLS_PER_TURN = 64;
/** Fewer ranked hits than this ⇒ the ask is too vague to trust; send them all. */
const MIN_RANKED_TO_TRIM = 4;

/**
 * Build the tool list for a turn. When the KB can rank the recent user context,
 * return just those top tools (capped at MAX_TOOLS_PER_TURN); otherwise return
 * the full registry so a vague request still has everything available.
 *
 * Two invariants beyond "rank the latest line":
 *  - `rankText` is the recent user context (last couple of messages), so a
 *    follow-up like "rename it" still ranks against the prior turn's nouns.
 *  - The offered set is UNIONED with every tool the transcript already
 *    references. An OpenAI-compatible endpoint rejects a request whose message
 *    history contains an assistant tool_call not present in `tools`, so trimming
 *    one away on a later turn would make the body invalid.
 */
function buildTurnTools(rankText: string, messages: ChatMessage[]) {
  const all = registry.toOpenAiTools();
  const rankedIds = rankText ? rankActionIds(rankText, MAX_TOOLS_PER_TURN) : [];
  if (rankedIds.length < MIN_RANKED_TO_TRIM) return all;
  const wantedNames = new Set(rankedIds.map((id) => claudeNameFromId(id)));
  // Keep every tool the conversation already references (normalise to the claude
  // name, since the model may have emitted dotted or underscored forms).
  for (const name of toolNamesInHistory(messages)) {
    wantedNames.add(claudeNameFromId(registry.resolve(name)?.id ?? name));
  }
  const trimmed = all.filter((t) => wantedNames.has(t.function.name));
  return trimmed.length >= MIN_RANKED_TO_TRIM ? trimmed : all;
}

async function runToolUseLoop(opts: StreamOptions): Promise<void> {
  const { mode, serverModel } = await detectMode();
  // KB help (RAG-lite): focus the model on the actions most relevant to the
  // latest user message, picked from the registry index.
  const latestUserText = lastUserText(useAgentStore.getState().messages);
  const relevantActions = latestUserText ? relevantActionsForQuery(latestUserText) : [];
  const system = buildSystemPrompt({ toolId: opts.toolId ?? null, relevantActions });
  // PERF: ship only the tools relevant to this turn, not all ~620 schemas.
  // Sending the whole registry every turn added ~30s of model latency on the
  // free tier (and bloats the request toward the gateway's body limit). Rank
  // against the recent user context so follow-ups keep their referents; vague
  // asks fall back to the full set; execution still uses the full registry.
  const turnMessages = useAgentStore.getState().messages;
  const tools = buildTurnTools(recentUserText(turnMessages), turnMessages);
  // BUG-G11: wedge guard. Track (actionId → consecutive-error-count) so a
  // model that keeps retrying the same broken tool_use call doesn't burn
  // every round in the budget.
  const errorRepeats = new Map<string, number>();

  // Token usage accumulates across the turn's rounds; record_chat_usage SETS the
  // (turn's) row to the running total, so the last write carries the full turn.
  let turnTokens = 0;
  const onUsage = (t: number) => {
    turnTokens += t;
    useAgentStore.getState().setLastTurnTokens(turnTokens);
    void recordChatUsage(turnTokens);
  };

  for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
    const messages = wireMessages(useAgentStore.getState().messages, system);
    const body = {
      model: pickModel(mode, serverModel),
      stream: true,
      max_tokens: 4096,
      // Ask the upstream to emit a usage chunk so we can record real token spend.
      stream_options: { include_usage: true },
      tools,
      tool_choice: "auto",
      messages,
    };

    // Meter only the first round: a turn's later tool-use rounds are
    // continuations of an already-allowed turn (see the route's x-agent-new-turn).
    const { stopReason, assistantId } = await openOneTurn(
      mode,
      body,
      opts.signal,
      round === 0,
      onUsage
    );

    if (stopReason !== "tool_use") {
      // BUG-G6: persist the assistant message after the turn settles.
      // Without this, reload yields invalid wire format (orphan tool_result
      // blocks referencing tool_call_ids that don't exist in any preceding
      // assistant message).
      persistAssistant(opts.conversationId, assistantId);
      return;
    }

    // BUG-G6: persist the assistant message so its tool_call_ids are
    // recoverable on reload, before we append the tool-role response.
    persistAssistant(opts.conversationId, assistantId);

    // Collect the tool_use blocks the streaming parser captured — from THIS
    // round's assistant message (looked up by id, not a reverse role scan).
    const lastAssistant = useAgentStore.getState().messages.find((m) => m.id === assistantId);
    if (!lastAssistant) return;
    // BUG-H1: never execute a `_partial` tool_use (arguments JSON that never
    // parsed). wireMessages drops such blocks from `tool_calls`, so answering
    // one would emit an orphan tool_result the endpoint rejects with 400 —
    // and once the pair is persisted, every later turn replays it and
    // re-rejects, bricking the conversation. Skipping preserves the invariant
    // documented on isWireValidAssistant: a tool_result exists IFF its
    // tool_call is wired.
    const toolUses = lastAssistant.content.filter(
      (c): c is ToolUseBlock => c.type === "tool_use" && !isPartialInput(c.input)
    );
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
        signal: opts.signal,
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

    // Panel closed mid-round: every tool_call now has a result (above), so the
    // transcript is valid — just don't open another streaming round.
    if (opts.signal?.aborted) return;

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
    const wrapUp = await openOneTurn(
      mode,
      {
        model: pickModel(mode, serverModel),
        stream: true,
        max_tokens: 1024,
        stream_options: { include_usage: true },
        // BUG-H5: the history necessarily references this turn's tool_calls,
        // and an OpenAI-compatible endpoint rejects a body whose history
        // names a function absent from `tools` (the buildTurnTools
        // invariant). Omitting `tools` made this summary turn 400 every
        // time — swallowed by the catch below, so the promised wrap-up
        // never appeared. Re-offer the same list, gated by tool_choice:none.
        tools,
        tool_choice: "none",
        messages,
      },
      opts.signal,
      false,
      onUsage
    );
    persistAssistant(opts.conversationId, wrapUp.assistantId);
  } catch {
    /* best-effort wrap-up */
  }
  useAgentStore
    .getState()
    .setError("Reached tool-use round limit (10). Send a follow-up if more is needed.");
}

/** Outcome of one streaming round. `assistantId` is the id of the assistant
 *  message this round appended to the store, or null when the round exited
 *  BEFORE creating one (429 / friendly-error paths). BUG-H2: the caller
 *  persists by this id — the previous reverse-scan re-persisted the PRIOR
 *  round's (already-persisted) assistant on those early exits, duplicating
 *  rows in agent_messages (and, when that message carried tool_calls,
 *  corrupting the wire pairing after reload). */
interface TurnOutcome {
  stopReason: string;
  assistantId: string | null;
}

/**
 * Open one chat-completion turn over SSE, accumulate text + tool_calls
 * into an assistant message in the store, and return our internal
 * stop_reason ("tool_use" or "end_turn") plus that message's id.
 */
async function openOneTurn(
  mode: AgentMode,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  newTurn = false,
  onUsage?: (totalTokens: number) => void
): Promise<TurnOutcome> {
  const response = await openStream(mode, body, signal, newTurn);

  // Update the usage bar from the route's X-RateLimit-* headers (server mode,
  // turn start). A 429 means a window cap was hit — surface it gently and stop
  // the loop instead of throwing the generic "stream failed" error.
  const rl = parseRateLimitHeaders(response.headers, response.status === 429);
  if (rl) useAgentStore.getState().setRateLimit(rl);
  if (response.status === 429) {
    useAgentStore
      .getState()
      .setError("You've reached the agent usage limit for now. Please try again later.");
    return { stopReason: "end_turn", assistantId: null };
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    // Map the common upstream failures to a message a user can act on, instead
    // of dumping the raw `agent stream failed (NNN): {json}` developer string
    // into the chat's error banner.
    const friendly =
      response.status === 413
        ? "That request was too large for the agent. Start a new conversation or shorten your message, then try again."
        : response.status === 401 || response.status === 403
          ? "The agent could not authenticate. Try signing out and back in."
          : response.status >= 500
            ? "The assistant is temporarily unavailable. Please try again in a moment."
            : null;
    if (friendly) {
      useAgentStore.getState().setError(friendly);
      return { stopReason: "end_turn", assistantId: null };
    }
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
      // BUG-H6: normalise AFTER concatenating into the buffer (mirrors
      // stream-sse.ts) — replacing only the new chunk leaves a stray `\r`
      // glued into the buffer when a network chunk boundary splits a CR-LF
      // pair, hiding the `\n\n` separator so two events merge and both get
      // silently dropped by the JSON parse below.
      buf += decoder.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
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
    if (wip.usage) onUsage?.(wip.usage);
    return { stopReason, assistantId: assistantMsg.id };
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
  /** total_tokens from the stream's usage chunk (stream_options.include_usage). */
  usage?: number;
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

  // Usage chunk (stream_options.include_usage) — typically a trailing chunk with
  // empty choices, so capture it before the choices guard below.
  const usage = payload.usage as { total_tokens?: number } | null | undefined;
  if (usage && typeof usage.total_tokens === "number") wip.usage = usage.total_tokens;

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

/** True when a tool_use `input` is the streaming parser's mid-stream
 *  placeholder `{_partial:"…"}` (the arguments JSON never parsed). */
function isPartialInput(input: Record<string, unknown> | null | undefined): boolean {
  const i = (input ?? {}) as Record<string, unknown>;
  return "_partial" in i && Object.keys(i).length === 1;
}

/**
 * INVARIANT (BUG-H1/H2/H4): an assistant message is persisted — and replayed
 * on the wire — IFF it is wire-valid: it carries non-empty text or at least
 * one COMPLETE (non-`_partial`) tool_use. OpenAI-compatible endpoints reject
 * an assistant message with neither `content` nor `tool_calls`, and reject a
 * tool_result whose tool_call was never sent — so:
 *   - tool_results are only ever produced for complete tool_uses (BUG-H1),
 *   - wire-invalid assistants are skipped by wireMessages (BUG-H4) and never
 *     written to agent_messages (persistAssistant below),
 * which together guarantee a stored transcript can always be replayed.
 */
function isWireValidAssistant(m: ChatMessage): boolean {
  for (const c of m.content) {
    if (c.type === "text" && c.text.length > 0) return true;
    if (c.type === "tool_use" && !isPartialInput(c.input)) return true;
  }
  return false;
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
  signal?: AbortSignal,
  newTurn = false
): Promise<Response> {
  if (mode === "server") {
    return fetch("/api/agent/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Flag turn start so the route meters per turn, not per tool-use round.
        ...(newTurn ? { "x-agent-new-turn": "1" } : {}),
      },
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
          // tool_call that the API rejects with 400. (Their tool_results are
          // never produced either — see BUG-H1 in runToolUseLoop.)
          if (isPartialInput(c.input)) {
            continue;
          }
          const input = (c.input ?? {}) as Record<string, unknown>;
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
      // BUG-H4: skip assistant messages that wire to NOTHING (content null,
      // zero tool_calls) — e.g. a stream aborted before the first delta, or
      // one whose only tool_use was `_partial`. OpenAI-compatible endpoints
      // reject such messages with 400, and one poison message in the history
      // would fail every later turn. See isWireValidAssistant.
      if (msg.content === null && toolCalls.length === 0) continue;
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

/** Persist ONE assistant message (by id) to Supabase if a conversation is
 *  active. Called between rounds so the tool_call_id references in
 *  subsequent tool-role messages are recoverable on reload. (BUG-G6)
 *
 *  BUG-H2: persist by id, not by scanning for the last assistant — a round
 *  that exited before appending one (429 / friendly-error) passes null and
 *  persists nothing, instead of re-inserting the previous round's
 *  already-persisted message as a duplicate row.
 *  BUG-H4: wire-invalid assistants (empty content, only-`_partial`
 *  tool_uses) are never persisted, so a reload can't resurrect a message
 *  the endpoint would reject. See isWireValidAssistant. */
function persistAssistant(
  conversationId: string | null | undefined,
  assistantId: string | null
): void {
  if (!conversationId || !assistantId) return;
  const msg = useAgentStore.getState().messages.find((m) => m.id === assistantId);
  if (!msg || !isWireValidAssistant(msg)) return;
  void appendMessages(conversationId, [msg]);
}

function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Read a non-tool completion stream to its end and return the concatenated text. */
async function collectStreamText(res: Response): Promise<string> {
  if (!res.ok || !res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // BUG-H6: normalise CRLF AFTER concat — see the note in openOneTurn.
      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const d = line.slice(5).trim();
          if (!d || d === "[DONE]") continue;
          try {
            const j = JSON.parse(d) as { choices?: Array<{ delta?: { content?: string } }> };
            const c = j.choices?.[0]?.delta?.content;
            if (typeof c === "string") text += c;
          } catch {
            /* skip keepalives / non-JSON */
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  return text;
}

/** Strip a raw model title down to a clean short string (exported for tests). */
export function cleanTitle(raw: string): string {
  const first = raw.split("\n")[0] ?? "";
  const cleaned = first
    .replace(/^\s*(title:?\s*)/i, "")
    .replace(/^["'`*]+|["'`*]+$/g, "")
    .replace(/[.!?,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
}

/**
 * Generate a short conversation title from the first exchange via a minimal,
 * tool-free completion. NOT metered (no x-agent-new-turn header) so it doesn't
 * spend the user's daily turn budget. Returns null on any failure so the caller
 * keeps the first-message fallback title.
 */
export async function generateTitle(
  userText: string,
  assistantText: string
): Promise<string | null> {
  try {
    const { mode, serverModel } = await detectMode();
    const body = {
      model: pickModel(mode, serverModel),
      stream: true,
      // GLM "flash" is a thinking model: it streams its chain-of-thought as
      // reasoning_content (which we ignore) and the title only lands in `content`
      // afterward. Too small a budget is spent entirely on reasoning and never
      // emits the title — give it room to finish thinking, then answer.
      max_tokens: 320,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You title conversations. Reply with ONLY a 3-6 word title — no quotes, no preamble, no trailing punctuation.",
        },
        {
          role: "user",
          content: `User: ${userText.slice(0, 400)}\nAssistant: ${assistantText.slice(0, 400)}\n\nTitle:`,
        },
      ],
    };
    const res = await openStream(mode, body, undefined, false);
    const title = cleanTitle(await collectStreamText(res));
    return title || null;
  } catch {
    return null;
  }
}
