"use client";

/**
 * The owner's way back to an older thread (design PR 12 "Resume"; audit
 * critic1-3). On the first open after a page load the owner's chat picks the
 * latest thread up only when its last message is under two hours old
 * (agent-conversation's RESUME_WITHIN_MS). An older one would carry a stale
 * topic, and its whole history, into a new question, so the chat starts
 * fresh and its empty state offers that thread under the starters:
 * 'Pick up “{title}”'.
 *
 * It wears the starters' Button recipe (chat/suggestion-chips: outline, sm,
 * 44 px on a touch screen, rounded-md, wrapping) with a History mark before
 * its words, in a list of its own ("Your last chat"), but it is a way to a
 * thread, not words for the box: pressed, it reads the thread (loadMessages)
 * and opens it as History does (setActiveConversation, so the strip says
 * "Picking up where you left off" after its last message), and the draft is
 * left as it was. While it reads, it is busy and a second press does
 * nothing. A thread that can't be read stays shut: the chip stays, with a
 * narration caption saying so (said once, assertively), and a press tries
 * again. A thread with nothing left in it (deleted meanwhile) is no longer
 * offered. Anything the owner started meanwhile wins: the thread isn't
 * opened over it.
 *
 * The chip goes as the thread opens, so focus goes on first: to the message
 * box, caret at the end, after a key press or a click; after a tap on a touch
 * screen, where the box would raise the keyboard, the panel's focus owner
 * takes it as the chip goes.
 *
 * Owner only: the owner's chat imports it (agent-conversation), so it ships in
 * the owner's chunk, never in the chunk both chats share.
 */

import { useState, type MouseEvent } from "react";
import { History } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { loadMessages } from "@/lib/agent/persist";
import { useAgentStore } from "@/lib/agent/store";
import type { ConversationMeta } from "@/lib/agent/types";
import { Narration } from "../comic/comic-parts";
import { tapOnTouchScreen, useChat } from "./chat-context";

/** The chip's words. */
export const pickUpLabel = (title: string) => `Pick up “${title}”`;
/** Its list's name. */
export const PICK_UP_LIST = "Your last chat";
/** The thread couldn't be read (narration, said once): History's words for the same. */
export const pickUpFailed = (title: string) =>
  `Amr couldn't open “${title}”. Check your connection and try again.`;

export interface PickUpChipProps {
  /** The latest thread, too old to resume on its own. */
  thread: ConversationMeta;
  /** The thread was opened, or is no longer worth offering: stop offering it. */
  onDone(): void;
}

/** 'Pick up “{title}”': opens an older thread (see the file comment). */
export function PickUpChip({ thread, onDone }: PickUpChipProps) {
  const { focusComposer } = useChat();
  const announce = useAnnounce();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    const tap = tapOnTouchScreen(e);
    setBusy(true);
    setFailed(false);
    const loaded = await loadMessages(thread.id);
    setBusy(false);
    if (!loaded.ok) {
      setFailed(true);
      announce(pickUpFailed(thread.title), "assertive");
      return;
    }
    const store = useAgentStore.getState();
    // Something the owner started meanwhile wins; an emptied thread has nothing to pick up.
    if (store.activeConversationId !== null || store.messages.length > 0 || !loaded.data.length) {
      onDone();
      return;
    }
    if (!tap) focusComposer();
    store.setActiveConversation(thread, loaded.data);
    onDone();
  };

  return (
    <div className="space-y-2" data-chat-pick-up="">
      <ul aria-label={PICK_UP_LIST} className="mx-px flex flex-wrap gap-2">
        <li className="max-w-full">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-busy={busy || undefined}
            className="h-auto max-w-full gap-2 whitespace-normal py-1.5 text-left text-sm md-fine:h-auto"
            onClick={(e) => void pick(e)}
          >
            <History aria-hidden="true" className="shrink-0" />
            <span dir="auto">{pickUpLabel(thread.title)}</span>
          </Button>
        </li>
      </ul>
      {failed && (
        <Narration tone="error" data-chat-pick-up-failed="">
          {pickUpFailed(thread.title)}
        </Narration>
      )}
    </div>
  );
}
