"use client";

/**
 * One chat message: the visitor's or owner's own words verbatim, Amr's reply
 * as safe markdown, and his tool calls as plain step rows. Shared by the
 * owner's chat (agent-conversation) and the visitor's
 * (mascot/visitor-agent-panel).
 *
 * A step row reads "Retro Board · Add card · Done · “flaky CI”": the tool and
 * verb from lib/agent/tool-label, the state in words from
 * lib/agent/tool-result-text, never the wire name, the arguments or the
 * result string. A result shows on its call's row; a result whose call isn't
 * in the chat (an old or odd thread) gets a short row of its own. Only the
 * owner gets "Details", with the raw arguments and result; visitors never see
 * JSON. This is the interim row: the comic step caption replaces it.
 */

import { memo, useId, useMemo, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Markdown } from "./markdown";
import { useAgentStore } from "@/lib/agent/store";
import { toolLabel, type ToolLabel } from "@/lib/agent/tool-label";
import {
  STEP_WORDS,
  TROUBLE_STATES,
  pairToolResults,
  resultText,
  stepState,
  stepSummary,
  type ToolResultPairs,
  type ToolStepState,
} from "@/lib/agent/tool-result-text";
import type { ChatMessage, ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";

/** The most of the raw arguments or result the owner's Details shows, in characters. */
const DETAILS_MAX = 4000;

/** The label for a result whose call isn't in the chat. */
const UNPAIRED: ToolLabel = { tool: "Step", verb: "" };

/** What each step row needs to know beyond its own message. */
export interface ToolSteps {
  pairs: ToolResultPairs;
  /** The call whose confirm card is showing. */
  pendingId: string | null;
  /** A turn is under way, so the latest reply's calls may still be running. */
  busy: boolean;
}

/** Pair the chat's calls with their results, once per change to the messages. */
export function useToolSteps(messages: ChatMessage[], busy: boolean): ToolSteps {
  const pendingId = useAgentStore((s) => s.pendingToolUse?.toolUseId ?? null);
  const pairs = useMemo(() => pairToolResults(messages), [messages]);
  return useMemo(() => ({ pairs, pendingId, busy }), [pairs, pendingId, busy]);
}

/** A row's separator, as the chat's other plain lines write it ("Chat · not saved"). */
const SEP = " · ";

/** Text for Details, cut to DETAILS_MAX. */
function capped(text: string): string {
  return text.length > DETAILS_MAX ? `${text.slice(0, DETAILS_MAX)}…` : text;
}

/** The raw arguments as JSON for Details, or a word when they can't be written out. */
function inputText(input: ToolUseBlock["input"] | undefined): string {
  try {
    return JSON.stringify(input ?? {}, null, 2) ?? "{}";
  } catch {
    return "(not readable)";
  }
}

/**
 * The owner's disclosure with the raw arguments and result, in the data face.
 * Each block scrolls past 160 px, so it is a named region a keyboard can
 * reach and scroll (the global focus ring shows it), as the markdown's code
 * blocks are. Memoised on the call's input and its result block (the store
 * keeps both until they change), so a streamed flush or a keystroke in the
 * composer doesn't write the raw JSON out again.
 */
const StepDetails = memo(function StepDetails({
  input,
  result,
}: {
  input?: ToolUseBlock["input"];
  result?: ToolResultBlock;
}) {
  const inputId = useId();
  const resultId = useId();
  const block =
    "max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-md border border-rule bg-surface-deep p-2 font-data text-xs text-text";
  return (
    <details className="group/details mt-1">
      <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-xs text-sub hover:text-text pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        Details
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 group-open/details:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-1">
        {input !== undefined && (
          <>
            <p id={inputId} className="text-xs text-sub">
              Input
            </p>
            <pre role="region" aria-labelledby={inputId} tabIndex={0} dir="ltr" className={block}>
              {capped(inputText(input))}
            </pre>
          </>
        )}
        {result && (
          <>
            <p id={resultId} className="text-xs text-sub">
              Result
            </p>
            <pre role="region" aria-labelledby={resultId} tabIndex={0} dir="ltr" className={block}>
              {capped(resultText(result))}
            </pre>
          </>
        )}
      </div>
    </details>
  );
});

/** One step: the tool and verb, where it stands, and what it touched, in words. */
function StepRow({
  label,
  state,
  summary,
  details,
}: {
  label: ToolLabel;
  state: ToolStepState | null;
  summary: string | null;
  details?: ReactNode;
}) {
  return (
    <div className="text-xs text-sub" data-tool-step={state ?? "unknown"}>
      <p className="break-words">
        <span className="font-medium text-text">{label.tool}</span>
        {label.verb && (
          <>
            {SEP}
            {label.verb}
          </>
        )}
        {state && (
          <>
            {SEP}
            <span className={TROUBLE_STATES.has(state) ? "text-danger" : undefined}>
              {STEP_WORDS[state]}
            </span>
          </>
        )}
        {summary && (
          <>
            {SEP}
            <bdi>“{summary}”</bdi>
          </>
        )}
      </p>
      {details}
    </div>
  );
}

export function MessageBubble({
  message,
  steps,
  details = false,
}: {
  message: ChatMessage;
  /** The chat's calls paired with their results (useToolSteps); without it rows show no state. */
  steps?: ToolSteps;
  /** The owner's chat: each step gets a "Details" disclosure with the raw arguments and result. */
  details?: boolean;
}) {
  if (message.role === "tool") {
    // A result shows on its call's row; only one whose call isn't in the chat shows here.
    const rows = message.content.flatMap((c, i) =>
      c.type === "tool_result" && !steps?.pairs.answersACall(message.id, i)
        ? [
            <StepRow
              key={i}
              label={UNPAIRED}
              state={stepState({ id: c.tool_use_id, input: {} }, c, {})}
              summary={null}
              details={details ? <StepDetails result={c} /> : null}
            />,
          ]
        : []
    );
    if (rows.length === 0) return null;
    return <div className="space-y-1 rounded-md border border-border bg-card/50 p-2">{rows}</div>;
  }

  const isUser = message.role === "user";
  const live = !!steps?.busy && steps.pairs.latestAssistantId === message.id;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-accent/20 text-text" : "bg-card border border-border text-text"
        }`}
      >
        {message.content.map((c, i) => {
          if (c.type === "text") {
            // Agent replies are markdown; user messages are shown verbatim.
            return isUser ? (
              <p key={i} className="whitespace-pre-wrap break-words">
                {c.text}
              </p>
            ) : (
              <Markdown key={i} source={c.text} />
            );
          }
          if (c.type === "tool_use") {
            const result = steps?.pairs.resultOf(message.id, c.id);
            const state = stepState(c, result, { pendingId: steps?.pendingId, live });
            return (
              <div key={i} className="mt-2 first:mt-0">
                <StepRow
                  label={toolLabel(c.name)}
                  state={state}
                  summary={state === "preparing" ? null : stepSummary(c, result)}
                  details={
                    details && state !== "preparing" ? (
                      <StepDetails input={c.input} result={result} />
                    ) : null
                  }
                />
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
