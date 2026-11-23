"use client";

/**
 * The owner's sign that Approve all is on (design 1.2 "Approve-all chip";
 * audit write-confirm-claims-false). Once the owner picks a card's "{Verb},
 * and don't ask again until I close", Amr makes changes without asking, and
 * nothing else on screen says so. While it holds, the panel shows it under
 * its header, over the chat and History alike: a narration caption, "Not
 * asking before changes", with "Ask before changes again", which turns
 * Approve all off at once. Deletes and resets ask either way
 * (lib/agent/execute-tool), and closing the panel, New chat and the chat
 * changing hands turn it off as well (the agent store).
 *
 * Pressed, the chip goes, so focus goes on first: to the message box, caret
 * at the end, after a key press or a click; after a tap on a touch screen,
 * where the box would raise the keyboard, and in History, where there is no
 * box, the panel's focus owner takes it to the name plate. The app's
 * announcer says the change, politely.
 *
 * Owner only: the owner's panel imports it (mascot/owner-agent-panel), so it
 * ships in the owner's chunk, never in the chunk both chats share (a
 * visitor's chat has no Approve all).
 */

import type { MouseEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent/store";
import { Narration } from "../comic/comic-parts";
import { focusAtEnd, tapOnTouchScreen } from "./chat-context";

/** The chip's words while Approve all holds. */
export const NOT_ASKING = "Not asking before changes";
/** Its button, which turns Approve all off. */
export const ASK_AGAIN = "Ask before changes again";
/** What the announcer says once it is off. */
export const ASKING_AGAIN = "Amr asks before changes again.";

/** "Not asking before changes", while Approve all is on (see the file comment). */
export function AutoApproveChip() {
  const on = useAgentStore((s) => s.autoApprove);
  const announce = useAnnounce();
  if (!on) return null;

  const askAgain = (e: MouseEvent<HTMLButtonElement>) => {
    if (!tapOnTouchScreen(e)) {
      const panel = e.currentTarget.closest('[role="dialog"]') ?? e.currentTarget.ownerDocument;
      focusAtEnd(panel.querySelector<HTMLElement>("[data-amr-composer]"));
    }
    useAgentStore.getState().setAutoApprove(false);
    announce(ASKING_AGAIN);
  };

  return (
    // In from the panel's edge, so High contrast's focus ring isn't clipped.
    <div className="shrink-0 px-3 pt-2" data-auto-approve="">
      <Narration
        actions={
          <Button type="button" variant="outline" size="sm" onClick={askAgain}>
            {ASK_AGAIN}
          </Button>
        }
      >
        {NOT_ASKING}
      </Narration>
    </div>
  );
}
