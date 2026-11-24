"use client";

import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { getActiveConfig } from "@/lib/stores/llm-store";
import type { ToolDefinition } from "@/lib/constants/tools";
import { getGuide } from "@/lib/tools/guides";
import { isVipOnly } from "@/lib/tools/catalog";
import { searchTools } from "@/lib/search/tool-search";
import {
  VISITOR_AI_PATH,
  VISITOR_FALLBACK_CODES,
  VISITOR_LIMITS,
  VISITOR_TIME_LIMIT_FINISH,
  type VisitorErrorCode,
  type VisitorRequestBody,
  type VisitorWireMessage,
} from "@/lib/visitor-ai/contract";
import { useAgentStore, type AgentNotice, type TurnAbort } from "./store";
import { buildSystemPrompt } from "./system-prompt";
import { composeGrounding } from "./grounding";
import { resolvePageTool } from "./page-tool";
import { relevantActions as relevantActionsForQuery, rankActionIds } from "./mascot/kb";
import {
  MAX_TOOLS_PER_TURN,
  recentUserText,
  selectTurnToolIds,
  toolNamesInHistory,
} from "./tool-selection";
import { parseRateLimitHeaders, parseVisitorQuota } from "./rate-limit";
import { executeToolUse } from "./execute-tool";
import { buildVisitorTurnTools } from "./visitor-tools";
import { inLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { appendMessages, deleteMessagesBetween, recordChatUsage } from "./persist";
import type {
  ChatMessage,
  ConfirmPrompt,
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "./types";

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
 * Agent client — drives the tool-use loop over the OpenAI-compatible chat
 * completions API: through /api/agent/stream to the server's backend
 * (OpenClaw → GLM-5.3, or a direct GLM / Z.AI key), or straight to
 * open.bigmodel.cn with the user's own BYOK GLM key.
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
/**
 * Owner turns. GLM-5.3 always reasons before it answers, and the reasoning
 * counts against max_tokens, so leave it room on top of the reply (the route
 * clamps at 8192).
 */
const OWNER_MAX_TOKENS = 8192;
/**
 * The round-limit wrap-up: a short summary, plus low-effort reasoning. High
 * effort over a ten-round history could spend the whole budget thinking and
 * end on "length" with no text.
 */
const WRAP_UP_MAX_TOKENS = 4096;
/** generateTitle: a 3-6 word title, plus low-effort reasoning. */
const TITLE_MAX_TOKENS = 1024;
/**
 * Told to the model on the wrap-up turn, after the round budget is spent. Its
 * answer is the reply, so like the prompt it has no dashes (the model copies
 * what it reads). Exported for tests.
 */
export const WRAP_UP_INSTRUCTION =
  "You have used every tool round for this turn. You cannot call any more tools: a tool call now is ignored. Answer the user now, in plain text: say what you did, what failed, and what remains.";
/** Guard against schema-violation wedges: if the same action returns
 *  is_error twice in a row with the same arg-shape, stop retrying. */
const MAX_SAME_ERROR_REPEATS = 2;

/**
 * What a notice is about (AgentNotice.kind): the chat decides from it which
 * button to offer ("Try again" when nothing ran, "Go on" after an answer that
 * stops short) and whether Amr frowns.
 *
 *  - Notes, gentle: "cut_off" (an answer that stops short), "no_answer" (a
 *    round with no reply), "round_limit" (every tool round used),
 *    "repeated_failure" (an action kept failing, so the turn stopped),
 *    "cant_do_here" and "live_room" (visitors).
 *  - Errors, real failures: the rest. A refusal of the visitor route keeps
 *    its own code as its kind ("round_limit" is a note there too).
 */
export type ChatNoticeKind =
  | "cut_off"
  | "no_answer"
  | "round_limit"
  | "repeated_failure"
  | "cant_do_here"
  | "live_room"
  | "stream_failed"
  | "too_large"
  | "signed_out"
  | "key_refused"
  | "usage_limit"
  | "upstream_busy"
  | "upstream_error"
  | "timeout"
  | "request_failed"
  | "unreachable"
  | "no_key"
  | VisitorErrorCode;

/** A notice this client shows, typed by its kind. */
export interface ChatNotice extends AgentNotice {
  kind: ChatNoticeKind;
}

const asNote = (kind: ChatNoticeKind, text: string): ChatNotice => ({ tone: "note", kind, text });
const asError = (kind: ChatNoticeKind, text: string): ChatNotice => ({
  tone: "error",
  kind,
  text,
});

/**
 * What a visitor is told for each refusal the visitor route can send.
 * Exported for test/agent/notice-copy.test.ts.
 */
export const VISITOR_ERROR_TEXT: Record<VisitorErrorCode, string> = {
  disabled: "Amr's AI is switched off right now.",
  forbidden: "That request didn't come from this site, so Amr couldn't answer it.",
  slow_down: "That's a lot of messages at once. Wait a few seconds, then try again.",
  too_large: "That conversation got too long to send. Clear the chat and ask again.",
  bad_request: "Amr couldn't read that request. Clear the chat and try again.",
  round_limit: "That took Amr too many steps. Ask again in smaller pieces.",
  meter_unavailable: "Amr can't check today's message count right now.",
  visitor_limit: "You've used all of today's messages with Amr.",
  visitor_peak_limit: "You've used all your messages for these busy hours.",
  site_limit: "Amr has answered all he can for today.",
  site_peak_limit: "Amr has answered all he can for these busy hours.",
  site_busy: "Amr is too busy to answer right now.",
  upstream_busy: "Amr's AI service is busy. Try again in a minute.",
  upstream_error: "Amr's AI service hit an error. Try again in a moment.",
  timeout: "Amr's AI service took too long to answer. Try again in a moment.",
};

/**
 * The chat's own lines, for the owner and visitors alike. They are narration
 * about Amr, in the third person, never his words: none says I, me or my, and
 * none uses a dash (test/agent/notice-copy.test.ts). The technical detail
 * behind an error goes to the console, never here.
 */
export const NOTICE_TEXT = {
  /**
   * A request that never got through, or a stream that broke half way. It may
   * be the reader's connection or the server's side (a gateway gone silent),
   * so it blames neither.
   */
  streamFailed:
    "Amr couldn't finish answering. Try again, and check your connection if it keeps happening.",
  cutShort: "Amr's answer was cut short. Ask him to go on.",
  timeCut: "Amr ran out of time, so his answer stops here. Ask him to go on.",
  mayBeCut: "Amr's answer may have been cut off. Ask him to go on.",
  noRoom: "Amr ran out of room thinking before he could answer. Try a shorter or simpler question.",
  noTime: "Amr ran out of time before he could answer. Try a shorter or simpler question.",
  noAnswer: "Amr didn't manage an answer that time. Try asking again.",
  repeatedFailure: "An action kept failing the same way, so Amr stopped. Try asking another way.",
  cantDoHere: "Amr tried something he can't do here. Try asking another way.",
  /**
   * Shown when this browser has a visitor live room open and Amr asks for a
   * tool, or a room opened while he was using them.
   */
  liveRoom: "Amr uses no tools while you're in a live room.",
  tooLarge:
    "That conversation got too long for Amr. Start a new chat, or shorten the message, and ask again.",
  signedOut: "Amr couldn't confirm it's you. Sign out and back in, then try again.",
  keyRefused:
    "The AI service turned down the GLM key in AI Settings. Check the key there, then try again.",
  usageLimit: "You've reached Amr's usage limit for now. Try again later.",
  requestFailed: "Amr couldn't answer that. Try again in a moment.",
  unreachable: "Amr can't reach the server right now. Try again in a moment.",
  noKey: "Amr has no AI key to answer with. Add a GLM key in AI Settings, then try again.",
} as const;

/**
 * The note for an owner's turn that used every tool round, beside the
 * wrap-up or roundLimitNote's facts when they stand in. A visitor's stand-in
 * says it all itself.
 */
export function roundLimitNotice(rounds: number = MAX_TOOL_USE_ROUNDS): ChatNotice {
  return asNote(
    "round_limit",
    `Amr reached his limit of ${rounds} tool rounds for one request. Send a follow-up and he'll carry on.`
  );
}

/**
 * finish_reasons that mean the reply was stopped before its end by something
 * other than its length: OpenAI's "content_filter", and GLM's own "sensitive"
 * and "network_error" (the model's side failed half way).
 */
const STOPPED_EARLY: ReadonlySet<string> = new Set([
  "content_filter",
  "sensitive",
  "network_error",
]);

/**
 * The note for a round that ended without a usable answer, or with one that
 * stops short, or null. An answer stops short when the model ran out of
 * tokens ("length"), when the visitor route ended it at its time limit
 * (VISITOR_TIME_LIMIT_FINISH, visitors only), when the model's side stopped
 * it early (STOPPED_EARLY), or when the stream just ended (`cut`: no
 * finish_reason, and either no [DONE], so something between the model and the
 * browser closed it, or an error event of the stream's own). With no text at
 * all (all reasoning, or a call cut off half way) it says there was no
 * answer. Exported for tests.
 */
export function endNoteFor(round: {
  hasText: boolean;
  finishReason: string | null;
  cut: boolean;
  visitor: boolean;
}): ChatNotice | null {
  const { hasText, finishReason, cut, visitor } = round;
  const timeLimit = visitor && finishReason === VISITOR_TIME_LIMIT_FINISH;
  if (!hasText) {
    if (finishReason === "length") return asNote("no_answer", NOTICE_TEXT.noRoom);
    if (timeLimit) return asNote("no_answer", NOTICE_TEXT.noTime);
    return asNote("no_answer", NOTICE_TEXT.noAnswer);
  }
  if (finishReason === "length") return asNote("cut_off", NOTICE_TEXT.cutShort);
  if (timeLimit) return asNote("cut_off", NOTICE_TEXT.timeCut);
  if (cut || (finishReason !== null && STOPPED_EARLY.has(finishReason))) {
    return asNote("cut_off", NOTICE_TEXT.mayBeCut);
  }
  return null;
}

/**
 * The owner's notice for a response the agent route refused, by its status,
 * or, with a key of the owner's own (`byok`), one GLM refused. `code` is the
 * route's own error code from the body, when it sent one: "upstream" means
 * the gateway behind the route refused, so a 429 is the AI service being busy
 * rather than the owner's usage limit, and a 401 is not the owner's sign-in.
 * Exported for tests.
 */
export function ownerRefusalNotice(
  status: number,
  byok: boolean,
  code: string | null = null
): ChatNotice {
  const upstream = byok || code === "upstream";
  if (status === 413) return asError("too_large", NOTICE_TEXT.tooLarge);
  if (status === 401 || status === 403) {
    if (byok) return asError("key_refused", NOTICE_TEXT.keyRefused);
    return upstream
      ? asError("request_failed", NOTICE_TEXT.requestFailed)
      : asError("signed_out", NOTICE_TEXT.signedOut);
  }
  if (status === 429) {
    return upstream
      ? asError("upstream_busy", VISITOR_ERROR_TEXT.upstream_busy)
      : asError("usage_limit", NOTICE_TEXT.usageLimit);
  }
  if (status === 504) return asError("timeout", VISITOR_ERROR_TEXT.timeout);
  if (status >= 500) return asError("upstream_error", VISITOR_ERROR_TEXT.upstream_error);
  return asError("request_failed", NOTICE_TEXT.requestFailed);
}

/**
 * A visitor's notice for a refusal of the visitor route: its code's text, or,
 * with no code, by its status. "round_limit" (the turn took too many steps)
 * is a note, not a failure. Exported for tests.
 */
export function visitorRefusalNotice(code: VisitorErrorCode | null, status: number): ChatNotice {
  if (code === "round_limit") return asNote("round_limit", VISITOR_ERROR_TEXT.round_limit);
  if (code) return asError(code, VISITOR_ERROR_TEXT[code]);
  if (status >= 500) return asError("upstream_error", VISITOR_ERROR_TEXT.upstream_error);
  return asError("request_failed", NOTICE_TEXT.requestFailed);
}

/** What "Go on" sends: a real message of the user's (see goOn). */
export const GO_ON_TEXT = "Go on";

export interface StreamOptions {
  userId: string;
  toolId?: string | null;
  /** When provided, the client persists every new message into this
   *  conversation. When omitted, messages stay local. */
  conversationId?: string | null;
  /** Cancellation handle for long-running streams. */
  signal?: AbortSignal;
  /**
   * Whose chat this is (default "owner"). A visitor's turn (visitor AI) posts
   * to the visitor route with no system message, persists nothing, records no
   * usage, offers at most VISITOR_LIMITS.maxTools tools, and asks before every
   * change: see runVisitorLoop.
   */
  profile?: "owner" | "visitor";
}

/**
 * Module-scoped abort controller for the current in-flight send, cleared on
 * completion (BUG-G4). Each send also registers its abort with the store
 * (setAbortTurn), so New chat, a thread switch, sign-out and a profile change
 * stop the turn without importing this module. Closing the panel never does:
 * an answer goes on with the panel shut.
 */
let currentController: AbortController | null = null;

/** Stop the live turn (the Stop button): it ends where it is, and a waiting card is denied. */
export function abortInFlight(): void {
  // Runs the turn's registered abort once and denies a waiting card, so a
  // stale card doesn't survive the abort (BUG-G18).
  useAgentStore.getState().abortTurn("stop");
  currentController?.abort();
  currentController = null;
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
  const visitor = opts.profile === "visitor";
  const userMsg: ChatMessage = {
    id: msgId(),
    role: "user",
    // The visitor route refuses a longer message, so keep what's shown and
    // what's sent the same.
    content: [{ type: "text", text: visitor ? text.slice(0, VISITOR_LIMITS.userChars) : text }],
    createdAt: new Date().toISOString(),
  };
  await runTurn(opts, userMsg);
}

/**
 * "Go on", after an answer that stops short: sends the user's own "Go on", so
 * the model picks up where it stopped. It is a real message, never a resend
 * of the last turn: the visitor route takes only a body that ends on the
 * user's message or a tool result (request.ts), and both meters count it as a
 * new turn. Resolves false, sending nothing, while a turn is still running.
 */
export async function goOn(opts: StreamOptions): Promise<boolean> {
  if (useAgentStore.getState().streaming || currentController) return false;
  await sendUserMessage(GO_ON_TEXT, opts);
  return true;
}

/** Index of the chat's last user message, or -1. */
function lastUserIndex(messages: ChatMessage[]): number {
  return messages.map((m) => m.role).lastIndexOf("user");
}

/**
 * Whether a tool result says its action ran: it answered, or it failed inside
 * its handler, which may have written before it failed. A call that was
 * denied, refused, or never valid ran nothing (see executeToolUse).
 */
function resultRan(c: ToolResultBlock): boolean {
  if (!c.is_error) return true;
  const text = typeof c.content === "string" ? c.content : c.content.map((b) => b.text).join("");
  return text.startsWith("Handler error:");
}

/**
 * Whether the chat's last turn may run again (retryLastTurn): there is a
 * question, and nothing after it ran a change. Reads may run again; a write
 * or an intent that ran (or an action the registry no longer knows) may not,
 * so trying again never repeats a change. Exported for the chat's "Try again".
 *
 * Each result is read against the calls of the assistant message just before
 * it, never a call anywhere in the turn: an id can come back in a later round
 * (a gateway that sends none gets `tc_0` every round), and a write's result
 * must not pass for a later read's.
 */
export function canRetryLastTurn(messages: ChatMessage[]): boolean {
  const at = lastUserIndex(messages);
  if (at === -1) return false;
  /** The calls of the latest assistant message: the only ones the tool messages after it answer. */
  let nameOf = new Map<string, string>();
  for (const m of messages.slice(at + 1)) {
    if (m.role === "assistant") {
      nameOf = new Map();
      for (const c of m.content) if (c.type === "tool_use") nameOf.set(c.id, c.name);
      continue;
    }
    if (m.role !== "tool") continue;
    for (const c of m.content) {
      if (c.type !== "tool_result" || !resultRan(c)) continue;
      const name = nameOf.get(c.tool_use_id);
      if (!name || registry.resolve(name)?.category !== "read") return false;
    }
  }
  return true;
}

/** The latest of these messages' times, as ISO 8601, or null when one can't be read. */
function latestTime(messages: ChatMessage[]): string | null {
  let latest = -Infinity;
  for (const m of messages) {
    const t = Date.parse(m.createdAt);
    if (Number.isNaN(t)) return null;
    latest = Math.max(latest, t);
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

/**
 * "Try again": run the chat's last turn again from its question, without a
 * second copy of it. What the turn left after the question (a reply cut
 * short, the reads it ran) goes, from the chat and from the owner's saved
 * thread, and the question goes out as it did. Only a turn that ran no change
 * may run again (canRetryLastTurn). It counts as a new turn: the owner's
 * meter, the visitor's allowance. Resolves false, doing nothing, when it may
 * not, while a turn is running, or when the chat on screen is the other
 * profile's; true once the new turn is over.
 */
export async function retryLastTurn(opts: StreamOptions): Promise<boolean> {
  const store = useAgentStore.getState();
  const visitor = opts.profile === "visitor";
  if (store.streaming || currentController) return false;
  if (store.chatProfile !== (visitor ? "visitor" : "owner")) return false;
  const { messages } = store;
  const at = lastUserIndex(messages);
  if (at === -1 || !canRetryLastTurn(messages)) return false;
  const question = messages[at];
  const after = messages.slice(at + 1);
  for (const m of after) store.removeMessage(m.id);
  // The saved thread loses the same messages: everything after the question,
  // up to the last of them. A message of the new turn is later than that, so
  // the delete never takes it, whenever it lands. Best-effort, like every write.
  const through = latestTime(after);
  const since = latestTime([question]);
  if (!visitor && opts.conversationId && after.length > 0 && through && since) {
    void deleteMessagesBetween(opts.conversationId, since, through);
  }
  await runTurn(opts, null);
  return true;
}

/**
 * Run one turn: with `userMsg`, a new question added to the chat (and saved);
 * with null, the chat's last question again (retryLastTurn).
 */
async function runTurn(opts: StreamOptions, userMsg: ChatMessage | null): Promise<void> {
  const store = useAgentStore.getState();
  const visitor = opts.profile === "visitor";
  store.setChatProfile(visitor ? "visitor" : "owner");

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
  // The store stops this turn on Stop, New chat, a thread switch, sign-out and
  // a profile change, before it swaps the chat out: whatever the turn does
  // after that is told by its signal.
  const abortTurn: TurnAbort = () => controller.abort();
  store.setAbortTurn(abortTurn);
  // A visitor's chat lives in memory only: no conversation to write to.
  const optsWithSignal: StreamOptions = {
    ...opts,
    signal: controller.signal,
    ...(visitor ? { conversationId: null } : {}),
  };

  if (userMsg) store.appendMessage(userMsg);
  store.setNotice(null);
  store.setStreaming(true);

  if (userMsg && optsWithSignal.conversationId) {
    void appendMessages(optsWithSignal.conversationId, [userMsg]);
  }

  try {
    await (visitor ? runVisitorLoop(optsWithSignal) : runToolUseLoop(optsWithSignal));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // BUG-G18: clear pending confirmation when the loop errors so the
    // UI doesn't leave a wedged card pointing at a settled promise.
    useAgentStore.getState().setPendingToolUse(null);
    // Don't surface the abort as a user-visible error. Stop is known by this
    // send's own signal as well as by the error's name: a failure that arrives
    // after Stop (the connection going down with the request) can carry any name.
    const stopped =
      controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    if (!stopped) {
      // A request that never got through, or an answer whose stream broke
      // half way (the network, or the route's 30 s without a chunk), reaches
      // here as the browser's own "Failed to fetch" / "network error", or the
      // stream's own words ("upstream_idle_timeout"). Say what happened in
      // plain words instead; any text that did arrive stays. The real error
      // goes to the console, for whoever is looking into it.
      console.warn(
        visitor ? "[visitor-ai] the answer stopped:" : "[agent] the answer stopped:",
        msg
      );
      store.setNotice(asError("stream_failed", NOTICE_TEXT.streamFailed));
    }
  } finally {
    // The turn is over: the store has nothing of it left to stop (a newer
    // send's abort, registered since, stays).
    useAgentStore.getState().clearAbortTurn(abortTurn);
    // Only clear streaming if no newer send has taken over (otherwise we'd flip
    // the flag off mid-stream for that send — see ownsStreamingReset).
    if (ownsStreamingReset(currentController, controller)) {
      useAgentStore.getState().setStreaming(false);
    }
    if (currentController === controller) currentController = null;
  }
}

type OpenAiTool = ReturnType<typeof registry.toOpenAiTools>[number];

/**
 * Pick the tool schemas for one request (see selectTurnToolIds for the order:
 * tools the chat already used, the open tool's actions, the KB's ranked
 * matches, the cross-tool intents — at most MAX_TOOLS_PER_TURN plus history).
 *
 * The whole registry is never sent. It used to be, whenever fewer than four
 * actions ranked or there was no user text: 831 actions, ~590 KB of JSON
 * (~150k tokens), which added ~30s of model latency and blew past the
 * gateway's body limit.
 *
 * Two invariants:
 *  - `rankedIds` come from the recent user context (last couple of messages),
 *    so a follow-up like "rename it" still ranks against the prior turn's nouns.
 *  - Every tool the transcript already references stays in the set. An
 *    OpenAI-compatible endpoint rejects a request whose history contains an
 *    assistant tool_call not present in `tools`, so trimming one away on a
 *    later turn (or round) would make the body invalid.
 *
 * The result keeps selectTurnToolIds' order, history first: the route caps
 * the list it forwards (MAX_FORWARDED_TOOLS), so in registry order a long
 * conversation could lose a tool its history names off the end.
 */
function pickTurnTools(
  byName: ReadonlyMap<string, OpenAiTool>,
  opts: { toolId: string | null; rankedIds: string[]; messages: ChatMessage[] }
): OpenAiTool[] {
  // Normalise history names to dotted ids: the model may have emitted dotted
  // or underscored forms.
  const historyIds = toolNamesInHistory(opts.messages).map(
    (name) => registry.resolve(name)?.id ?? name
  );
  const ids = selectTurnToolIds({
    actions: registry.list(),
    toolId: opts.toolId,
    rankedIds: opts.rankedIds,
    historyIds,
  });
  return ids.flatMap((id) => byName.get(claudeNameFromId(id)) ?? []);
}

/** Offer `tools` with tool_choice "auto" (the only value GLM-5.3 documents), or neither. */
function withTools(body: Record<string, unknown>, tools: OpenAiTool[]): Record<string, unknown> {
  if (tools.length === 0) return body;
  return { ...body, tools, tool_choice: "auto" };
}

/**
 * What the agent should know about the site this turn: the open tool's guide
 * and up to three related tools for the user's words. Best-effort, part by
 * part — a guide that fails to load just leaves the prompt without it (the
 * tool's one-line description still goes in), and nothing here can stop the
 * turn from being sent.
 */
async function ownerGrounding(
  tool: ToolDefinition | undefined,
  latestUserText: string
): Promise<string> {
  try {
    const guide = tool ? await getGuide(tool.id).catch(() => undefined) : undefined;
    let related: ReturnType<typeof searchTools> = [];
    try {
      related = latestUserText ? searchTools(latestUserText, 3) : [];
    } catch {
      /* no related tools this turn */
    }
    return composeGrounding({ tool, guide, related });
  } catch {
    return "";
  }
}

/** Whether AI Settings holds a GLM key of the owner's own (openStream's BYOK). */
function hasByokGlm(): boolean {
  return getActiveConfig()?.provider === "glm";
}

/**
 * The owner's backend for this turn, or null when there is none to send to,
 * and the chat says why: the route has no AI key and AI Settings no GLM key,
 * or the route couldn't be reached (asked twice: one failed probe is often a
 * cold start) and there is no key of the owner's to fall back on. The setup
 * detail goes to the console.
 */
async function ownerBackend(signal: AbortSignal | undefined): Promise<ModeProbe | null> {
  let probe = await detectMode();
  if (probe.mode === "server" || hasByokGlm()) return probe;
  if (probe.failed !== undefined) {
    probe = await detectMode();
    if (probe.mode === "server") return probe;
  }
  if (signal?.aborted) return null;
  const { failed } = probe;
  if (failed === undefined) {
    console.warn(
      "[agent] no AI key: the agent route has none (GLM_API_KEY on the server) and AI Settings has no GLM key"
    );
    useAgentStore.getState().setNotice(asError("no_key", NOTICE_TEXT.noKey));
  } else {
    console.warn(`[agent] the agent route's probe failed (${failed || "no answer"})`);
    useAgentStore
      .getState()
      .setNotice(
        failed === 401 || failed === 403
          ? asError("signed_out", NOTICE_TEXT.signedOut)
          : asError("unreachable", NOTICE_TEXT.unreachable)
      );
  }
  return null;
}

async function runToolUseLoop(opts: StreamOptions): Promise<void> {
  const backend = await ownerBackend(opts.signal);
  if (!backend) return;
  const { mode, serverModel } = backend;
  const model = pickModel(mode, serverModel);
  // One canonical id for the prompt, the grounding and the tool selection: a
  // path or slug (as older conversations stored it) resolves to the tool's id.
  const pageTool = resolvePageTool(opts.toolId);
  const toolId = pageTool?.id ?? opts.toolId ?? null;
  // KB help (RAG-lite): focus the model on the actions most relevant to the
  // latest user message, picked from the registry index.
  const latestUserText = lastUserText(useAgentStore.getState().messages);
  const relevantActions = latestUserText ? relevantActionsForQuery(latestUserText) : [];
  const grounding = await ownerGrounding(pageTool, latestUserText);
  const system = buildSystemPrompt({ toolId, relevantActions, grounding });
  // PERF: ship only the tools relevant to this turn (see pickTurnTools).
  // Ranking happens once per turn; the set is re-picked each round only so a
  // tool the model just called stays offered. Execution still resolves against
  // the full registry.
  const toolsByName = new Map(registry.toOpenAiTools().map((t) => [t.function.name, t]));
  const rankText = recentUserText(useAgentStore.getState().messages);
  const rankedIds = rankText ? rankActionIds(rankText, MAX_TOOLS_PER_TURN) : [];
  const toolsFor = (messages: ChatMessage[]) =>
    pickTurnTools(toolsByName, { toolId, rankedIds, messages });
  // BUG-G11: wedge guard. Track (actionId → consecutive-error-count) so a
  // model that keeps retrying the same broken tool_use call doesn't burn
  // every round in the budget.
  const errorRepeats = new Map<string, number>();

  // Token usage accumulates across the turn's rounds; record_chat_usage SETS the
  // (turn's) row to the running total, so the last write carries the full turn.
  // A round whose stream carried no usage adds nothing (and records nothing).
  let turnTokens = 0;
  const onUsage = (t: number) => {
    turnTokens += t;
    useAgentStore.getState().setLastTurnTokens(turnTokens);
    void recordChatUsage(turnTokens, model);
  };

  // Every message of this turn is saved to the conversation it started in,
  // whatever the chat shows by the time it lands.
  const conversationId = opts.conversationId ?? null;

  for (let round = 0; round < MAX_TOOL_USE_ROUNDS; round++) {
    // Stopped, or the chat changed under the turn (New chat, another thread)
    // while it got ready or between rounds: the chat now showing is not this
    // turn's to send.
    if (opts.signal?.aborted) return;
    const history = useAgentStore.getState().messages;
    const messages = wireMessages(history, system);
    const body = withTools(
      {
        model,
        stream: true,
        max_tokens: OWNER_MAX_TOKENS,
        // Ask the upstream to emit a usage chunk so we can record real token spend.
        stream_options: { include_usage: true },
        reasoning_effort: "high",
        messages,
      },
      toolsFor(history)
    );

    // Meter only the first round: a turn's later tool-use rounds are
    // continuations of an already-allowed turn (see the route's x-agent-new-turn).
    const { stopReason, assistantId, finishReason, cut } = await openOneTurn(
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
      persistAssistant(conversationId, assistantId);
      // An answer that stops short, or none at all (all reasoning, or a call
      // cut off), says so, as a visitor's does: otherwise the owner can't tell
      // it from a finished one, or sees nothing. A refusal (no assistantId)
      // has said why already, and Stop (or the chat moving on) needs nothing.
      const endNote =
        assistantId && !opts.signal?.aborted
          ? roundEndNote(assistantId, finishReason ?? null, cut === true, false)
          : null;
      if (endNote) useAgentStore.getState().setNotice(endNote);
      return;
    }

    // BUG-G6: persist the assistant message so its tool_call_ids are
    // recoverable on reload, before we append the tool-role response.
    persistAssistant(conversationId, assistantId);

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
    if (toolUses.length === 0) {
      // Asked for tools, but no call parsed: nothing ran and nothing goes
      // back. Say so, as a visitor's chat does, rather than end on a raw call:
      // "no answer" (Try again) without text, "may have been cut off" (Go on)
      // with it.
      if (!opts.signal?.aborted) {
        const note = roundEndNote(lastAssistant.id, null, true, false);
        if (note) useAgentStore.getState().setNotice(note);
      }
      return;
    }

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
    // The calls were saved with their conversation (above), so their results
    // go there too, even when the chat moved on while a tool ran or waited for
    // its card: the saved thread keeps every call answered.
    if (conversationId) void appendMessages(conversationId, [toolMsg]);
    // New chat or another thread while a tool ran or waited: the calls are
    // gone from the chat on screen, so their results would only be strays in
    // it (and the next request there would fail on them).
    if (!chatStillHas(lastAssistant.id)) return;
    useAgentStore.getState().appendMessage(toolMsg);

    // Stopped mid-round: every tool_call now has a result (above), so the
    // transcript is valid — just don't open another streaming round.
    if (opts.signal?.aborted) return;

    // BUG-G11: bail if any action has wedged on repeated errors.
    let wedged = false;
    errorRepeats.forEach((n) => {
      if (n >= MAX_SAME_ERROR_REPEATS) wedged = true;
    });
    if (wedged) {
      useAgentStore.getState().setNotice(asNote("repeated_failure", NOTICE_TEXT.repeatedFailure));
      return;
    }
  }

  // Round budget exhausted — one final turn so the model can summarise
  // instead of leaving the conversation mid-stream on a tool result.
  //
  // BUG-H5: the history necessarily references this turn's tool_calls, and an
  // OpenAI-compatible endpoint rejects a body whose history names a function
  // absent from `tools` (the pickTurnTools invariant), so the tools stay in
  // the body. They used to be gated with tool_choice "none", but GLM-5.3
  // documents only "auto" (the route now always sends "auto"), so the
  // instruction carries the rule instead, and any tool call the model makes
  // anyway is dropped from this message (ignoreToolCalls) — its text is kept.
  // The instruction rides in the system message rather than a trailing one:
  // the route meters a request whose last message isn't a tool result as a
  // new turn, and this is still the same turn. (Sending no tools would need
  // the history's tool_calls rewritten as plain text, which ends the body on
  // a non-tool message and meters it as a new turn.)
  //
  // The model can still answer with only a tool call, or spend its budget
  // reasoning; then the wrap-up has no text and a local note (roundLimitNote)
  // stands in, so the turn never ends on an empty reply.
  let wrapUpId: string | null = null;
  if (opts.signal?.aborted) return;
  try {
    const history = useAgentStore.getState().messages;
    const messages = wireMessages(history, `${system}\n\n${WRAP_UP_INSTRUCTION}`);
    const wrapUp = await openOneTurn(
      mode,
      withTools(
        {
          model,
          stream: true,
          max_tokens: WRAP_UP_MAX_TOKENS,
          stream_options: { include_usage: true },
          reasoning_effort: "low",
          messages,
        },
        toolsFor(history)
      ),
      opts.signal,
      false,
      onUsage,
      { ignoreToolCalls: true }
    );
    wrapUpId = wrapUp.assistantId;
  } catch {
    /* best-effort wrap-up; the note below stands in for it */
  }
  // Stopped, or the chat changed under the wrap-up: keep only what the model
  // wrote, and leave no note in a chat that may not be this turn's.
  if (opts.signal?.aborted) {
    persistAssistant(conversationId, wrapUpId);
    return;
  }
  // A stand-in keeps to the facts: the notice below says once that a
  // follow-up carries on, beside its Go on.
  wrapUpId = withWrapUpText(wrapUpId, MAX_TOOL_USE_ROUNDS, false);
  persistAssistant(conversationId, wrapUpId);
  // Replaces whatever the wrap-up's own round said (a refusal of it included):
  // the turn's end is the round limit, and a follow-up carries on.
  useAgentStore.getState().setNotice(roundLimitNotice());
}

/** Stands in for the part of a visitor's text that was cut. */
function cutMarker(fullLength: number): string {
  return `\n…[cut: the full text was ${fullLength} characters]`;
}

/**
 * Text cut to `max` characters, marker included, so one big tool result (or
 * a long reply) can't fill the visitor's request. Exported for tests.
 */
export function cutToolResult(
  content: string,
  max: number = VISITOR_LIMITS.toolResultChars
): string {
  if (content.length <= max) return content;
  const marker = cutMarker(content.length);
  return content.slice(0, Math.max(0, max - marker.length)) + marker;
}

/** A complete tool call whose arguments fit VISITOR_LIMITS.argumentsChars. */
function fitsTheWire(c: ToolUseBlock): boolean {
  return (
    !isPartialInput(c.input) &&
    JSON.stringify(c.input ?? {}).length <= VISITOR_LIMITS.argumentsChars
  );
}

/**
 * The tool calls of one assistant message that can go on the wire: the
 * visitor route takes at most VISITOR_LIMITS.toolCallsPerMessage of them, each
 * with arguments of at most VISITOR_LIMITS.argumentsChars. (Only a runaway
 * model makes more or longer ones, and runVisitorLoop never runs those.)
 */
function sendableCalls(m: ChatMessage): ToolUseBlock[] {
  return m.content
    .filter((c): c is ToolUseBlock => c.type === "tool_use" && fitsTheWire(c))
    .slice(0, VISITOR_LIMITS.toolCallsPerMessage);
}

/**
 * The calls of a visitor's round that may run: complete, offered with this
 * request, with arguments that fit, and only the first
 * VISITOR_LIMITS.toolCallsPerMessage of those. Exactly what the next request
 * can carry back with its results, so a call that runs is never left out of
 * it (the model would not know it had run and could do it again, or the
 * request would end on the visitor's message and count as a new one).
 */
function runnableVisitorCalls(m: ChatMessage, offered: ReadonlySet<string>): ToolUseBlock[] {
  return m.content
    .filter(
      (c): c is ToolUseBlock =>
        c.type === "tool_use" && fitsTheWire(c) && offered.has(claudeNameFromId(c.name))
    )
    .slice(0, VISITOR_LIMITS.toolCallsPerMessage);
}

/**
 * How many wire messages one stored message becomes for the visitor route, and
 * roughly how many characters they carry once cut (see visitorWireMessages).
 * Leaving out calls to tools not offered only makes it smaller.
 */
function visitorWireSize(m: ChatMessage): { count: number; chars: number } {
  const text = (blocks: ContentBlock[]) =>
    blocks.reduce((n, c) => n + (c.type === "text" ? c.text.length : 0), 0);
  if (m.role === "user") {
    return { count: 1, chars: Math.min(text(m.content), VISITOR_LIMITS.userChars) };
  }
  if (m.role === "assistant") {
    if (!isWireValidAssistant(m)) return { count: 0, chars: 0 };
    const args = sendableCalls(m).reduce((n, c) => n + JSON.stringify(c.input ?? {}).length, 0);
    return { count: 1, chars: Math.min(text(m.content), VISITOR_LIMITS.assistantChars) + args };
  }
  let count = 0;
  let chars = 0;
  for (const c of m.content) {
    if (c.type !== "tool_result") continue;
    count++;
    const body = typeof c.content === "string" ? c.content : c.content.map((b) => b.text).join("");
    chars += Math.min(body.length, VISITOR_LIMITS.toolResultChars);
  }
  return { count, chars };
}

/**
 * The most recent stretch of a visitor's chat that fits the visitor route:
 * at most VISITOR_LIMITS.historyMessages wire messages and
 * VISITOR_LIMITS.totalChars characters, always starting at a user message. A
 * tool call and its result sit between two user messages, so a cut there
 * never separates them. When even the latest user message's turn is over a
 * limit, that turn is returned whole (runVisitorLoop stops before sending it).
 * Exported for tests.
 */
export function trimVisitorHistory(
  messages: ChatMessage[],
  max: number = VISITOR_LIMITS.historyMessages,
  maxChars: number = VISITOR_LIMITS.totalChars
): ChatMessage[] {
  let count = 0;
  let chars = 0;
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = visitorWireSize(messages[i]);
    count += size.count;
    chars += size.chars;
    if (messages[i].role !== "user") continue;
    const over = count > max || chars > maxChars;
    if (over && start !== -1) break;
    start = i;
    if (over || count >= max) break;
  }
  return start === -1 ? [] : messages.slice(start);
}

/** Whether a trimmed history is still over the visitor route's limits. */
function overVisitorLimits(history: ChatMessage[]): boolean {
  let count = 0;
  let chars = 0;
  for (const m of history) {
    const size = visitorWireSize(m);
    count += size.count;
    chars += size.chars;
  }
  return count > VISITOR_LIMITS.historyMessages || chars > VISITOR_LIMITS.totalChars;
}

/**
 * A visitor's history on the wire: no system message (the route owns the
 * prompt); user text, replies and tool results cut to their
 * VISITOR_LIMITS. A tool call that can't be sent (to a tool not in `offered`,
 * past sendableCalls' limits, or with no result after it) is left out
 * together with its result, so the request never names a function missing
 * from its `tools` and every result still answers a call.
 *
 * Results are matched to the calls of the assistant message just before them,
 * the way the route checks them, never to a call anywhere in the history: an
 * id can come back in a later round (a gateway that sends none gets `tc_0`
 * every round), and a result must not attach itself to the wrong message.
 */
function visitorWireMessages(
  messages: ChatMessage[],
  offered: ReadonlySet<string>
): VisitorWireMessage[] {
  const out: VisitorWireMessage[] = [];
  /** The calls of the assistant message just sent, still waiting for their results. */
  let pending = new Set<string>();
  messages.forEach((m, i) => {
    if (m.role === "user") {
      pending = new Set();
      const text = m.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .slice(0, VISITOR_LIMITS.userChars);
      out.push({ role: "user", content: text });
      return;
    }
    if (m.role === "assistant") {
      const next = messages[i + 1];
      const answered = new Set(
        next?.role === "tool"
          ? next.content.flatMap((c) => (c.type === "tool_result" ? [c.tool_use_id] : []))
          : []
      );
      const ids = new Set<string>();
      const calls = sendableCalls(m)
        .filter((c) => {
          if (!offered.has(claudeNameFromId(c.name)) || !answered.has(c.id) || ids.has(c.id)) {
            return false;
          }
          ids.add(c.id);
          return true;
        })
        .map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: claudeNameFromId(c.name), arguments: JSON.stringify(c.input ?? {}) },
        }));
      pending = ids;
      const text = m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const content = text ? cutToolResult(text, VISITOR_LIMITS.assistantChars) : null;
      if (content === null && calls.length === 0) return;
      out.push(
        calls.length > 0
          ? { role: "assistant", content, tool_calls: calls }
          : { role: "assistant", content }
      );
      return;
    }
    for (const c of m.content) {
      if (c.type !== "tool_result" || !pending.delete(c.tool_use_id)) continue;
      const body =
        typeof c.content === "string" ? c.content : c.content.map((b) => b.text).join("");
      out.push({ role: "tool", tool_call_id: c.tool_use_id, content: cutToolResult(body) });
    }
  });
  return out;
}

/**
 * Take the calls that won't run out of a visitor's round (see
 * runnableVisitorCalls), so they never reach the history: not the next
 * request, and not the tools offered with it, which include every tool the
 * history calls. Otherwise naming any action once, even one refused, would be
 * enough to have it offered, and runnable, a round later. A message left with
 * nothing to show is removed. Returns whether any call was taken out.
 */
function dropUnrunnableCalls(m: ChatMessage, run: readonly ToolUseBlock[]): boolean {
  const keep = new Set<ContentBlock>(run);
  const content = m.content.filter((c) => c.type !== "tool_use" || keep.has(c));
  if (content.length === m.content.length) return false;
  const store = useAgentStore.getState();
  if (content.some((c) => c.type === "tool_use" || (c.type === "text" && c.text.length > 0))) {
    store.patchMessage(m.id, content);
  } else {
    store.removeMessage(m.id);
  }
  return true;
}

/** Whether the chat still holds this message (Clear chat, or a reset, empties it). */
function chatStillHas(id: string): boolean {
  return useAgentStore.getState().messages.some((m) => m.id === id);
}

/**
 * The note for a round that just ended (see endNoteFor), read from its reply
 * in the store: settleAssistant has removed a reply with nothing to show.
 */
function roundEndNote(
  assistantId: string,
  finishReason: string | null,
  cut: boolean,
  visitor: boolean
): ChatNotice | null {
  const msg = useAgentStore.getState().messages.find((m) => m.id === assistantId);
  const hasText = msg?.content.some((c) => c.type === "text" && c.text.trim().length > 0) ?? false;
  return endNoteFor({ hasText, finishReason, cut, visitor });
}

/** The tool id a visitor's request names: a released tool's, never a VIP one. */
function visitorContextToolId(toolId: string | null | undefined): string | undefined {
  const tool = resolvePageTool(toolId);
  return tool && !isVipOnly(tool) ? tool.id : undefined;
}

/**
 * A visitor's turn (visitor AI): the same streaming loop as the owner's, cut
 * down to what a signed-out visitor may do.
 *
 *  - No mode probe, no usage records, no conversation writes: nothing goes to
 *    /api/agent/stream or Supabase. Each request goes to VISITOR_AI_PATH,
 *    which owns the model, the prompt and the meter.
 *  - At most VISITOR_LIMITS.maxToolRounds requests; when the last one still
 *    calls tools, they run and a local note stands in for a wrap-up, rather
 *    than spending another of the visitor's model calls on a summary.
 *  - The tools are buildVisitorTurnTools' (≤ VISITOR_LIMITS.maxTools, never
 *    the full registry). Only calls the next request can carry back may run
 *    (runnableVisitorCalls: offered with this request, within the wire's
 *    limits); the rest are taken out of the history unrun. Every non-read
 *    action asks first: autoApprove is never used.
 *  - The history sent is trimVisitorHistory's, and tool results are cut.
 *  - A round that ends with no reply, or a reply cut off (by the model's
 *    token limit, the route's time limit, or a stream that just ends), says so.
 *  - While a visitor live room is open in this browser, in this tab or
 *    another (lib/realtime/live-visitor-room.ts), no tools are offered and
 *    none runs: not one offered before the room opened, and not one whose
 *    confirmation was still waiting. The turn stops there with
 *    NOTICE_TEXT.liveRoom. Amr still answers questions.
 */
async function runVisitorLoop(opts: StreamOptions): Promise<void> {
  const toolId = resolvePageTool(opts.toolId)?.id ?? null;
  const contextToolId = visitorContextToolId(opts.toolId);
  const rankText = recentUserText(useAgentStore.getState().messages);
  const errorRepeats = new Map<string, number>();

  for (let round = 0; round < VISITOR_LIMITS.maxToolRounds; round++) {
    // As for the owner: a stopped turn sends nothing more from the chat now showing.
    if (opts.signal?.aborted) return;
    const history = trimVisitorHistory(useAgentStore.getState().messages);
    if (overVisitorLimits(history)) {
      useAgentStore.getState().setNotice(asNote("round_limit", VISITOR_ERROR_TEXT.round_limit));
      return;
    }
    const tools = buildVisitorTurnTools(rankText, history, toolId);
    const offered = new Set(tools.map((t) => t.function.name));
    const body: VisitorRequestBody = {
      messages: visitorWireMessages(history, offered),
      ...(tools.length > 0 ? { tools } : {}),
      context: contextToolId ? { toolId: contextToolId } : {},
    };

    const { stopReason, assistantId, finishReason, cut } = await openOneTurn(
      "visitor",
      body as unknown as Record<string, unknown>,
      opts.signal
    );
    if (stopReason !== "tool_use") {
      // No reply at all (all reasoning, or a call cut off) still cost a
      // message: say so rather than let "thinking…" just vanish. So does a
      // reply that stops short: the visitor can't tell it from a finished one.
      // A refusal (no assistantId) has already said why, and a visitor who
      // pressed Stop knows.
      const endNote =
        assistantId && !opts.signal?.aborted
          ? roundEndNote(assistantId, finishReason ?? null, cut === true, true)
          : null;
      if (endNote) useAgentStore.getState().setNotice(endNote);
      return;
    }

    const lastAssistant = useAgentStore.getState().messages.find((m) => m.id === assistantId);
    if (!lastAssistant) return;
    // BUG-H1, as for the owner: never run a `_partial` tool_use. And never run
    // a call the next request couldn't carry back: one not offered (invented,
    // or a canvas action), past the per-message count, or with arguments over
    // the limit. Those leave the history unrun (dropUnrunnableCalls). The same
    // goes for every call of a reply that arrives once the tab is in a live
    // room, whatever was offered when the request went out.
    const live = inLiveVisitorRoom();
    const toolUses = live ? [] : runnableVisitorCalls(lastAssistant, offered);
    dropUnrunnableCalls(lastAssistant, toolUses);
    if (toolUses.length === 0) {
      // Nothing to run, so nothing to send back: another request would end on
      // the visitor's message and count as a new one. Stop here instead.
      useAgentStore
        .getState()
        .setNotice(
          live
            ? asNote("live_room", NOTICE_TEXT.liveRoom)
            : asNote("cant_do_here", NOTICE_TEXT.cantDoHere)
        );
      return;
    }

    // Either wire form of a name (dotted or underscored) maps to the offered
    // one. Every call here passes unless the tab enters a live room meanwhile:
    // executeToolUse asks again before it runs a call, and once more after a
    // confirmation, so the answer is the one that holds at that moment.
    const isAllowed = (name: string) => !inLiveVisitorRoom() && offered.has(claudeNameFromId(name));
    const results: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      const result = await executeToolUse(tu, {
        userId: opts.userId,
        confirm: makeConfirmHandler(tu),
        autoApprove: false,
        forceConfirmWrites: true,
        isAllowed,
        signal: opts.signal,
      });
      results.push(result);
      if (result.is_error) errorRepeats.set(tu.name, (errorRepeats.get(tu.name) ?? 0) + 1);
      else errorRepeats.delete(tu.name);
    }
    // The chat was cleared while a tool ran or waited for its confirmation
    // (Clear chat, or the visitor turned out to be the owner): its calls are
    // gone, so their results would only be strays in the new, empty chat.
    if (!chatStillHas(lastAssistant.id)) return;
    useAgentStore.getState().appendMessage({
      id: msgId(),
      role: "tool",
      content: results,
      createdAt: new Date().toISOString(),
    });

    // Stopped mid-round: every call now has its result (above), so the chat
    // can carry on from here; just don't open another round.
    if (opts.signal?.aborted) return;

    // The tab entered a live room during this round. The next request would
    // offer no tools, so it would leave this round's calls out and end on the
    // visitor's message, which counts as a new one. Stop and say why instead.
    if (inLiveVisitorRoom()) {
      useAgentStore.getState().setNotice(asNote("live_room", NOTICE_TEXT.liveRoom));
      return;
    }

    let wedged = false;
    errorRepeats.forEach((n) => {
      if (n >= MAX_SAME_ERROR_REPEATS) wedged = true;
    });
    if (wedged) {
      useAgentStore.getState().setNotice(asNote("repeated_failure", NOTICE_TEXT.repeatedFailure));
      return;
    }
  }

  // Every round ran tools: say what happened instead of asking for a wrap-up.
  // The stand-in says it once, with its follow-up line, and no notice repeats
  // it: a visitor's round_limit offers no Go on (notice-actions).
  if (opts.signal?.aborted) return;
  withWrapUpText(null, VISITOR_LIMITS.maxToolRounds);
}

/**
 * The note shown when a round-limit turn's wrap-up wrote no text: how many
 * tool calls this turn ran and which actions failed, read from the transcript
 * since the last user message. It is narration about Amr, in the third
 * person, not his own words. `followUp` ends it with the line that a
 * follow-up carries on; the owner's turn leaves that to its round-limit
 * notice, so the chat says it once. Exported for tests.
 */
export function roundLimitNote(
  messages: ChatMessage[],
  rounds: number = MAX_TOOL_USE_ROUNDS,
  followUp = true
): string {
  const turn = messages.slice(lastUserIndex(messages) + 1);
  // As in canRetryLastTurn, each result is named from the calls of the
  // assistant message just before it: an id can come back in a later round.
  let actionOf = new Map<string, string>();
  let ran = 0;
  let failed = 0;
  const failedActions = new Set<string>();
  for (const m of turn) {
    if (m.role === "assistant") {
      actionOf = new Map();
      for (const c of m.content) {
        if (c.type === "tool_use") actionOf.set(c.id, registry.resolve(c.name)?.id ?? c.name);
      }
      continue;
    }
    if (m.role !== "tool") continue;
    for (const c of m.content) {
      if (c.type !== "tool_result") continue;
      ran++;
      if (c.is_error) {
        failed++;
        failedActions.add(actionOf.get(c.tool_use_id) ?? "unknown action");
      }
    }
  }
  const calls = `${ran} tool call${ran === 1 ? "" : "s"}`;
  const failures =
    failed === 0
      ? "none failed"
      : `${failed} failed (${Array.from(failedActions)
          .map((a) => `\`${a}\``)
          .join(", ")})`;
  const facts = `Amr used all ${rounds} tool rounds for this request before he could sum up. This turn ran ${calls}; ${failures}.`;
  return followUp ? `${facts} Send a follow-up and he'll carry on.` : facts;
}

/**
 * The wrap-up's message id, made to carry text: its own when the model wrote
 * some, otherwise roundLimitNote — in the wrap-up's message if it is still
 * there, or in a new assistant message when the wrap-up never made one (it
 * failed, or settleAssistant removed it as empty). `followUp` as for
 * roundLimitNote.
 */
function withWrapUpText(
  assistantId: string | null,
  rounds: number = MAX_TOOL_USE_ROUNDS,
  followUp = true
): string {
  const store = useAgentStore.getState();
  const msg = assistantId ? store.messages.find((m) => m.id === assistantId) : undefined;
  if (msg?.content.some((c) => c.type === "text" && c.text.trim().length > 0)) return msg.id;
  // Narration, not Amr's words: marked, so the chat draws it as a caption.
  const note: ContentBlock[] = [
    { type: "text", text: roundLimitNote(store.messages, rounds, followUp), note: true },
  ];
  if (msg) {
    store.patchMessage(msg.id, note);
    return msg.id;
  }
  const id = msgId();
  store.appendMessage({
    id,
    role: "assistant",
    content: note,
    createdAt: new Date().toISOString(),
  });
  return id;
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
  /** The stream's own finish_reason ("stop", "length", "tool_calls"…), when it sent one. */
  finishReason?: string | null;
  /**
   * The stream ended without a finish_reason, and either without [DONE] (it
   * was closed from outside rather than finished; also true after an abort,
   * which the caller already knows about) or after reporting an error of its
   * own (`data: {"error":…}`).
   */
  cut?: boolean;
}

/**
 * Open one chat-completion turn over SSE, accumulate text + tool_calls
 * into an assistant message in the store, and return our internal
 * stop_reason ("tool_use" or "end_turn") plus that message's id.
 *
 * `ignoreToolCalls` (the wrap-up turn) keeps only the text: tool-call deltas
 * are dropped and the turn always ends, so no tool_call is left in the
 * transcript without a result.
 *
 * The reply is written by its id only (the store's streamingMessageId points
 * at it while it streams), so a chat that changed under the turn never gets
 * it. Writes are coalesced to one per animation frame (frameFlusher), and the
 * final state is written at once when the stream ends, before the reply is
 * settled. A round that was stopped never ends in "tool_use": its calls are
 * dropped unrun with it.
 */
async function openOneTurn(
  mode: AgentMode,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  newTurn = false,
  onUsage?: (totalTokens: number) => void,
  turnOpts: { ignoreToolCalls?: boolean } = {}
): Promise<TurnOutcome> {
  const response = await openStream(mode, body, signal, newTurn);

  const early =
    mode === "visitor"
      ? await handleVisitorResponse(response, signal)
      : await handleOwnerResponse(response, signal, mode);
  if (early) return early;
  // Both checks end the round on a response without a body; this only narrows the type.
  const stream = response.body;
  if (!stream) return { stopReason: "end_turn", assistantId: null };
  // Stopped (or the chat changed) while the response was on its way: no reply
  // goes into the chat now showing, not even an empty one for a moment.
  if (signal?.aborted) {
    void stream.cancel().catch(() => {});
    return { stopReason: "end_turn", assistantId: null };
  }

  const assistantMsg: ChatMessage = {
    id: msgId(),
    role: "assistant",
    content: [],
    createdAt: new Date().toISOString(),
  };
  const store = useAgentStore.getState();
  store.appendMessage(assistantMsg);
  store.setStreamingMessageId(assistantMsg.id);

  // OpenAI / GLM streaming parser:
  //   data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}
  //   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":...,"function":{"name":...,"arguments":""}}]},...}]}
  //   data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{...}"}}]},...}]}
  //   data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
  //   data: [DONE]
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let stopReason = "end_turn";

  /** Text accumulates as a single content block (OpenAI emits one
   *  content stream, not multiple addressable blocks like Anthropic). */
  const wip: WipState = {
    text: "",
    toolCalls: new Map(),
    ignoreToolCalls: turnOpts.ignoreToolCalls === true,
    dirty: false,
  };
  const flusher = frameFlusher(() => flushAssistant(wip, assistantMsg.id));

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
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (err) {
        // The body failed after the stream's own [DONE]: the answer (or its
        // tool calls) was whole already and only the connection's close went
        // wrong, so the round ends as it would have on a clean close. A Stop
        // is not that: it goes on to the catch below.
        if (wip.sawDone && !signal?.aborted) break;
        throw err;
      }
      const { value, done } = read;
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
        if (wip.dirty) flusher.schedule();
      }
    }
    // Tail flush in case the server closed without a trailing \n\n.
    if (buf.trim().length > 0) {
      const sr = handleSseChunk(buf, wip);
      if (sr) stopReason = sr;
    }
    // The stream is over: every call's arguments are as whole as they will get.
    closeToolCalls(wip);
    flusher.flush();
    // Usage is optional: a backend that never sends it just records nothing.
    if (wip.usage !== undefined && wip.usage > 0) onUsage?.(wip.usage);
    if (wip.ignoreToolCalls || signal?.aborted) stopReason = "end_turn";
    settleAssistant(assistantMsg.id, stopReason === "tool_use");
    return {
      stopReason,
      assistantId: assistantMsg.id,
      finishReason: wip.finishReason ?? null,
      cut: !wip.finishReason && (wip.sawError === true || !wip.sawDone),
    };
  } catch (err) {
    // The stream failed mid-way, before its [DONE] (network error, the route's
    // idle timeout), or was stopped: whatever tool call it carried never gets
    // a result. What did arrive is written first, so the text stays.
    flusher.flush();
    settleAssistant(assistantMsg.id, false);
    throw err;
  } finally {
    // No frame may write after the reply was settled.
    flusher.cancel();
    const s = useAgentStore.getState();
    if (s.streamingMessageId === assistantMsg.id) s.setStreamingMessageId(null);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** How long a write waits when no animation frame will come (a hidden tab, or no rAF). */
const HIDDEN_FLUSH_MS = 50;

interface Flusher {
  /** Write on the next animation frame (or after HIDDEN_FLUSH_MS); one write however often it's asked. */
  schedule(): void;
  /** Write now, instead of the one waiting. */
  flush(): void;
  /** Drop the write that is waiting. */
  cancel(): void;
}

/**
 * Coalesce a stream's writes to the store to one per animation frame. A tab
 * that is hidden gets no frames, so a timer stands in, also for a frame asked
 * for before the tab was hidden; whichever comes first writes.
 */
function frameFlusher(write: () => void): Flusher {
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = null;
    timer = null;
  };
  const flush = () => {
    cancel();
    write();
  };
  return {
    schedule() {
      const hidden = typeof document !== "undefined" && document.hidden;
      if (!hidden && typeof requestAnimationFrame === "function") {
        if (frame === null && timer === null) frame = requestAnimationFrame(flush);
        return;
      }
      if (timer === null) timer = setTimeout(flush, HIDDEN_FLUSH_MS);
    },
    flush,
    cancel,
  };
}

/**
 * The error code a refusal's JSON body names (`{"error": "…"}`), or null when
 * the body is not JSON or names none.
 */
function refusalCode(body: string): string | null {
  try {
    const json = JSON.parse(body) as { error?: unknown } | null;
    return typeof json?.error === "string" ? json.error : null;
  } catch {
    return null;
  }
}

/**
 * The owner's response checks, before its stream is read: update the usage bar
 * from the route's X-RateLimit-* headers (server mode, turn start), and turn a
 * refusal into a notice in plain words (ownerRefusalNotice), with its status
 * and body for the console only. Returns the round's outcome when it ends
 * here, or null to read the stream. A refusal that lands after the turn was
 * stopped says nothing: the chat on screen may not be this turn's any more.
 */
async function handleOwnerResponse(
  response: Response,
  signal: AbortSignal | undefined,
  mode: AgentMode
): Promise<TurnOutcome | null> {
  const store = useAgentStore.getState();
  if (response.ok && response.body) {
    const rl = parseRateLimitHeaders(response.headers);
    if (rl) store.setRateLimit(rl);
    return null;
  }
  const detail = await response.text().catch(() => "");
  const code = refusalCode(detail);
  // A 429 of the route's own means a window cap was hit; one the gateway
  // behind it passed on ("upstream") is the AI service being busy.
  const limited = response.status === 429 && code !== "upstream";
  const rl = parseRateLimitHeaders(response.headers, limited);
  if (rl) store.setRateLimit(rl);
  if (signal?.aborted) return { stopReason: "end_turn", assistantId: null };
  console.warn(`[agent] the request was refused (${response.status}):`, detail.slice(0, 200));
  store.setNotice(ownerRefusalNotice(response.status, mode === "client", code));
  return { stopReason: "end_turn", assistantId: null };
}

function isVisitorErrorCode(v: unknown): v is VisitorErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VISITOR_ERROR_TEXT, v);
}

/**
 * The visitor's response checks, before its stream is read. The allowance in
 * the x-visitor-ai-* headers is read on EVERY response, refusals included (a
 * response without them keeps the last one). A refusal whose code means "no
 * more AI for now" (VISITOR_FALLBACK_CODES) sets visitorFallback, so the panel
 * goes back to the tool finder; every other refusal (a busy or failing AI
 * service, a timeout, a bad request) only shows a notice (visitorRefusalNotice).
 * A visitor who pressed Stop while the refusal was still arriving is told
 * nothing: they know why there is no answer, and the abort has usually taken
 * the refusal's reason with it. Returns the round's outcome when it ends here,
 * or null to read the stream.
 */
async function handleVisitorResponse(
  response: Response,
  signal: AbortSignal | undefined
): Promise<TurnOutcome | null> {
  const store = useAgentStore.getState();
  const quota = parseVisitorQuota(response.headers);
  if (quota) store.setVisitorQuota(quota);
  if (response.ok && response.body) return null;

  let code: VisitorErrorCode | null = null;
  try {
    const json = (await response.json()) as { error?: unknown };
    if (isVisitorErrorCode(json.error)) code = json.error;
  } catch {
    /* not JSON: fall back to the status below */
  }
  if (signal?.aborted) return { stopReason: "end_turn", assistantId: null };
  const fallback = !!code && VISITOR_FALLBACK_CODES.has(code);
  if (fallback) store.setVisitorFallback(code);
  // A refusal with no code of the route's own: its status is for the console.
  if (!code) console.warn(`[visitor-ai] the request was refused (${response.status})`);
  // "No more AI for now" is said by what takes the composer's place (the
  // read-only footer) or the guide's note, so the chat's announcer stays quiet.
  // The notice stays, for Amr's look and for what clears it by its kind.
  const notice = visitorRefusalNotice(code, response.status);
  store.setNotice(fallback ? { ...notice, quiet: true } : notice);
  return { stopReason: "end_turn", assistantId: null };
}

interface WipToolCall {
  id: string;
  name: string;
  /** The arguments JSON as streamed so far: kept here, never in the store. */
  jsonAccum: string;
  /**
   * The call's block is over (a later call started, the stream finished or
   * ended): `input` holds its arguments, parsed once. A call that streams
   * more after that opens again.
   */
  closed: boolean;
  input: Record<string, unknown>;
  /** The block last written to the store, kept while nothing about it changes. */
  block: ToolUseBlock | null;
}

interface WipState {
  /** The reply's text so far. */
  text: string;
  /** Keyed by the streaming index (NOT the registry id). OpenAI emits
   *  tool_calls in sparse order — each chunk targets an index that
   *  refers back to the same call as previous chunks. */
  toolCalls: Map<number, WipToolCall>;
  /** Something the store shows changed since the last write. */
  dirty: boolean;
  /** Total tokens from the stream's usage, if any chunk carried it. */
  usage?: number;
  /** Drop tool-call deltas (the wrap-up turn keeps only text). */
  ignoreToolCalls?: boolean;
  /**
   * The finish_reason the stream sent, as sent: the last one, except that the
   * visitor route's own "time_limit" never replaces one the model already sent.
   */
  finishReason?: string;
  /** The stream sent its closing [DONE]. */
  sawDone?: boolean;
  /** The stream carried an error event of its own (`data: {"error":…}`). */
  sawError?: boolean;
}

/**
 * Total tokens from an OpenAI-style `usage` object, or null when it carries no
 * usable count. Prefers `total_tokens`; falls back to prompt + completion for
 * backends that leave the total out.
 */
export function usageTotal(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const total = num(u.total_tokens);
  if (total !== null) return total;
  const prompt = num(u.prompt_tokens);
  const completion = num(u.completion_tokens);
  if (prompt === null && completion === null) return null;
  return (prompt ?? 0) + (completion ?? 0);
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
  if (dataLine === "[DONE]") {
    wip.sawDone = true;
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return null;
  }

  // Usage (stream_options.include_usage) is optional and may ride on any
  // chunk: OpenAI sends a trailing chunk with empty choices (and `usage: null`
  // before it), GLM puts it on the finish chunk, some proxies repeat a running
  // count. Capture it before the choices guard below; the last count wins.
  const usage = usageTotal(payload.usage);
  if (usage !== null) wip.usage = usage;

  // A gateway that fails half way can say so inside the stream, as an event
  // with an `error` and no choices, and still close it with [DONE]. That is
  // not a finished answer, whatever follows: the round counts as cut.
  if (payload.error) wip.sawError = true;

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
    wip.text += delta.content;
    wip.dirty = true;
  }

  // Tool-call deltas. Each entry refers to a specific call by index;
  // we accumulate `id`, `name`, and a JSON string for `arguments`. The
  // arguments are parsed once, when the call's block closes, never per chunk.
  if (Array.isArray(delta.tool_calls) && !wip.ignoreToolCalls) {
    for (const tc of delta.tool_calls) {
      let call = wip.toolCalls.get(tc.index);
      if (!call) {
        call = { id: "", name: "", jsonAccum: "", closed: false, input: {}, block: null };
        wip.toolCalls.set(tc.index, call);
        wip.dirty = true;
      }
      if (tc.id && tc.id !== call.id) {
        call.id = tc.id;
        call.block = null;
        wip.dirty = true;
      }
      if (tc.function?.name && tc.function.name !== call.name) {
        call.name = tc.function.name;
        call.block = null;
        wip.dirty = true;
      }
      if (tc.function?.arguments) {
        call.jsonAccum += tc.function.arguments;
        // More of a call already taken as whole (a gateway that interleaves).
        if (call.closed) {
          call.closed = false;
          call.block = null;
          wip.dirty = true;
        }
      }
      // Calls stream one after another, so one that starts ends those before it.
      wip.toolCalls.forEach((other, i) => {
        if (i < tc.index) closeToolCall(other, wip);
      });
    }
  }

  if (choice.finish_reason) {
    closeToolCalls(wip);
    // The visitor route ends a too-long answer with its own "time_limit". When
    // its clock ran out between the model's finish and [DONE], the answer (or
    // its tool calls) was already complete: keep the model's finish.
    if (choice.finish_reason === VISITOR_TIME_LIMIT_FINISH && wip.finishReason) return null;
    wip.finishReason = choice.finish_reason;
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

/**
 * Settle a round's assistant message once its stream is over. Its tool calls
 * survive only when the round ends in "tool_use", the one ending whose calls
 * get results. Any other ending — an error or abort mid-stream, a stream that
 * closed before its finish_reason, a "stop" that still carried a call, the
 * wrap-up — drops them: otherwise the next request would replay a tool_call
 * with no tool message after it, and the endpoint rejects that with a 400
 * until the page is reloaded. A message left with nothing to show is removed,
 * so the chat doesn't draw an empty bubble (persistAssistant then skips it).
 */
function settleAssistant(id: string, keepToolCalls: boolean): void {
  const store = useAgentStore.getState();
  const msg = store.messages.find((m) => m.id === id);
  if (!msg) return;
  const content = keepToolCalls ? msg.content : msg.content.filter((c) => c.type !== "tool_use");
  const showsSomething = content.some(
    (c) => (c.type === "text" && c.text.length > 0) || c.type === "tool_use"
  );
  if (!showsSomething) store.removeMessage(id);
  else if (content.length !== msg.content.length) store.patchMessage(id, content);
}

/**
 * A tool call's arguments, parsed once its block is over. Arguments that
 * don't parse to an object (cut off, or not JSON) keep the `_partial` marker:
 * such a call is never run and never sent back (see isPartialInput).
 */
function parseToolArguments(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null) return {};
    if (typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* cut off, or not JSON */
  }
  return { _partial: true };
}

/** Close one call's block: its arguments are as whole as they will get. */
function closeToolCall(call: WipToolCall, wip: WipState): void {
  if (call.closed) return;
  call.closed = true;
  call.input = parseToolArguments(call.jsonAccum);
  call.block = null;
  wip.dirty = true;
}

/** Close every call's block (the stream finished or ended). */
function closeToolCalls(wip: WipState): void {
  wip.toolCalls.forEach((call) => closeToolCall(call, wip));
}

/**
 * Write the reply so far to its own message, by id: a chat that no longer
 * holds it (New chat, another thread) gets nothing. A call whose block is
 * still open shows the cheap `{_partial: true}` marker instead of its
 * arguments; each block is built once and kept while nothing about it
 * changes.
 */
function flushAssistant(wip: WipState, id: string): void {
  if (!wip.dirty) return;
  wip.dirty = false;
  const content: ContentBlock[] = [];
  if (wip.text.length > 0) {
    content.push({ type: "text", text: wip.text });
  }
  // Tool calls in stream-index order.
  const indices = Array.from(wip.toolCalls.keys()).sort((a, b) => a - b);
  for (const i of indices) {
    const tc = wip.toolCalls.get(i);
    if (!tc) continue;
    tc.block ??= {
      type: "tool_use",
      id: tc.id || `tc_${i}`,
      name: tc.name,
      input: tc.closed ? tc.input : { _partial: true },
    };
    content.push(tc.block);
  }
  if (!chatStillHas(id)) return;
  useAgentStore.getState().patchMessage(id, content);
}

async function openStream(
  mode: AgentMode,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  newTurn = false
): Promise<Response> {
  if (mode === "visitor") {
    // No cookies: the visitor route needs none, and a visitor's request
    // carries nothing about them beyond what the network itself does.
    return fetch(VISITOR_AI_PATH, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  }
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
  // `reasoning_effort` is for the server's GLM-5.3 backends; the BYOK request
  // goes out exactly as it did before that field existed.
  const byokBody: Record<string, unknown> = { ...body, model: cfg.model || DEFAULT_MODEL };
  delete byokBody.reasoning_effort;
  return fetch(GLM_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(byokBody),
    signal,
  });
}

/** "visitor" is the visitor route (visitor AI); it is never probed for. */
type AgentMode = "server" | "client" | "visitor";

interface ModeProbe {
  mode: AgentMode;
  serverModel: string | null;
  /**
   * The probe failed (then mode is "client", the fallback): the status it was
   * refused with, or 0 when it got no answer at all.
   */
  failed?: number;
}

/**
 * Probe the server route to learn which transport to use AND which
 * model the server is configured for (so the client doesn't have to
 * second-guess). Cached for the session — on SUCCESS only, so a single
 * failed probe can't permanently force BYOK.
 */
let cachedProbe: ModeProbe | null = null;
async function detectMode(): Promise<ModeProbe> {
  if (cachedProbe) return cachedProbe;
  let failed = 0;
  try {
    const res = await fetch("/api/agent/stream", { method: "GET" });
    failed = res.status;
    if (res.ok) {
      const json = (await res.json()) as { mode?: string; model?: string | null };
      cachedProbe = {
        mode: json.mode === "server" ? "server" : "client",
        serverModel: typeof json.model === "string" ? json.model : null,
      };
      return cachedProbe;
    }
  } catch {
    /* fall through to the un-memoised client fallback below */
  }
  // Only a SUCCESSFUL probe is memoised. Caching the failure path pinned the
  // whole page session to BYOK after one cold-start 502 / transient offline /
  // expired session, throwing "No GLM key available…" on every send until a
  // reload. `use-agent-backend.ts` caches on success only for the same reason.
  // `failed` lets an owner's turn with no key of its own ask once more, and
  // then say the server couldn't be reached rather than that no key is set.
  return { mode: "client", serverModel: null, failed };
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
 *
 * Every tool_call goes out with its result, and every result with its call:
 * a call is sent only when a tool message right after its assistant message
 * answers it, and a result only when it answers a call of the assistant
 * message just before it. An orphan either way (a turn stopped between the
 * two, a thread saved before this rule, an id a gateway reused in a later
 * round) is left out, since the endpoint rejects the whole request over it.
 */
function wireMessages(messages: ChatMessage[], system: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }];
  /** The calls of the assistant message just sent, still waiting for their results. */
  let pending = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      pending = new Set();
      const text = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      out.push({ role: "user", content: text });
      continue;
    }

    if (m.role === "assistant") {
      const answered = resultIdsAfter(messages, i);
      const sent = new Set<string>();
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
          // never produced either — see BUG-H1 in runToolUseLoop.) A call
          // with no result after it, or one already sent, goes the same way.
          if (isPartialInput(c.input) || !answered.has(c.id) || sent.has(c.id)) {
            continue;
          }
          sent.add(c.id);
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
      pending = sent;
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

    // role "tool" — fan out one OpenAI tool message per result block that
    // answers a call just sent (each once).
    for (const c of m.content) {
      if (c.type !== "tool_result" || !pending.delete(c.tool_use_id)) continue;
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

/** The ids the tool messages right after `messages[i]` answer (until the next other message). */
function resultIdsAfter(messages: ChatMessage[], i: number): Set<string> {
  const ids = new Set<string>();
  for (let j = i + 1; j < messages.length && messages[j].role === "tool"; j++) {
    for (const c of messages[j].content) if (c.type === "tool_result") ids.add(c.tool_use_id);
  }
  return ids;
}

/** The confirm card's handler for one call: it shows `prompt` (execute-tool's words) and waits for the answer. */
function makeConfirmHandler(block: ToolUseBlock): (prompt: ConfirmPrompt) => Promise<boolean> {
  return async (prompt: ConfirmPrompt) => {
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
        prompt,
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
      // GLM-5.3 always thinks first: it streams its chain-of-thought as
      // reasoning_content (which we ignore) and the title only lands in
      // `content` afterward. Ask for little reasoning, and leave enough budget
      // that the reasoning can't use it all up before the title is written.
      max_tokens: TITLE_MAX_TOKENS,
      reasoning_effort: "low",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You title conversations. Reply with only a 3 to 6 word title, with no quotes, no preamble and no trailing punctuation.",
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
