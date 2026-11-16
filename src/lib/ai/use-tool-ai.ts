"use client";

/**
 * useToolAi(task): run one tool AI task from a tool page, the one way tools
 * reach Amr's AI.
 *
 *   const ai = useToolAi(suggestOptionsTask);
 *   const result = await ai.run({ question });
 *   if (result.status === "done") show(result.data);           // source "ai" or "fallback"
 *   if (result.status === "error") show(result.fallback);      // the task's no-AI answer
 *
 * Who it asks:
 *   - the signed-in owner: POST /api/ai/tool (the owner's limiter);
 *   - a visitor: POST /api/ai/tool/visitor, only when this build has visitor
 *     AI on (NEXT_PUBLIC_VISITOR_AI) and the visitor agreed to the card. Before
 *     the agreement, `run` sends nothing and answers `needs_consent`; the
 *     caller shows <AiConsentCompact> and calls `agree()`, which stores the
 *     agreement and runs the waiting input.
 *   - A task marked ownerOnly never takes the visitor path: a visitor gets
 *     `available: false`, reason "owner_only", and no consent card.
 *   - While a live room is open in this browser (inLiveVisitorRoom), visitors
 *     get `available: false`, reason "live_room": the people in a room agreed
 *     to the room's notice, not to an AI reading their words. The owner, as
 *     host, may still run tasks; components show a preview before anything
 *     reaches the room.
 *
 * A visitor's answers carry the quota headers: they update the chat panel's
 * count (useAgentStore().visitorQuota) and `remaining`.
 *
 * AI never writes on its own: the result is handed back for the person to
 * accept (<AiSuggestions>), and accepted items go through the tool's store.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseVisitorQuota } from "@/lib/agent/rate-limit";
import { useAgentStore } from "@/lib/agent/store";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { inLiveVisitorRoom, subscribeLiveVisitorRoom } from "@/lib/realtime/live-visitor-room";
import { hasVisitorAiConsent, storeVisitorAiConsent } from "@/lib/visitor-ai/consent";
import { visitorAiEnabled } from "@/lib/visitor-ai/contract";
import {
  TOOL_AI_OWNER_PATH,
  TOOL_AI_VISITOR_PATH,
  toolAiErrorText,
  type ToolAiErrorCode,
} from "./contract";
import type { AiFallbackReason, AiSource, AiTaskDef } from "./task-types";

export type ToolAiStatus = "idle" | "running" | "done" | "error" | "needs_consent";

/**
 * Why AI can't run here: auth is still settling ("loading"), visitor AI is
 * off in this build ("off": hide the button), the task is the owner's only
 * ("owner_only": hide the button too, so a visitor is never asked to agree
 * to something they can't use), or a live room is open ("live_room": say
 * why).
 */
export type ToolAiUnavailableReason = "loading" | "off" | "owner_only" | "live_room";

export const TOOL_AI_UNAVAILABLE_TEXT: Record<ToolAiUnavailableReason, string> = {
  loading: "Amr's AI is getting ready.",
  off: "Amr's AI isn't switched on here. The tool works fully without it.",
  owner_only: "This AI help is only for the site's owner. The tool works fully without it.",
  live_room:
    "Amr's AI is off while a live room is open, so nothing from the room goes to an AI. The tool still works without it.",
};

export interface ToolAiError {
  code: ToolAiErrorCode | string;
  /** Plain words for the person. */
  message: string;
}

export type ToolAiRunResult<O> =
  | { status: "done"; data: O; source: AiSource; reason?: AiFallbackReason }
  | { status: "needs_consent" }
  | { status: "unavailable"; reason: ToolAiUnavailableReason }
  | {
      status: "error";
      error: ToolAiError;
      /** The task's answer without AI, ready to offer instead (null if the input itself was bad). */
      fallback: O | null;
    }
  | { status: "cancelled" };

export interface UseToolAi<I, O> {
  /** Whether `run` can reach an AI right now. */
  available: boolean;
  reason: ToolAiUnavailableReason | null;
  /** `reason` in plain words, or null. */
  reasonText: string | null;
  /** Which route a run goes to. */
  path: "owner" | "visitor" | null;
  status: ToolAiStatus;
  /** The last answer (AI or fallback), until the next run or reset. */
  data: O | null;
  source: AiSource | null;
  fallbackReason: AiFallbackReason | null;
  error: ToolAiError | null;
  /** A visitor's AI uses left today (from the quota headers), or null. */
  remaining: number | null;
  run(input: I): Promise<ToolAiRunResult<O>>;
  /** Store the visitor's agreement and run the input that was waiting for it. */
  agree(): Promise<ToolAiRunResult<O> | null>;
  /** Drop the waiting input without agreeing. */
  decline(): void;
  /** Stop a running request (nothing is shown). */
  cancel(): void;
  /** Back to idle, clearing the answer and the error. */
  reset(): void;
  /** The task's answer without AI. */
  fallback(input: I): O;
}

/** Where the request goes and why it may not, from who is here and what is open. */
function decide(
  isOwner: boolean,
  visitor: boolean,
  inLiveRoom: boolean,
  ownerOnly: boolean
): { path: "owner" | "visitor" | null; reason: ToolAiUnavailableReason | null } {
  if (isOwner) return { path: "owner", reason: null };
  if (!visitor) return { path: null, reason: "loading" };
  // The visitor route refuses it every time: never ask for consent to it.
  if (ownerOnly) return { path: null, reason: "owner_only" };
  if (!visitorAiEnabled()) return { path: null, reason: "off" };
  if (inLiveRoom) return { path: null, reason: "live_room" };
  return { path: "visitor", reason: null };
}

export function useToolAi<I, O>(task: AiTaskDef<I, O>): UseToolAi<I, O> {
  const { isOwner, visitor } = useOwnerState();
  const inLiveRoom = useSyncExternalStore(subscribeLiveVisitorRoom, inLiveVisitorRoom, () => false);
  const { path, reason } = decide(isOwner, visitor, inLiveRoom, task.ownerOnly === true);

  const [status, setStatus] = useState<ToolAiStatus>("idle");
  const [data, setData] = useState<O | null>(null);
  const [source, setSource] = useState<AiSource | null>(null);
  const [fallbackReason, setFallbackReason] = useState<AiFallbackReason | null>(null);
  const [error, setError] = useState<ToolAiError | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<{ input: I } | null>(null);
  const taskRef = useRef(task);
  taskRef.current = task;
  const pathRef = useRef(path);
  pathRef.current = path;
  const reasonRef = useRef(reason);
  reasonRef.current = reason;

  useEffect(() => () => abortRef.current?.abort(), []);

  const fallback = useCallback((input: I): O => taskRef.current.fallback(input), []);

  const safeFallback = useCallback((input: unknown): O | null => {
    try {
      const parsed = taskRef.current.input.safeParse(input);
      return parsed.success ? taskRef.current.fallback(parsed.data) : null;
    } catch {
      return null;
    }
  }, []);

  const fail = useCallback(
    (code: string, input: unknown): ToolAiRunResult<O> => {
      const err = { code, message: toolAiErrorText(code) };
      setError(err);
      setStatus("error");
      return { status: "error", error: err, fallback: safeFallback(input) };
    },
    [safeFallback]
  );

  const send = useCallback(
    async (input: I, to: "owner" | "visitor"): Promise<ToolAiRunResult<O>> => {
      const current = taskRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("running");
      setError(null);
      setData(null);
      setSource(null);
      setFallbackReason(null);
      const owns = () => abortRef.current === controller;

      let res: Response;
      try {
        res = await fetch(to === "owner" ? TOOL_AI_OWNER_PATH : TOOL_AI_VISITOR_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ task: current.id, input }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          if (owns()) {
            abortRef.current = null;
            setStatus("idle");
          }
          return { status: "cancelled" };
        }
        if (owns()) abortRef.current = null;
        return fail("network", input);
      }

      if (to === "visitor") {
        const quota = parseVisitorQuota(res.headers);
        if (quota) {
          useAgentStore.getState().setVisitorQuota(quota);
          setRemaining(quota.remaining);
        }
      }

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (controller.signal.aborted) {
        if (owns()) {
          abortRef.current = null;
          setStatus("idle");
        }
        return { status: "cancelled" };
      }
      if (owns()) abortRef.current = null;

      if (!res.ok) {
        const code =
          body &&
          typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : res.status === 401
              ? "unauthenticated"
              : "upstream_error";
        return fail(code, input);
      }

      const answer = body as { ok?: unknown; data?: unknown; source?: unknown; reason?: unknown };
      const checked = answer && answer.ok === true ? current.output.safeParse(answer.data) : null;
      if (!checked?.success) return fail("bad_answer", input);
      const src: AiSource = answer.source === "fallback" ? "fallback" : "ai";
      const why =
        src === "fallback" &&
        (answer.reason === "length" ||
          answer.reason === "bad_answer" ||
          answer.reason === "timeout")
          ? answer.reason
          : undefined;
      setData(checked.data);
      setSource(src);
      setFallbackReason(why ?? null);
      setStatus("done");
      return { status: "done", data: checked.data, source: src, ...(why ? { reason: why } : {}) };
    },
    [fail]
  );

  const run = useCallback(
    async (input: I): Promise<ToolAiRunResult<O>> => {
      const to = pathRef.current;
      if (!to) return { status: "unavailable", reason: reasonRef.current ?? "off" };
      // Checked here first, so a bad input never leaves the browser or costs a use.
      const parsed = taskRef.current.input.safeParse(input);
      if (!parsed.success) return fail("bad_input", input);
      if (to === "visitor" && !hasVisitorAiConsent()) {
        pendingRef.current = { input: parsed.data };
        setError(null);
        setStatus("needs_consent");
        return { status: "needs_consent" };
      }
      return send(parsed.data, to);
    },
    [fail, send]
  );

  const agree = useCallback(async (): Promise<ToolAiRunResult<O> | null> => {
    storeVisitorAiConsent();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) {
      setStatus("idle");
      return null;
    }
    const to = pathRef.current;
    if (to !== "visitor") {
      setStatus("idle");
      return to ? send(pending.input, to) : null;
    }
    return send(pending.input, to);
  }, [send]);

  const decline = useCallback(() => {
    pendingRef.current = null;
    setStatus("idle");
  }, []);

  const cancel = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    pendingRef.current = null;
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRef.current = null;
    setStatus("idle");
    setData(null);
    setSource(null);
    setFallbackReason(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({
      available: path !== null,
      reason,
      reasonText: reason ? TOOL_AI_UNAVAILABLE_TEXT[reason] : null,
      path,
      status,
      data,
      source,
      fallbackReason,
      error,
      remaining,
      run,
      agree,
      decline,
      cancel,
      reset,
      fallback,
    }),
    [
      path,
      reason,
      status,
      data,
      source,
      fallbackReason,
      error,
      remaining,
      run,
      agree,
      decline,
      cancel,
      reset,
      fallback,
    ]
  );
}
