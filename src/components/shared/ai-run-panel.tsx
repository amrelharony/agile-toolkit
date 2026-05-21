"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Copy, Check, RotateCcw, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useActiveLlm } from "@/lib/llm/use-active-llm";
import { getAdapter } from "@/lib/llm/registry";
import {
  estimateCostUsd,
  estimateInputTokens,
  findModel,
  formatCostUsd,
} from "@/lib/llm/pricing";
import { isLlmError } from "@/lib/llm/types";
import { copyToClipboard } from "@/lib/utils/export";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";

interface AiRunPanelProps {
  prompt: string;
  /** Optional short context hint passed as the `system` message. */
  toolName?: string;
}

/**
 * In-drawer LLM run panel. Shown below a PromptCard when the user clicks
 * "Run with AI". Streams the response inline, supports abort, and surfaces
 * cost + token estimates upfront so the user knows what they're spending.
 *
 * Lazy-loaded by ai-prompt-drawer-content.tsx so this whole module — plus
 * the dynamic-imported adapter underneath — never lands in the eager bundle.
 */
export default function AiRunPanel({ prompt, toolName }: AiRunPanelProps) {
  const active = useActiveLlm();
  const maxOutputTokens = useLlmStore((s) => s.maxOutputTokens);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const model = active.provider && active.model ? findModel(active.provider, active.model) : undefined;
  const estIn = active.provider && active.model
    ? estimateCostUsd(active.provider, active.model, inputTokens, 0)
    : 0;
  const estMaxOut = active.provider && active.model
    ? estimateCostUsd(active.provider, active.model, 0, maxOutputTokens)
    : 0;

  const run = useCallback(async () => {
    if (!active.isReady || !active.provider || !active.model) {
      toast.error("No AI provider configured");
      return;
    }
    setRunning(true);
    setError(null);
    setText("");
    setUsage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const adapter = await getAdapter(active.provider);
      const cfg = useLlmStore.getState().providers[active.provider];
      if (!cfg) {
        throw new Error("Provider config disappeared");
      }
      const result = await adapter.call(
        {
          prompt,
          system: toolName
            ? `You are an expert Agile coach reviewing data from the "${toolName}" tool. Be specific and cite values.`
            : undefined,
          signal: controller.signal,
          onChunk: (chunk) => {
            // Functional update so concurrent chunks don't clobber each other
            // if React batches them across render boundaries.
            setText((prev) => prev + chunk);
          },
        },
        cfg,
        maxOutputTokens
      );
      setUsage(result);
    } catch (err) {
      // AbortError is expected when the user hits Stop — don't surface it
      // as a red error toast.
      if (isLlmError(err) && err.code === "abort") {
        // already torn down via the abort signal
      } else {
        const message = describeError(err);
        setError(message);
        toast.error(`AI run failed: ${message}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [active, prompt, toolName, maxOutputTokens]);

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
    <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 text-accent font-mono uppercase tracking-wider">
          <span>{active.providerName ?? "AI"}</span>
          {model && <span className="text-sub normal-case font-normal">· {model.label}</span>}
        </div>
        <div className="text-sub font-mono">
          ~{inputTokens.toLocaleString()} in · {formatCostUsd(estIn)} +{" "}
          {formatCostUsd(estMaxOut)} max out
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!running && !text && (
          <Button
            size="sm"
            onClick={run}
            className="gap-1.5 bg-accent text-bg hover:bg-accent/90 font-semibold"
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
            <Button
              size="sm"
              variant="outline"
              onClick={run}
              className="gap-1.5 border-border"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Run again
            </Button>
          </>
        )}
        {running && (
          <span className="text-[11px] text-sub inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Streaming…
          </span>
        )}
      </div>

      {(text || error) && (
        <div
          className={cn(
            "rounded-md border p-3 max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap leading-relaxed",
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

      {usage && usage.inputTokens >= 0 && usage.outputTokens >= 0 && active.provider && active.model && (
        <div className="text-[10px] text-sub font-mono text-right">
          Used {usage.inputTokens.toLocaleString()} in /{" "}
          {usage.outputTokens.toLocaleString()} out ·{" "}
          {formatCostUsd(
            estimateCostUsd(active.provider, active.model, usage.inputTokens, usage.outputTokens)
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
