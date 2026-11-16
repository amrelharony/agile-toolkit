"use client";

/**
 * The owner's "Details" on a tool step: a closed disclosure under the step's
 * line with what the call was made with and what it came back with, in words
 * (lib/agent/tool-details): `Text: “flaky CI”`, `Added: yes`, or a sentence
 * when it didn't run. Never JSON, a key as written in code or an id.
 *
 * Owner-only. The owner's container (agent-conversation) hands it to the
 * strip through the chat context (ChatProvider's stepDetails), so a visitor's
 * chat never loads it, and the context drops it in a visitor's chat whoever
 * renders it (test/agent/bundle-boundary.test.ts).
 *
 * The disclosure and each part carry the step's words for a screen reader
 * (hidden on screen), so several steps don't all read "Details", "Input" and
 * "Result". The summary is 44 px on a coarse pointer. Memoised on the step,
 * which the chat view keeps until it changes, so a streamed flush or a
 * keystroke in the composer doesn't work the words out again.
 */

import { memo, useId } from "react";
import { ChevronDown } from "lucide-react";
import { inputDetail, resultDetail, type Detail } from "@/lib/agent/tool-details";
import type { StepDetailsProps } from "./chat-context";

/** One part of Details: its title, then its fields, or a sentence in their place. */
function DetailPart({ title, name, detail }: { title: string; name: string; detail: Detail }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <p id={id} className="text-sub">
        {title} <span className="sr-only">for {name}</span>
      </p>
      {detail.note ? (
        <p dir="auto">{detail.note}</p>
      ) : (
        <dl>
          {detail.lines.map((line, n) => (
            <div key={n} className="break-words">
              <dt className="inline font-medium">{line.name}:</dt>{" "}
              <dd className="inline" dir="auto">
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {detail.more > 0 && <p className="text-sub">{detail.more} more</p>}
    </div>
  );
}

/** The owner's Details for a step: its arguments and result in words. */
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
      <div className="mt-1 space-y-1.5 text-xs text-text">
        {call && <DetailPart title="Input" name={name} detail={inputDetail(call.input)} />}
        {result && <DetailPart title="Result" name={name} detail={resultDetail(result)} />}
      </div>
    </details>
  );
});
