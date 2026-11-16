"use client";

/**
 * The owner's "Details" on a tool step: a closed disclosure under the step's
 * line with the raw arguments the call was made with and the raw result it
 * came back with, in the data face (owner only), each cut to DETAILS_MAX. The
 * owner is the one who debugs a call, so this shows what was really sent and
 * returned; the step's line above it says the same in words.
 *
 * Owner-only. The owner's container (agent-conversation) hands it to the
 * strip through the chat context (ChatProvider's stepDetails), so a visitor's
 * chat never loads it, and the context drops it in a visitor's chat whoever
 * renders it (test/agent/bundle-boundary.test.ts). A visitor never sees JSON.
 *
 * Each block scrolls past 160 px, so it is a named region a keyboard can
 * reach and scroll (the global focus ring shows it), as the markdown's code
 * blocks are. The disclosure and both regions carry the step's words for a
 * screen reader (hidden on screen), so several steps don't all read
 * "Details" or give the same "Input" and "Result" landmarks. The summary is
 * 44 px on a coarse pointer. Memoised on the step, which the chat view keeps
 * until it changes, so a streamed flush or a keystroke in the composer
 * doesn't write the raw JSON out again.
 */

import { memo, useId } from "react";
import { ChevronDown } from "lucide-react";
import { resultText } from "@/lib/agent/tool-result-text";
import type { ToolUseBlock } from "@/lib/agent/types";
import type { StepDetailsProps } from "./chat-context";

/** The most of the raw arguments or result the owner's Details shows, in characters. */
const DETAILS_MAX = 4000;

/** A raw block: scrolls past 160 px, in the data face, left to right. */
const BLOCK =
  "max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-md border border-rule bg-card p-2 font-data text-xs text-text";

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

/** One raw part of Details: its title, then the text as a named, scrollable region. */
function RawPart({ title, name, text }: { title: string; name: string; text: string }) {
  const id = useId();
  return (
    <>
      <p id={id} className="text-xs text-sub">
        {title} <span className="sr-only">for {name}</span>
      </p>
      <pre role="region" aria-labelledby={id} tabIndex={0} dir="ltr" className={BLOCK}>
        {capped(text)}
      </pre>
    </>
  );
}

/** The owner's Details for a step: its raw arguments and result (owner only). */
export const StepDetails = memo(function StepDetails({ step, name }: StepDetailsProps) {
  const { call, result } = step;
  return (
    <details className="group/details mt-1" data-step-details="">
      <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-xs text-sub hover:text-text pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        Details <span className="sr-only">for {name}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 group-open/details:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-1">
        {call && <RawPart title="Input" name={name} text={inputText(call.input)} />}
        {result && <RawPart title="Result" name={name} text={resultText(result)} />}
      </div>
    </details>
  );
});
