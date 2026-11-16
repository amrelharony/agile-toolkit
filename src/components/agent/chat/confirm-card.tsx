"use client";

/**
 * The decision panel (DNA-SPEC §6 "Chat strip"): the card Amr's chat shows
 * before a change runs, in words. execute-tool's describeAction writes them
 * (lib/agent/types ConfirmPrompt):
 *
 *   tab       the step caption, "Retro Board · Add card", a narration caption
 *             sitting on the panel's top edge
 *   question  the card's title, lettered: "Add a card to Retro Board?"
 *   detail    the arguments in Inter: `Text: “flaky CI”`
 *   buttons   the verb ("Add card", or the action's own confirmLabel), then,
 *             for the owner only, "Add card, and don't ask again until I
 *             close" (Approve all), then "Not now"
 *
 * A destructive change (delete, remove, reset, clear, archive) draws its verb
 * as the destructive button and offers no Approve all: execute-tool asks
 * before every one of them even when Approve all is on, so the button would
 * promise what doesn't happen. Visitors never get Approve all; they approve
 * each change.
 *
 * Every button is 44 px on a coarse pointer (size "sm") and wraps a long label
 * rather than running out of the panel.
 *
 * Coming. Each card (by its call's id) is brought into view in the chat's
 * scrollers (the log, then a short panel's root), each with its own
 * scrollTo, as little as needed, never scrollIntoView, which would move the
 * page too and on iOS pans the visual viewport. It takes focus (its group,
 * which reads its question and detail) only when focus is on nothing (the
 * body), on Send/Stop (data-chat-send) or inside the log: someone typing in
 * the message box, or anywhere else, keeps their place and their draft, and
 * the chat's announcer says "Amr needs your OK: {question}" instead. Focus
 * moves in this card's own effect, never a frame later: the announcer's
 * effect runs right after it (the card is drawn inside the chat's frame) and
 * stays quiet only for a card that took focus (use-turn-announcer).
 *
 * Decided. The card goes, so its buttons hand focus on first: on a fine
 * pointer to the message box, caret at the end; on a touch screen to the
 * caption of the step it asked about (tool-steps), which stays, since the box
 * taking focus would raise the keyboard over the strip. The caption takes no
 * focus of its own: it is made focusable (tabindex -1) only as it takes
 * focus here, and only until it loses it (chat-context focusFromCode), so a
 * tap on a step line never takes focus from the box.
 *
 * The card has no Escape of its own:
 * the panel's Escape order (mascot-assistant) denies a waiting change first,
 * before it leaves History or closes, and only for an Escape meant for the
 * panel, never one a page field or overlay uses.
 *
 * Runtime code (the agent store), so it lives in chat/, which every-page code
 * may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent/store";
import { focusFromCode, onTouchScreen, useChat } from "./chat-context";
import { nearestTop, scrollElTo } from "./use-stick-to-bottom";

/** Long labels wrap inside the panel instead of running out of it; the height follows the words. */
const WRAP = "h-auto md-fine:h-auto whitespace-normal py-1.5";

/** Focus is where a coming card may take it: on nothing, on Send/Stop, or inside the log. */
function mayTakeFocus(card: HTMLElement): boolean {
  const doc = card.ownerDocument;
  const active = doc.activeElement;
  if (!active || active === doc.body || active.closest("[data-chat-send]")) return true;
  return card.closest('[role="log"]')?.contains(active) ?? false;
}

/**
 * The card into view in each scroller around it up to the chat's frame, as
 * little as needed. Nothing for a card drawn outside a chat frame.
 */
function bringIntoView(card: HTMLElement) {
  const frame = card.closest("[data-chat-frame]");
  if (!frame) return;
  for (let el = card.parentElement; el; el = el.parentElement) {
    if (el.scrollHeight - el.clientHeight > 1) {
      const view = el.getBoundingClientRect();
      const part = card.getBoundingClientRect();
      const top = part.top - view.top - el.clientTop + el.scrollTop;
      const to = nearestTop(el.scrollTop, el.clientHeight, top, part.height);
      if (to !== null) scrollElTo(el, Math.max(0, to), "instant");
    }
    if (el === frame) return;
  }
}

export interface ConfirmCardProps {
  /**
   * The owner's chat: offer "{Verb}, and don't ask again until I close", which
   * turns Approve all on until the panel closes. Leave it off for visitors.
   */
  allowApproveAll?: boolean;
}

/** The waiting change's card, or nothing while no change waits. */
export function ConfirmCard({ allowApproveAll = false }: ConfirmCardProps) {
  const pending = useAgentStore((s) => s.pendingToolUse);
  const setAutoApprove = useAgentStore((s) => s.setAutoApprove);
  const { focusComposer } = useChat();
  const id = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = pending?.toolUseId ?? null;

  // A card comes: into view, and focus when it may take it (file comment).
  useEffect(() => {
    const card = cardRef.current;
    if (!card || cardId === null) return;
    bringIntoView(card);
    if (mayTakeFocus(card)) card.focus({ preventScroll: true });
  }, [cardId]);

  if (!pending) return null;
  const { prompt } = pending;
  /** The reader decided: focus goes on before the card goes (file comment). */
  const decide = (approve: boolean) => {
    const card = cardRef.current;
    if (onTouchScreen(card?.ownerDocument)) {
      focusFromCode(
        card?.closest('[data-chat-item="steps"]')?.querySelector<HTMLElement>("[data-tool-steps]")
      );
    } else {
      focusComposer();
    }
    pending.resolve(approve);
  };
  const label = prompt.confirmLabel ?? prompt.verb;
  const approveAll = allowApproveAll && !prompt.destructive;
  const questionId = `${id}-question`;
  const detailId = `${id}-detail`;

  return (
    <div
      ref={cardRef}
      role="group"
      tabIndex={-1}
      aria-labelledby={questionId}
      aria-describedby={prompt.detail ? detailId : undefined}
      // 1 px in from the log's edge, so High contrast's focus ring (5 px out) isn't clipped.
      className="mx-px flex min-w-0 flex-col"
      data-confirm-card=""
      data-destructive={prompt.destructive ? "" : undefined}
    >
      {/* The step caption as the card's tab, on the panel's top edge. */}
      <p
        className="comic-caption relative z-10 -mb-2 ms-3 w-fit max-w-[calc(100%-1.5rem)] break-words px-2 py-0.5 font-sans text-xs leading-relaxed text-sub"
        data-voice="narration"
        data-confirm-step=""
      >
        <span className="font-medium text-text">{prompt.title}</span>
        {prompt.verb && ` · ${prompt.verb}`}
      </p>
      <div className="panel flex flex-col gap-2 px-3 pb-3 pt-4 shadow-md">
        {/* A card title, so it is lettered (DNA-SPEC section 5). */}
        <h3
          id={questionId}
          dir="auto"
          className="break-words font-display text-base font-semibold leading-snug text-text"
        >
          {prompt.question}
        </h3>
        {prompt.detail && (
          <p
            id={detailId}
            dir="auto"
            className="break-words font-sans text-sm leading-relaxed text-sub"
          >
            {prompt.detail}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant={prompt.destructive ? "destructive" : "default"}
            className={WRAP}
            onClick={() => decide(true)}
          >
            {label}
          </Button>
          {approveAll && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={WRAP}
              onClick={() => {
                setAutoApprove(true);
                decide(true);
              }}
            >
              {`${label}, and don't ask again until I close`}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={WRAP}
            onClick={() => decide(false)}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
