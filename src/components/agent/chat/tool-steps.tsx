"use client";

/**
 * A run of tool calls as the comic strip tells it (DNA-SPEC section 6, "Chat
 * strip"): one narration caption, a line per call, shared by both chats.
 *
 *   words    the tool's name and the verb (lib/agent/tool-label), where the
 *            call stands (tool-result-text STEP_WORDS: Getting ready…,
 *            Waiting for you, Working…, Done, You said no, Didn't work, Not
 *            available here, Stopped, Took too long) and what it touched
 *            ("flaky CI"): "Retro Board · Add card · Done · “flaky CI”".
 *            Never the wire name, the arguments or the result string; trouble
 *            is said in words, the danger colour only a second cue.
 *   slot     a 20 px box before the words, always there, so nothing moves as
 *            the call goes from one state to the next: a pen at work while it
 *            gets ready or runs, then an ink tick once a change has worked. A
 *            read, a call waiting for its OK, an error, a "no" and a call that
 *            never ran leave it empty.
 *   tick     an ink moment (DNA-SPEC section 9: a change Amr made in the
 *            chat). It inks only when the result came while the step was on
 *            screen, once per step and at most once a turn (the store's
 *            inkedToolIds, in memory only); it is drawn still on a remount,
 *            in a loaded thread, for a turn's later changes and on any later
 *            render. A read never gets one.
 *   Details  the owner's only (chat/step-details, handed in through the chat
 *            context): the arguments and the result in words.
 *
 * The marks are aria-hidden: the words say it all. Each line is memoised on
 * its step, which the chat view keeps until it changes, so a streamed flush
 * draws none of them again.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { memo, useRef, type ComponentType } from "react";
import { InkArt } from "@/components/ink/ink-art";
import { InkTick } from "@/components/ink/ink-tick";
import type { ChatStep } from "@/lib/agent/chat-view";
import { STEP_RUNNING } from "@/lib/ink/drawings/step-running";
import { useAgentStore } from "@/lib/agent/store";
import { readsOnly, toolLabel, type ToolLabel } from "@/lib/agent/tool-label";
import { STEP_WORDS, TROUBLE_STATES, stepSummary } from "@/lib/agent/tool-result-text";
import { Narration } from "../comic/comic-parts";
import { useChat, type StepDetailsProps } from "./chat-context";

/** The label for a result whose call isn't in the chat. */
const UNPAIRED: ToolLabel = { tool: "Step", verb: "" };

/** A step's separator, as the chat's other plain lines write it ("Chat · not saved"). */
const SEP = " · ";

/**
 * Which step this is, in words, for a screen reader: "Retro Board · Add card
 * “flaky CI”". A plain string, so the owner's Details keeps its memo.
 */
function stepName(label: ToolLabel, summary: string | null): string {
  const name = label.verb ? `${label.tool}${SEP}${label.verb}` : label.tool;
  return summary ? `${name} “${summary}”` : name;
}

/**
 * Take a step's one ink: false when the step has had it, or another step of
 * its turn has. The record is the agent store's inkedToolIds, which nothing
 * subscribes to, so taking it draws nothing again.
 */
function claimInk(step: ChatStep): boolean {
  const inked = useAgentStore.getState().inkedToolIds;
  const turn = `turn ${step.turn}`;
  if (inked.has(step.key) || inked.has(turn)) return false;
  inked.add(step.key).add(turn);
  return true;
}

/**
 * The step's tick: "ink" to ink it in now, "still" to draw it finished, or
 * null when it gets none (anything but a change that worked). Decided once,
 * the first time the tick shows, so a later render never inks it again.
 */
function useTick(step: ChatStep, label: ToolLabel): "ink" | "still" | null {
  // On screen before its result came: a result now came live.
  const watched = useRef(step.result === undefined);
  const inks = useRef<boolean | null>(null);
  if (step.state !== "done" || !step.call || readsOnly(label)) return null;
  inks.current ??= watched.current && claimInk(step);
  return inks.current ? "ink" : "still";
}

/** One call in words, after its state slot. */
const StepLine = memo(function StepLine({
  step,
  Details,
}: {
  step: ChatStep;
  /** The owner's chat: Details with the arguments and result in words. */
  Details: ComponentType<StepDetailsProps> | null;
}) {
  const { call, result, state } = step;
  const label = call ? toolLabel(call.name) : UNPAIRED;
  // Its arguments are left out while they still stream.
  const summary = call && state !== "preparing" ? stepSummary(call, result) : null;
  const tick = useTick(step, label);
  return (
    <div data-tool-step={state ?? "unknown"} className="flex items-start gap-1.5">
      <span
        aria-hidden="true"
        data-step-slot=""
        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center"
      >
        {tick ? (
          <InkTick still={tick === "still"} />
        ) : (
          (state === "preparing" || state === "working") && (
            <InkArt drawing={STEP_RUNNING} className="ink-scribble h-5 w-5" pace={500} />
          )
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words">
          <span className="font-medium">{label.tool}</span>
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
        {Details && state !== "preparing" && (
          <Details step={step} name={stepName(label, summary)} />
        )}
      </div>
    </div>
  );
});

/** A run of tool calls with no words between them: one narration caption, a line per call. */
export function ToolSteps({ steps }: { steps: readonly ChatStep[] }) {
  const { StepDetails } = useChat();
  return (
    <Narration data-tool-steps="">
      <div className="space-y-1">
        {steps.map((step) => (
          <StepLine key={step.key} step={step} Details={StepDetails} />
        ))}
      </div>
    </Narration>
  );
}
