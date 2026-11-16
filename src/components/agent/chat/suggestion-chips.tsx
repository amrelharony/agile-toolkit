"use client";

/**
 * Starters, shared by both chats' empty state (chat-empty): a few ways to
 * begin, written as the reader's own questions ("How does Retro Board
 * work?"), never in Amr's voice and never with I, me or my in them (a chat
 * line in the first person reads as his).
 *
 * A starter fills the message box and never sends: the reader reads it,
 * changes it or sends it (a change would still ask first, and a visitor's
 * message spends their allowance). The box gets its words, or, after what the
 * reader typed themselves, its words on a new paragraph, so nothing typed is
 * lost; another starter's words in the box are swapped. Focus then goes to
 * the box with the caret at the end (the chat context's focusComposer):
 * always after a key press; after a tap on a touch screen it stays put, as
 * chat-frame's Latest and the notice's buttons do, since the box taking
 * focus would raise the keyboard over the strip. The box shows the words
 * either way, beside Send, and after a tap the app's announcer says so
 * ("In the message box: {starter}", politely), since focus didn't go there
 * to tell a screen reader.
 *
 * Outline buttons, rounded-md (never a pill), 44 px tall on a touch screen
 * (Button size sm), a long one wrapping rather than cut off. They are simply
 * there, in every mode: nothing moves in.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "@/lib/agent/store";
import { tapOnTouchScreen, useChat } from "./chat-context";

/**
 * The box's words once `starter` is picked: the starter alone over an empty
 * box or another of `starters`, else after what was typed, on a new paragraph.
 */
export function filledDraft(draft: string, starter: string, starters: readonly string[]): string {
  const typed = draft.trim();
  return !typed || starters.includes(typed) ? starter : `${draft.trimEnd()}\n\n${starter}`;
}

/** What the announcer says after a tap put `starter` in the box: no speaker, no I, me or my. */
export const inTheBox = (starter: string) => `In the message box: ${starter}`;

/** The starters, as buttons that fill the message box (see the file comment). */
export function SuggestionChips({ starters }: { starters: readonly string[] }) {
  const { profile, focusComposer } = useChat();
  const announce = useAnnounce();
  const pick = (e: MouseEvent<HTMLButtonElement>, starter: string) => {
    const store = useAgentStore.getState();
    const next = filledDraft(store.drafts[profile], starter, starters);
    // In the box before focus goes there, so the caret lands after the words.
    flushSync(() => store.setDraft(profile, next));
    if (tapOnTouchScreen(e)) announce(inTheBox(starter));
    else focusComposer();
  };
  return (
    // 1 px in from the log's edge, so High contrast's focus ring (5 px out) isn't clipped.
    <ul aria-label="Ways to start" className="mx-px flex flex-wrap gap-2" data-chat-starters="">
      {starters.map((starter) => (
        <li key={starter} className="max-w-full">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal py-1.5 text-left text-sm md-fine:h-auto"
            onClick={(e) => pick(e, starter)}
          >
            {starter}
          </Button>
        </li>
      ))}
    </ul>
  );
}
