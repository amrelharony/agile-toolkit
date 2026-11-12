"use client";

/**
 * <AiButton>: "Ask Amr" for one tool AI task. It runs the task through
 * useToolAi and hands the answer to `onResult`; it never changes anything
 * itself. Show the answer with <AiSuggestions>, so the person accepts what
 * they want and the tool's own store (with Undo) does the writing.
 *
 * It takes care of:
 *   - who may ask (the owner, or a visitor with visitor AI on), and saying why
 *     not when AI can't run here (a tooltip, and a line under the button
 *     when it is pressed);
 *   - a visitor's first use: the compact consent card, then the run;
 *   - the running state, with Stop;
 *   - errors in plain words, with the task's answer without AI on offer.
 * With `fallbackLabel`, a page where AI is off still gets the button, which
 * then answers with the task's fallback straight away.
 */

import { useCallback, useId, useState } from "react";
import { Loader2, PenLine, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AiFallbackReason, AiSource, AiTaskDef } from "@/lib/ai/task-types";
import { useToolAi, type ToolAiRunResult } from "@/lib/ai/use-tool-ai";
import { AiConsentCompact } from "./ai-consent-compact";

export interface AiResultMeta {
  source: AiSource;
  reason?: AiFallbackReason;
}

export interface AiButtonProps<I, O> {
  /** The task, imported from its browser-safe module (`@/lib/ai/tasks/<toolId>`). */
  task: AiTaskDef<I, O>;
  /** The input, or a function that builds it when the button is pressed. */
  input: I | (() => I);
  /** The answer, from the AI or the task's fallback (`meta.source` says which). */
  onResult: (data: O, meta: AiResultMeta) => void;
  /** Default "Ask Amr". */
  label?: string;
  /**
   * When AI can't run here (off, or a live room is open), show the button with
   * this label and answer with the fallback instead of hiding it.
   */
  fallbackLabel?: string;
  /** The tool's own reason the button can't be used yet (nothing to ask about). */
  disabledReason?: string | null;
  size?: "sm" | "default";
  variant?: "toolkit" | "outline";
  className?: string;
}

const FILL_IN_FIRST = "Fill in the tool first, then try again.";

function readInput<I>(input: I | (() => I)): I {
  return typeof input === "function" ? (input as () => I)() : input;
}

export function AiButton<I, O>({
  task,
  input,
  onResult,
  label = "Ask Amr",
  fallbackLabel,
  disabledReason,
  size = "sm",
  variant = "toolkit",
  className,
}: AiButtonProps<I, O>) {
  const ai = useToolAi(task);
  const noteId = useId();
  const [note, setNote] = useState<string | null>(null);
  const [offer, setOffer] = useState(false);

  const finish = useCallback(
    (result: ToolAiRunResult<O> | null) => {
      if (!result) return;
      if (result.status === "done") {
        setNote(null);
        setOffer(false);
        onResult(result.data, {
          source: result.source,
          ...(result.reason ? { reason: result.reason } : {}),
        });
      } else if (result.status === "error") {
        setNote(result.error.message);
        setOffer(result.fallback !== null);
      }
    },
    [onResult]
  );

  const answerWithFallback = useCallback(() => {
    try {
      const parsed = task.input.safeParse(readInput(input));
      if (!parsed.success) {
        setNote(FILL_IN_FIRST);
        return;
      }
      const data = task.fallback(parsed.data);
      setNote(null);
      setOffer(false);
      onResult(data, { source: "fallback" });
    } catch {
      setNote(FILL_IN_FIRST);
    }
  }, [task, input, onResult]);

  const press = useCallback(async () => {
    setNote(null);
    setOffer(false);
    if (disabledReason) {
      setNote(disabledReason);
      return;
    }
    if (!ai.available) {
      if (fallbackLabel && ai.reason !== "loading") answerWithFallback();
      else if (ai.reasonText) setNote(ai.reasonText);
      return;
    }
    let value: I;
    try {
      value = readInput(input);
    } catch {
      setNote(FILL_IN_FIRST);
      return;
    }
    finish(await ai.run(value));
  }, [ai, input, disabledReason, fallbackLabel, answerWithFallback, finish]);

  // Visitor AI off in this build, or auth still settling: nothing to offer.
  if (ai.reason === "loading" || (ai.reason === "off" && !fallbackLabel)) return null;

  const running = ai.status === "running";
  const unavailable = !ai.available && !fallbackLabel;
  const blockedReason = disabledReason ?? (unavailable ? ai.reasonText : null);
  const text = !ai.available && fallbackLabel ? fallbackLabel : running ? "Asking Amr…" : label;

  const button = (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={press}
      disabled={running}
      aria-disabled={blockedReason ? true : undefined}
      aria-describedby={blockedReason || note ? noteId : undefined}
      className={cn("gap-1.5", blockedReason && "opacity-60", className)}
      data-testid="ai-button"
    >
      {running ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <PenLine aria-hidden="true" />
      )}
      {text}
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {blockedReason ? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{blockedReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          button
        )}
        {running && (
          <Button
            type="button"
            size={size}
            variant="outline"
            onClick={ai.cancel}
            className="gap-1.5"
          >
            <Square aria-hidden="true" />
            Stop
          </Button>
        )}
      </div>

      {ai.status === "needs_consent" && (
        <AiConsentCompact
          onAgree={() => {
            void ai.agree().then(finish);
          }}
          onDecline={ai.decline}
        />
      )}

      <p
        id={noteId}
        role="status"
        className={cn("text-xs text-sub", !(note || blockedReason) && "sr-only")}
      >
        {note ?? blockedReason ?? (running ? "Asking Amr's AI" : "")}
      </p>
      {offer && (
        <div>
          <Button type="button" size={size} variant="outline" onClick={answerWithFallback}>
            Suggest without AI
          </Button>
        </div>
      )}
    </div>
  );
}
