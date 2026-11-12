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
 * rather than running out of the panel. Escape denies the change, as the store
 * does when the panel closes, until the panel's own Escape order takes this
 * over. Only an Escape meant for the chat denies: one from inside the panel,
 * from Amr himself, or with nothing focused. It leaves page fields and
 * overlays alone (the panel floats non-modal over the tool page), and an
 * Escape that something else already handled or that an input method is
 * composing.
 *
 * Runtime code (the agent store), so it lives in chat/, which every-page code
 * may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent/store";

/** Long labels wrap inside the panel instead of running out of it; the height follows the words. */
const WRAP = "h-auto md-fine:h-auto whitespace-normal py-1.5";

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
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Escape = deny. The store denies on closeSheet, setActiveConversation and
  // reset, but not when the reader just presses Escape while the card shows,
  // and the turn would wait for the answer forever.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // Only an Escape meant for Amr's chat denies: one from inside the panel,
      // from Amr himself, or with nothing focused. An Escape a page field or
      // overlay uses (a cycle-time cell, the comic overlay) leaves the change
      // waiting. The panel is the dialog the card sits in; Amr's button
      // carries data-amr-button (mascot-assistant).
      const t = e.target;
      const panel = rootRef.current?.closest('[role="dialog"]');
      const ours =
        !(t instanceof Element) ||
        t === document.body ||
        !!panel?.contains(t) ||
        !!t.closest("[data-amr-button]");
      if (!ours) return;
      e.preventDefault();
      pending.resolve(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;
  const { prompt } = pending;
  const label = prompt.confirmLabel ?? prompt.verb;
  const approveAll = allowApproveAll && !prompt.destructive;
  const questionId = `${id}-question`;
  const detailId = `${id}-detail`;

  return (
    <div
      ref={rootRef}
      role="group"
      aria-labelledby={questionId}
      aria-describedby={prompt.detail ? detailId : undefined}
      className="flex min-w-0 flex-col"
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
            onClick={() => pending.resolve(true)}
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
                pending.resolve(true);
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
            onClick={() => pending.resolve(false)}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
