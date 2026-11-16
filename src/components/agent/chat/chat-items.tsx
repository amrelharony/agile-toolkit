"use client";

/**
 * The comic strip's items (DNA-SPEC section 6, "Chat strip"): one memoised
 * component for each kind of lib/agent/chat-view item, shared by both chats'
 * logs (the owner's and a visitor's).
 *
 *   you      the reader's words, verbatim, in a you caption, on the side
 *            across from Amr
 *   balloon  Amr's own words in a speech balloon on his side, its tail toward
 *            the real Amr beside the panel (data-tail="amr", which globals.css
 *            turns to face him from the panel root's data-amr-side and
 *            data-amr-edge, so nothing re-renders when he moves): the reply
 *            as markdown, its lead lettered inside the first paragraph, and
 *            the full width of the log when it holds a table or code. Until
 *            a streaming reply's opening sentence is decided, the balloon
 *            scribbles with no words, so no word ever changes face
 *   steps    one narration caption for a run of tool calls: each call's tool
 *            and verb in words (lib/agent/tool-label), where it stands and
 *            what it touched (lib/agent/tool-result-text), never the wire
 *            name, the arguments or the result string. Only the owner gets
 *            "Details" with the raw arguments and result; a visitor never sees
 *            JSON. The interim caption, as the old step rows read: the step
 *            caption with its state slot and ink tick takes its place.
 *   note     a line the client wrote for Amr (the round limit's stand-in),
 *            in a narration caption with no "Amr said:": it is about him,
 *            not his words. Inline markdown, so an action's id is a chip.
 *
 * A message with only tool calls draws no balloon: chat-view makes it steps
 * alone. No second Amr in the chat either: the real one stands beside it, and
 * the balloon's hidden "Amr said:" names him for a screen reader.
 *
 * Each kind is memoised on its view item, which createChatView hands back
 * unchanged when nothing in it changed (and the chat context keeps its
 * identity too), so a streamed flush re-renders only the reply still growing.
 *
 * Sides: the panel root (a `group/amr`) names Amr's side, and the items read
 * it as class names. His balloons stand on it, mirrored when he moves, and
 * keep 0.875rem from that edge for the tail, which stands 0.8rem out and a
 * scroller would clip; the reader's captions stand on the other side. With no
 * panel around them (a test, a preview), he is on the left. Each item is one
 * flex row, so it lays out the same in a block or a flex log.
 *
 * Nothing moves when an item arrives: it is simply there, in every mode.
 *
 * Runtime parts (the markdown renderer and its panel context), so this lives
 * in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { memo, useId } from "react";
import { ChevronDown } from "lucide-react";
import { Narration, YouCaption } from "../comic/comic-parts";
import { AmrBalloon, ThinkingBalloon } from "../comic/strip-parts";
import { Markdown } from "../markdown";
import type {
  BalloonItem,
  ChatItem,
  ChatStep,
  NoteItem,
  StepsItem,
  YouItem,
} from "@/lib/agent/chat-view";
import { toolLabel, type ToolLabel } from "@/lib/agent/tool-label";
import { STEP_WORDS, TROUBLE_STATES, resultText, stepSummary } from "@/lib/agent/tool-result-text";
import type { ToolResultBlock, ToolUseBlock } from "@/lib/agent/types";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-context";

/** Amr's side of the log: a balloon stands there, mirrored when he moves, with room for its tail. */
const AMR_SIDE =
  "ml-3.5 mr-auto group-data-[amr-side=right]/amr:ml-auto group-data-[amr-side=right]/amr:mr-3.5";

/** The reader's side: across from Amr. */
const YOU_SIDE =
  "ml-auto group-data-[amr-side=right]/amr:ml-0 group-data-[amr-side=right]/amr:mr-auto";

/** How far a balloon or caption that doesn't run full width may reach across the log. */
const NARROW = "max-w-[85%]";

/** The most of the raw arguments or result the owner's Details shows, in characters. */
const DETAILS_MAX = 4000;

/** The label for a result whose call isn't in the chat. */
const UNPAIRED: ToolLabel = { tool: "Step", verb: "" };

/** A step's separator, as the chat's other plain lines write it ("Chat · not saved"). */
const SEP = " · ";

/** The reader's words, in a you caption across from Amr. */
export const YouItemView = memo(function YouItemView({ item }: { item: YouItem }) {
  return (
    <div className="flex" data-chat-item="you" data-message-id={item.messageId}>
      <YouCaption className={cn(YOU_SIDE, NARROW)}>{item.text}</YouCaption>
    </div>
  );
});

/**
 * Amr's words, in a balloon on his side whose tail points at him. While the
 * reply's opening sentence is undecided (item.held), the balloon scribbles
 * with no words, so they first show in their final face, lettered or not.
 */
export const BalloonItemView = memo(function BalloonItemView({ item }: { item: BalloonItem }) {
  if (item.held) {
    return (
      <div className="flex" data-chat-item="balloon" data-message-id={item.messageId} data-held="">
        <ThinkingBalloon className={AMR_SIDE} />
      </div>
    );
  }
  return (
    <div
      className="flex"
      data-chat-item="balloon"
      data-message-id={item.messageId}
      data-wide={item.wide ? "" : undefined}
    >
      {/* A table or code needs the room: the balloon takes the row. */}
      <AmrBalloon className={cn(AMR_SIDE, item.wide ? "flex-1" : NARROW)}>
        <Markdown source={item.text} lead={item.lead} />
      </AmrBalloon>
    </div>
  );
});

/**
 * Amr about to answer (a turn under way, no words or steps of its reply yet):
 * his balloon on his side with a pen scribbling in it and no words. Hidden
 * from assistive tech; the chat's status line says it in words.
 */
export const ThinkingItemView = memo(function ThinkingItemView() {
  return (
    <div className="flex" data-chat-item="thinking">
      <ThinkingBalloon className={AMR_SIDE} />
    </div>
  );
});

/**
 * Which step a Details block belongs to, for a screen reader: "Retro Board ·
 * Add card “flaky CI”". A plain string, so the memo below still holds.
 */
function stepName(label: ToolLabel, summary: string | null): string {
  const name = label.verb ? `${label.tool}${SEP}${label.verb}` : label.tool;
  return summary ? `${name} “${summary}”` : name;
}

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
 * blocks are. The disclosure and both regions carry the step's words for a
 * screen reader (hidden on screen), so several steps don't all read
 * "Details" or give the same "Input" and "Result" landmarks. Memoised on the
 * call's input and its result block (the store keeps both until they
 * change), so a streamed flush or a keystroke in the composer doesn't write
 * the raw JSON out again.
 */
const StepDetails = memo(function StepDetails({
  step,
  input,
  result,
}: {
  /** The step in words (stepName). */
  step: string;
  input?: ToolUseBlock["input"];
  result?: ToolResultBlock;
}) {
  const inputId = useId();
  const resultId = useId();
  const block =
    "max-h-40 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded-md border border-rule bg-card p-2 font-data text-xs text-text";
  return (
    <details className="group/details mt-1">
      <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 text-xs text-sub hover:text-text pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
        Details <span className="sr-only">for {step}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 group-open/details:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 space-y-1">
        {input !== undefined && (
          <>
            <p id={inputId} className="text-xs text-sub">
              Input <span className="sr-only">for {step}</span>
            </p>
            <pre role="region" aria-labelledby={inputId} tabIndex={0} dir="ltr" className={block}>
              {capped(inputText(input))}
            </pre>
          </>
        )}
        {result && (
          <>
            <p id={resultId} className="text-xs text-sub">
              Result <span className="sr-only">for {step}</span>
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

/**
 * One step in words: "Retro Board · Add card · Done · “flaky CI”". The tool
 * leads in medium weight; trouble is said in words, the danger colour only a
 * second cue. Its arguments are left out while they still stream.
 */
const StepLine = memo(function StepLine({
  step,
  details,
}: {
  step: ChatStep;
  /** The owner's chat: Details with the raw arguments and result. */
  details: boolean;
}) {
  const { call, result, state } = step;
  const label = call ? toolLabel(call.name) : UNPAIRED;
  const summary = call && state !== "preparing" ? stepSummary(call, result) : null;
  return (
    <div data-tool-step={state ?? "unknown"}>
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
      {details && state !== "preparing" && (
        <StepDetails step={stepName(label, summary)} input={call?.input} result={result} />
      )}
    </div>
  );
});

/** A run of tool calls with no words between them: one narration caption, a line per call. */
export const StepsItemView = memo(function StepsItemView({ item }: { item: StepsItem }) {
  const { profile } = useChat();
  const details = profile === "owner";
  return (
    <div data-chat-item="steps" data-message-id={item.steps[0]?.messageId}>
      <Narration data-tool-steps="">
        <div className="space-y-1">
          {item.steps.map((step) => (
            <StepLine key={step.key} step={step} details={details} />
          ))}
        </div>
      </Narration>
    </div>
  );
});

/** A line the client wrote for Amr, told as narration: no balloon, no "Amr said:". */
export const NoteItemView = memo(function NoteItemView({ item }: { item: NoteItem }) {
  return (
    <div data-chat-item="note" data-message-id={item.messageId}>
      <Narration tone="note">
        <Markdown source={item.text} />
      </Narration>
    </div>
  );
});

/** One item of the strip, whatever its kind: what the log draws for each chatView item. */
export function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you":
      return <YouItemView item={item} />;
    case "balloon":
      return <BalloonItemView item={item} />;
    case "steps":
      return <StepsItemView item={item} />;
    case "note":
      return <NoteItemView item={item} />;
  }
}
