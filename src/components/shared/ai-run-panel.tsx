"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Copy, Check, RotateCcw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { getAdapter, PROVIDER_META } from "@/lib/llm/registry";
import { estimateCostUsd, estimateInputTokens, findModel, formatCostUsd } from "@/lib/llm/pricing";
import type { ProviderId } from "@/lib/llm/types";
import { isLlmError } from "@/lib/llm/types";
import { withRetry } from "@/lib/llm/retry";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { TOOL_AI_OWNER_PATH, toolAiErrorText } from "@/lib/ai/contract";
import { PROMPT_RUN_MAX_CHARS, PROMPT_RUN_TASK, parsePromptRunEvent } from "@/lib/ai/prompt-run";
import { pumpSseStream } from "@/lib/llm/stream-sse";

/**
 * Optional provider override. When set, AiRunPanel runs against this
 * specific provider/key instead of the active one from `useActiveLlm`.
 * Used by the model-comparison A/B grid which stacks one panel per
 * configured provider.
 */
export interface ProviderOverride {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

interface AiRunPanelProps {
  prompt: string;
  /** Optional short context hint passed as the `system` message. */
  toolName?: string;
  /** When set, use this provider instead of the active one from settings. */
  providerOverride?: ProviderOverride;
  /**
   * Monotonically increasing counter from the parent. Each new value
   * (re)triggers a `run()`. Lets a parent A/B coordinator fire many
   * stacked panels in lockstep ("Run all") without dragging the state
   * up into the parent.
   */
  runTrigger?: number;
  /** Compact mode for the A/B grid — drops the header bar, smaller padding. */
  compact?: boolean;
  /**
   * Fires once when a run completes successfully (NOT on abort, NOT on
   * error). Receives the full streamed text plus the provider's exact
   * usage payload. Used by tools that want to auto-fill a downstream
   * form field — e.g. hallucination-log's "Actual response" textarea.
   *
   * The callback should be wrapped in `useCallback` by the parent if
   * its identity matters; we deliberately do NOT add it to the `run`
   * useCallback's dep list (a fresh closure each render would tear down
   * the streaming run mid-flight).
   */
  onResult?: (result: {
    text: string;
    usage: { inputTokens: number; outputTokens: number };
  }) => void;
}

/**
 * In-drawer LLM run panel. Streams the response inline, supports abort,
 * surfaces cost + token estimates upfront so the user knows what they're
 * spending.
 *
 * Two call shapes:
 *   - **Default** (no `providerOverride`) — reads from `useActiveLlm()`,
 *     used by the AI Prompts drawer in every tool. For the signed-in owner
 *     with no personal key ready, it runs on the owner's own gateway instead:
 *     POST /api/ai/tool with the special task "prompt.run", streamed back as
 *     plain text (lib/ai/prompt-run.ts). Visitors keep their own key.
 *   - **Override** (with `providerOverride`) — runs against the explicit
 *     provider/key/model. Used by the model-comparison A/B grid to fire
 *     the same prompt across multiple configured providers in parallel.
 *
 * Lazy-loaded by ai-prompt-drawer-content.tsx so this whole module — plus
 * the dynamic-imported adapter underneath — never lands in the eager bundle.
 */
export default function AiRunPanel({
  prompt,
  toolName,
  providerOverride,
  runTrigger,
  compact = false,
  onResult,
}: AiRunPanelProps) {
  const active = useActiveLlm();
  const { isOwner } = useOwnerState();
  const maxOutputTokens = useLlmStore((s) => s.maxOutputTokens);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  /** Set when a server run's answer stopped before its end. */
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest-onResult ref. The callback isn't in `run`'s dep list because we
  // don't want a fresh closure to tear down the streaming run — but the
  // ref lets `run` always invoke the *current* callback at completion.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // The owner with no personal key ready runs on the owner's gateway.
  const serverRun = !providerOverride && !active.isReady && isOwner;
  // Resolved provider — explicit override wins over active.
  const providerId: ProviderId | null = providerOverride?.provider ?? active.provider;
  const modelId: string | null = providerOverride?.model ?? active.model;
  const providerName: string | null = serverRun
    ? "Amr's AI"
    : providerOverride
      ? PROVIDER_META[providerOverride.provider].name
      : active.providerName;
  const canRun = providerOverride ? true : active.isReady || serverRun;

  // Cancel any in-flight stream + clear timers if the panel unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Upfront estimates — derived live so the cost preview updates if the
  // user switches model in settings without closing the drawer.
  const inputTokens = estimateInputTokens(prompt);
  const modelInfo = providerId && modelId ? findModel(providerId, modelId) : undefined;
  const estIn = providerId && modelId ? estimateCostUsd(providerId, modelId, inputTokens, 0) : 0;
  const estMaxOut =
    providerId && modelId ? estimateCostUsd(providerId, modelId, 0, maxOutputTokens) : 0;

  /** The owner's run on the gateway: the same panel states, the text streamed from the route. */
  const runOnServer = useCallback(async () => {
    abortRef.current?.abort();
    setRunning(true);
    setError(null);
    setText("");
    setUsage(null);
    setTtftMs(null);
    setTotalMs(null);
    setStoppedEarly(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    let firstChunkAt: number | null = null;
    let accumulated = "";
    try {
      if (prompt.length > PROMPT_RUN_MAX_CHARS) {
        throw new Error(
          `This prompt is longer than Amr's AI takes (${PROMPT_RUN_MAX_CHARS.toLocaleString()} characters). Copy it into your own AI assistant instead.`
        );
      }
      const res = await fetch(TOOL_AI_OWNER_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: PROMPT_RUN_TASK,
          input: {
            prompt,
            ...(toolName?.trim() ? { toolName: toolName.trim().slice(0, 120) } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let code = res.status === 401 ? "unauthenticated" : "upstream_error";
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") code = body.error;
        } catch {
          /* no JSON body */
        }
        throw new Error(toolAiErrorText(code));
      }
      let ending: string | null = null;
      await pumpSseStream(res, controller.signal, ({ data }) => {
        const event = parsePromptRunEvent(data);
        if (!event) return;
        if ("error" in event) {
          ending = event.error;
          return;
        }
        if (firstChunkAt === null) {
          firstChunkAt = performance.now();
          setTtftMs(Math.round(firstChunkAt - startedAt));
        }
        accumulated += event.text;
        setText((prev) => prev + event.text);
      });
      setTotalMs(Math.round(performance.now() - startedAt));
      if (ending && !accumulated) throw new Error(toolAiErrorText("upstream_error"));
      if (ending) setStoppedEarly(true);
      try {
        onResultRef.current?.({ text: accumulated, usage: { inputTokens: -1, outputTokens: -1 } });
      } catch {
        /* swallow — the run itself succeeded */
      }
    } catch (err) {
      if ((isLlmError(err) && err.code === "abort") || controller.signal.aborted) {
        // Stopped by the owner, or replaced by a fresh run.
      } else {
        const message = describeError(err);
        setError(message);
        toast.error(`AI run failed: ${message}`);
      }
    } finally {
      if (abortRef.current === controller) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [prompt, toolName]);

  const run = useCallback(async () => {
    if (serverRun) {
      await runOnServer();
      return;
    }
    if (!providerId || !modelId) {
      toast.error("No AI provider configured");
      return;
    }
    // Abort any in-flight run before starting a fresh one. Without
    // this, double-clicking Run (or a runTrigger bumped twice while
    // streaming) spawned two concurrent streams: both billed against
    // the user's key, both fired `onResult` (parents see duplicates),
    // both `setText`s interleaved into garbled output, and only the
    // newest could be stopped. Aborting first cancels the prior
    // adapter/SSE pump cleanly.
    abortRef.current?.abort();
    setRunning(true);
    setError(null);
    setText("");
    setUsage(null);
    setTtftMs(null);
    setTotalMs(null);
    setStoppedEarly(false);

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    let firstChunkAt: number | null = null;
    // Accumulate locally so we can hand the complete streamed text to
    // onResult at the end — reading from the `text` state in the success
    // branch would race with React's batched setText flush.
    let accumulated = "";

    try {
      const adapter = await getAdapter(providerId);
      // Override path uses the supplied key + model; default path pulls
      // the live config out of the store so a mid-stream settings change
      // (rare but possible) gets picked up on the next Run.
      const cfg = providerOverride
        ? { apiKey: providerOverride.apiKey, model: providerOverride.model }
        : useLlmStore.getState().providers[providerId];
      if (!cfg) {
        throw new Error("Provider config disappeared");
      }
      // Sanitize `toolName` before interpolating it into the system
      // prompt. Several callers (ai-red-team, agentic-workflow,
      // prompt-registry) pass user-controlled content as `toolName`
      // — e.g. ai-red-team's attack-vector field flows directly here.
      // Without sanitization, a vector like `Ignore prior instructions."}.
      // New system: ...` closed the role string and injected fresh
      // instructions into the system prompt, billed against the user's
      // BYOK key. Stripping quotes, newlines, and CR collapses the
      // interpolation to a single safe label.
      const safeToolName = toolName
        ? toolName
            .replace(/["\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200)
        : undefined;
      // Wrap the adapter call in withRetry so transient 429s (provider
      // bucket exhaustion) auto-recover without surfacing as a hard
      // failure to the user. Caps at 2 retries — keeps the UI responsive
      // to Stop, and respects the server's Retry-After when provided.
      // We re-create the params on each attempt because `accumulated`
      // would otherwise leak text from the failed first attempt into
      // the streamed output of the retry.
      const result = await withRetry(
        () => {
          // Reset streaming-state on each attempt — if attempt 1 streamed
          // a partial chunk before 429ing, we don't want it to remain.
          accumulated = "";
          firstChunkAt = null;
          setText("");
          setTtftMs(null);
          return adapter.call(
            {
              prompt,
              system: safeToolName
                ? `You are an expert Agile coach reviewing data from the "${safeToolName}" tool. Be specific and cite values.`
                : undefined,
              signal: controller.signal,
              onChunk: (chunk) => {
                if (firstChunkAt === null) {
                  firstChunkAt = performance.now();
                  setTtftMs(Math.round(firstChunkAt - startedAt));
                }
                accumulated += chunk;
                // Functional update so concurrent chunks don't clobber each
                // other if React batches them across render boundaries.
                setText((prev) => prev + chunk);
              },
            },
            cfg,
            maxOutputTokens
          );
        },
        { signal: controller.signal }
      );
      setUsage(result);
      setTotalMs(Math.round(performance.now() - startedAt));
      // Fire the onResult hook on successful completion only. Wrapped in a
      // try so a buggy parent callback can't break the panel's state.
      try {
        onResultRef.current?.({ text: accumulated, usage: result });
      } catch {
        /* swallow — the run itself succeeded */
      }
      // Auto-log spend into token-cost-tracker. Every BYOK run anywhere in
      // the app produces a TokenSpend row, so the cost dashboard reflects
      // real usage without the user having to log anything manually.
      //
      // Done OUTSIDE the React render loop via `getState().upsertTokenSpend`
      // so we don't subscribe AiRunPanel to the workspace store (which
      // would cause a re-render on every TokenSpend write — a feedback
      // loop). Wrapped in try/catch so a workspace-store write failure
      // (quota / SecurityError) doesn't bubble into the run path.
      try {
        // Some adapters return -1 for tokens when the final SSE event
        // lacks a usage payload (Gemini and OpenAI in certain stream
        // shapes). Persisting -1 would yield a NEGATIVE cost row and
        // silently understate the 30-day rollup in token-cost-tracker.
        // Clamp to 0 so the spend row reads honestly: "unknown tokens,
        // $0 estimated" rather than "phantom credit applied".
        const inputTokens = Math.max(0, result.inputTokens);
        const outputTokens = Math.max(0, result.outputTokens);
        const actualCost = Math.max(
          0,
          estimateCostUsd(providerId, modelId, inputTokens, outputTokens)
        );
        const feature = toolName?.trim() ? `BYOK: ${toolName.trim()}` : "BYOK: AI Run";
        useWorkspaceStore.getState().upsertTokenSpend({
          id: crypto.randomUUID(),
          feature,
          // Use the actual provider model id (gpt-5-mini, claude-haiku-4-7,
          // etc.) so future analytics line up against MODELS_BY_PROVIDER.
          model: modelId,
          date: todayLocalISO(),
          inputTokens,
          outputTokens,
          costUsd: actualCost,
        });
      } catch {
        /* spend recording is best-effort */
      }
    } catch (err) {
      // AbortError is expected when the user hits Stop — don't surface it
      // as a red error toast. Also check the signal directly: an aborted
      // run can reject with a provider/DOM error that isn't tagged as an
      // LlmError "abort", and a SUPERSEDED run (aborted because a fresh
      // run() replaced it) must never paint an error over the live run.
      if ((isLlmError(err) && err.code === "abort") || controller.signal.aborted) {
        // already torn down via the abort signal
      } else {
        const message = describeError(err);
        setError(message);
        toast.error(`AI run failed: ${message}`);
      }
    } finally {
      // Owner-checked cleanup. When run() aborts a prior run and installs a
      // fresh controller (line ~145), the OLD run's finally fires a microtask
      // later — after abortRef already points at the NEW controller. Blindly
      // clearing here flipped `running` to false mid-stream (Stop button
      // vanished, "Run again" appeared while tokens were still billing) and
      // nulled the ref so Stop couldn't cancel the live run. Only the run
      // that still owns the ref may tear the shared state down.
      if (abortRef.current === controller) {
        setRunning(false);
        abortRef.current = null;
      }
    }
  }, [
    serverRun,
    runOnServer,
    providerId,
    modelId,
    providerOverride,
    prompt,
    toolName,
    maxOutputTokens,
  ]);

  // Parent-triggered runs. Skip the very first render (runTrigger=0 or
  // undefined) so the panel doesn't auto-fire on mount. Subsequent
  // increments fire `run()`.
  const lastTrigger = useRef<number | undefined>(runTrigger);
  useEffect(() => {
    if (runTrigger === undefined) return;
    if (lastTrigger.current === undefined) {
      lastTrigger.current = runTrigger;
      return;
    }
    if (runTrigger !== lastTrigger.current) {
      lastTrigger.current = runTrigger;
      void run();
    }
  }, [runTrigger, run]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Copy failed");
    }
  }, [text]);

  return (
    <div
      className={cn(
        "rounded-md border space-y-2",
        compact ? "p-2 border-border bg-surface" : "mt-3 p-3 border-accent/30 bg-accent/5"
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-accent font-mono uppercase tracking-wider">
          <span>{providerName ?? "AI"}</span>
          {modelInfo && (
            <span className="text-sub normal-case font-normal">· {modelInfo.label}</span>
          )}
          {!modelInfo && modelId && (
            <span className="text-sub normal-case font-normal">· {modelId}</span>
          )}
        </div>
        <div className="text-sub font-mono">
          {serverRun ? (
            <>~{inputTokens.toLocaleString()} in · your gateway</>
          ) : (
            <>
              ~{inputTokens.toLocaleString()} in · {formatCostUsd(estIn)} +{" "}
              {formatCostUsd(estMaxOut)} max out
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!running && !text && (
          <Button
            size="sm"
            onClick={run}
            disabled={!canRun}
            className="gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            Run
          </Button>
        )}
        {running && (
          <Button
            size="sm"
            variant="outline"
            onClick={stop}
            className="gap-1.5 border-danger/40 text-danger hover:text-danger hover:border-danger"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </Button>
        )}
        {!running && text && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="gap-1.5 border-border"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy result"}
            </Button>
            <Button size="sm" variant="outline" onClick={run} className="gap-1.5 border-border">
              <RotateCcw className="w-3.5 h-3.5" />
              Run again
            </Button>
          </>
        )}
        {running && (
          <span className="text-xs text-sub inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Streaming…
            {ttftMs !== null && <span className="font-mono">· first token {ttftMs}ms</span>}
          </span>
        )}
        {/* Always mounted so the run's start and end are announced; the
            streamed text itself isn't live (it would be read token by token).
            Errors are announced by the error toast. */}
        <span role="status" className="sr-only">
          {running ? "Generating response" : text && !error ? "Response ready" : ""}
        </span>
      </div>

      {(text || error) && (
        <div
          className={cn(
            "rounded-md border p-3 overflow-y-auto font-mono text-xs whitespace-pre-wrap leading-relaxed",
            compact ? "max-h-48" : "max-h-72",
            error
              ? "border-danger/40 bg-danger/5 text-danger"
              : "border-border bg-surface text-text/90"
          )}
        >
          {error ? (
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            text
          )}
        </div>
      )}

      {stoppedEarly && !running && (
        <p className="text-xs text-sub">The answer stopped early. Run it again for the rest.</p>
      )}

      {usage && usage.inputTokens >= 0 && usage.outputTokens >= 0 && providerId && modelId && (
        <div className="text-xs text-sub font-mono text-right">
          Used {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out ·{" "}
          {formatCostUsd(
            estimateCostUsd(providerId, modelId, usage.inputTokens, usage.outputTokens)
          )}
          {ttftMs !== null && totalMs !== null && (
            <>
              {" "}
              · TTFT {ttftMs}ms · total {totalMs}ms
            </>
          )}
        </div>
      )}
    </div>
  );
}

function describeError(err: unknown): string {
  if (isLlmError(err)) {
    switch (err.code) {
      case "auth":
        return "API key rejected — re-check it in AI settings";
      case "rate_limit":
        return err.retryAfterSeconds
          ? `Rate limited — try again in ${err.retryAfterSeconds}s`
          : "Rate limited — try again later";
      case "cors":
        return "Browser blocked the request — provider may have changed its CORS policy";
      case "network":
        return err.status ? `Provider returned HTTP ${err.status}` : "Network error";
      case "abort":
        return "Aborted";
    }
  }
  if (err instanceof Error) return err.message.slice(0, 200);
  return "Unknown error";
}
