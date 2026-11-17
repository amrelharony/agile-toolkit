"use client";

import { create } from "zustand";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import type { ChatMessage, ConversationMeta, PendingToolUse } from "./types";

/** Usage snapshot parsed from the stream route's X-RateLimit-* headers. */
export interface RateLimitInfo {
  dailyUsed: number;
  dailyMax: number;
  weeklyUsed: number;
  weeklyMax: number;
  monthlyUsed: number;
  monthlyMax: number;
  /** True once a window cap was hit (the route returned 429). */
  limited: boolean;
}

/**
 * A visitor's message allowance, from the visitor route's x-visitor-ai-*
 * headers (see VISITOR_HEADERS in lib/visitor-ai/contract).
 */
export interface VisitorQuota {
  /** Messages left today. */
  remaining: number;
  /** The daily message limit. */
  limit: number;
  /** Z.AI's busy hours are on: a smaller allowance applies until they end. */
  peak: boolean;
  /** Messages left in this busy-hours window (null outside it). */
  peakRemaining: number | null;
  /** The limit for one busy-hours window, as configured (null if the route didn't say). */
  peakLimit: number | null;
  /** When this busy-hours window ends, ISO 8601 (null outside it). */
  peakEndsAt: string | null;
  /** When the route sent this (ms since 1970); left out, it counts as just now. */
  receivedAt?: number;
}

/** Whose chat the store holds: the owner's (persisted) or a visitor's (memory only). */
export type ChatProfile = "owner" | "visitor";

/**
 * A line the chat shows under the conversation, as narration: never as Amr's
 * own words and never sent to the model. A "note" is gentle (an answer cut
 * short, a limit reached, something Amr can't do here); an "error" is a real
 * failure. `kind` names the case for the UI (which button to offer, whether
 * Amr frowns); `text` is the line itself.
 */
export interface AgentNotice {
  tone: "note" | "error";
  kind: string;
  text: string;
}

/**
 * Why the store stopped the live turn: Stop ("stop"), New chat or sign-out
 * ("reset"), another thread opened ("thread"), or the chat changing hands
 * between the owner and a visitor ("profile"). Closing the panel never stops it.
 */
export type TurnAbortReason = "stop" | "reset" | "thread" | "profile";

/** The live turn's way to stop itself, registered by the client. */
export type TurnAbort = (reason: TurnAbortReason) => void;

interface AgentState {
  open: boolean;
  /** Currently-loaded conversation, or null for a fresh draft. */
  activeConversationId: string | null;
  activeMeta: ConversationMeta | null;
  /** Messages in the active conversation, in chronological order. */
  messages: ChatMessage[];
  /** Set true while a Claude request is streaming. */
  streaming: boolean;
  /**
   * The assistant message the live turn is writing to (null between turns).
   * Cleared when streaming ends, when that message is removed, and when the
   * store stops the turn.
   */
  streamingMessageId: string | null;
  /** Tool_use blocks awaiting user approval (one at a time). */
  pendingToolUse: PendingToolUse | null;
  /** When true, write actions execute without per-action confirmation
   *  until the sheet is closed. Read actions never prompt. */
  autoApprove: boolean;
  /** The note or error shown under the chat (cleared on next send). */
  notice: AgentNotice | null;
  /**
   * The text of an error notice, for readers that predate `notice` (null for
   * a note: a gentle note is not an error, so Amr doesn't frown at it).
   */
  error: string | null;
  /**
   * What each profile has typed but not sent. It outlives closing the panel
   * and a look at History; sending clears it, and so does New chat (reset).
   */
  drafts: Record<ChatProfile, string>;
  /**
   * The live turn's abort, registered by the client while a turn runs. The
   * store calls it only on Stop, New chat, a thread switch, sign-out and a
   * profile change, and drops it once called: never on closing the panel.
   */
  abortHook: TurnAbort | null;
  /** Latest agent usage vs. caps (null until the first metered turn). */
  rateLimit: RateLimitInfo | null;
  /** total_tokens for the most recent turn (null until one reports usage). */
  lastTurnTokens: number | null;
  /** Whose chat this is; set by sendUserMessage on every send. */
  chatProfile: ChatProfile;
  /** A visitor's allowance (null until the visitor route answers once). */
  visitorQuota: VisitorQuota | null;
  /**
   * Set when the visitor route refused with a "no more AI for now" code
   * (VISITOR_FALLBACK_CODES): the panel goes back to the tool finder.
   */
  visitorFallback: VisitorErrorCode | null;
}

interface AgentActions {
  openSheet(): void;
  /** Close the panel: clears "Approve all" and denies a waiting card, but the turn goes on. */
  closeSheet(): void;
  toggleSheet(): void;
  setAutoApprove(v: boolean): void;
  /**
   * Show a conversation (a thread from History, a resumed one, or null for a
   * fresh draft). Opening a different thread stops the live turn first.
   */
  setActiveConversation(meta: ConversationMeta | null, messages: ChatMessage[]): void;
  /**
   * Give the chat on screen the conversation just created for it, keeping its
   * messages, the live turn and any waiting card. Refused (false) when another
   * thread is open, or when `holding` is given and the chat no longer holds
   * that message (New chat or a switch happened while it was being created).
   */
  attachConversation(meta: ConversationMeta, holding?: string): boolean;
  /**
   * A thread was renamed (by the owner in History, or with the model's short
   * title after its first turn): the open thread's title follows, so the panel
   * header names it as History does. Any other id changes nothing.
   */
  retitleConversation(id: string, title: string): void;
  appendMessage(msg: ChatMessage): void;
  /**
   * Replace one message's content, by id (no-op when it's gone). The live
   * turn writes its reply this way, never to "the last assistant message",
   * so a chat that changed under it is never written into.
   */
  patchMessage(id: string, content: ChatMessage["content"]): void;
  /** Drop one message, by id (no-op when it's gone). */
  removeMessage(id: string): void;
  setStreaming(v: boolean): void;
  /** Point at the assistant message the live turn writes to (null when none). */
  setStreamingMessageId(id: string | null): void;
  setPendingToolUse(p: PendingToolUse | null): void;
  /** Show a note or an error under the chat (null clears it); `error` mirrors an error's text. */
  setNotice(n: AgentNotice | null): void;
  /** Show an error notice of kind "error" with this text (null clears the notice). */
  setError(e: string | null): void;
  /** Keep what this profile has typed but not sent. */
  setDraft(profile: ChatProfile, text: string): void;
  /** Register the live turn's abort (null drops whichever is registered). */
  setAbortTurn(fn: TurnAbort | null): void;
  /** Drop the registered abort only if it is still `fn` (a turn tidying up after itself). */
  clearAbortTurn(fn: TurnAbort): void;
  /** Stop the live turn (the Stop button): calls the registered abort once and denies a waiting card. */
  abortTurn(reason?: TurnAbortReason): void;
  setRateLimit(r: RateLimitInfo | null): void;
  setLastTurnTokens(n: number | null): void;
  /** Hand the chat to the owner or a visitor; a change stops the live turn and Approve all. */
  setChatProfile(p: ChatProfile): void;
  setVisitorQuota(q: VisitorQuota | null): void;
  setVisitorFallback(code: VisitorErrorCode | null): void;
  /** New chat (and sign-out): stops the live turn and empties the chat and this profile's draft. */
  reset(): void;
}

export const useAgentStore = create<AgentState & AgentActions>()((set, get) => ({
  open: false,
  activeConversationId: null,
  activeMeta: null,
  messages: [],
  streaming: false,
  streamingMessageId: null,
  pendingToolUse: null,
  autoApprove: false,
  notice: null,
  error: null,
  drafts: { owner: "", visitor: "" },
  abortHook: null,
  rateLimit: null,
  lastTurnTokens: null,
  chatProfile: "owner",
  visitorQuota: null,
  visitorFallback: null,

  openSheet: () => set({ open: true }),
  // BUG-G1: also reset autoApprove on close. The docstring promised
  // "until the sheet is closed" but the prior implementation kept the
  // flag set across close/reopen, silently widening write-approval
  // beyond what the user opted into.
  // Closing never stops the turn: an answer goes on with the panel shut
  // (only Stop, New chat, a thread switch, sign-out or a profile change do).
  closeSheet: () => {
    // If the sheet closes while a tool is awaiting approval, settle the
    // hung promise with `false` rather than orphaning it. The agent loop
    // is awaiting that resolve; without this it would wedge. Capture
    // BEFORE the set so we don't fight the set's pending=null write.
    const pending = get().pendingToolUse;
    set({ open: false, pendingToolUse: null, autoApprove: false });
    pending?.resolve(false);
  },
  // Tapping Amr and Ctrl/Cmd+J close through here, so the closing branch
  // goes through closeSheet: every close path clears "Approve all" and
  // denies a card that is still waiting, not just the X button and Escape.
  toggleSheet: () => (get().open ? get().closeSheet() : set({ open: true })),
  setAutoApprove: (v) => set({ autoApprove: v }),

  setActiveConversation: (meta, messages) => {
    // Another thread: the live turn belongs to the one being left, so stop
    // it before the swap (its reply must not write into this one). The same
    // thread reloaded keeps its turn.
    const switching = (meta?.id ?? null) !== get().activeConversationId;
    if (switching) stopTurn("thread");
    // Same as closeSheet — a pending confirmation for the OLD conversation
    // can't carry over to a new one, so settle it as "deny" before swap.
    const { pendingToolUse: pending, streamingMessageId } = get();
    const stillShown =
      !switching &&
      streamingMessageId !== null &&
      messages.some((m) => m.id === streamingMessageId);
    set({
      activeConversationId: meta?.id ?? null,
      activeMeta: meta,
      messages,
      pendingToolUse: null,
      notice: null,
      error: null,
      streamingMessageId: stillShown ? streamingMessageId : null,
      ...(switching ? { streaming: false } : {}),
    });
    pending?.resolve(false);
  },

  attachConversation: (meta, holding) => {
    const s = get();
    if (s.activeConversationId !== null && s.activeConversationId !== meta.id) return false;
    if (holding !== undefined && !s.messages.some((m) => m.id === holding)) return false;
    set({ activeConversationId: meta.id, activeMeta: meta });
    return true;
  },

  retitleConversation: (id, title) => {
    const meta = get().activeMeta;
    if (!meta || meta.id !== id || meta.title === title) return;
    set({ activeMeta: { ...meta, title } });
  },

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  patchMessage: (id, content) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)) })),

  removeMessage: (id) =>
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== id),
      ...(s.streamingMessageId === id ? { streamingMessageId: null } : {}),
    })),

  // When streaming ends no turn is writing anywhere.
  setStreaming: (v) =>
    set(v ? { streaming: true } : { streaming: false, streamingMessageId: null }),
  setStreamingMessageId: (id) => set({ streamingMessageId: id }),
  // If a new pending replaces a still-unsettled old one (shouldn't happen
  // in normal flow, but defensive), reject the old promise so the loop
  // sees the deny and unwinds cleanly.
  setPendingToolUse: (p) => {
    const old = get().pendingToolUse;
    set({ pendingToolUse: p });
    if (old && old !== p) old.resolve(false);
  },
  // `error` mirrors only a real error; a note leaves it null.
  setNotice: (n) => set({ notice: n, error: n?.tone === "error" ? n.text : null }),
  setError: (e) => get().setNotice(e === null ? null : { tone: "error", kind: "error", text: e }),
  setDraft: (profile, text) =>
    set((s) => (s.drafts[profile] === text ? s : { drafts: { ...s.drafts, [profile]: text } })),

  setAbortTurn: (fn) => set({ abortHook: fn }),
  clearAbortTurn: (fn) => {
    if (get().abortHook === fn) set({ abortHook: null });
  },
  abortTurn: (reason = "stop") => {
    stopTurn(reason);
    // A card still waiting belongs to the turn that just stopped.
    get().setPendingToolUse(null);
  },

  setRateLimit: (r) => set({ rateLimit: r }),
  setLastTurnTokens: (n) => set({ lastTurnTokens: n }),
  setChatProfile: (p) => {
    // sendUserMessage sets the profile on every send: the same one changes nothing.
    if (get().chatProfile === p) return;
    // The chat changes hands: the other person's turn, its waiting card and
    // their "Approve all" don't carry over.
    stopTurn("profile");
    const pending = get().pendingToolUse;
    set({
      chatProfile: p,
      autoApprove: false,
      pendingToolUse: null,
      streaming: false,
      streamingMessageId: null,
    });
    pending?.resolve(false);
  },
  setVisitorQuota: (q) => set({ visitorQuota: q }),
  setVisitorFallback: (code) => set({ visitorFallback: code }),

  reset: () => {
    // New chat and sign-out: stop the live turn before the chat empties,
    // so its reply never lands in the fresh one.
    stopTurn("reset");
    const { pendingToolUse: pending, chatProfile, drafts } = get();
    set({
      activeConversationId: null,
      activeMeta: null,
      messages: [],
      streaming: false,
      streamingMessageId: null,
      pendingToolUse: null,
      // BUG-G1: reset autoApprove on full reset too.
      autoApprove: false,
      notice: null,
      error: null,
      // A fresh chat starts from an empty box. The other profile's draft
      // belongs to someone else's chat and stays.
      drafts: { ...drafts, [chatProfile]: "" },
      // A fresh chat may try the AI again. The profile and the visitor's
      // allowance stay: they describe the person, not the conversation
      // (MascotAssistant clears them when a visitor becomes the owner).
      visitorFallback: null,
    });
    pending?.resolve(false);
  },
}));

/**
 * Stop the live turn, if one registered its abort. The hook is taken off the
 * store before it runs, so a turn is stopped once however many paths fire,
 * and it runs before the caller swaps the chat out.
 */
function stopTurn(reason: TurnAbortReason): void {
  const hook = useAgentStore.getState().abortHook;
  if (!hook) return;
  useAgentStore.setState({ abortHook: null });
  try {
    hook(reason);
  } catch (err) {
    // The chat still has to reset or switch; a broken abort must not stop that.
    console.warn("[agent] stopping the turn failed:", err);
  }
}
