"use client";

import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";

/**
 * Drives Amr's figure from the chat (lib/agent/mascot/use-chat-reactions.ts):
 * he talks while his words stream, watches while a card waits, nods at a
 * result, frowns at an error. It renders nothing. MascotAssistant renders it
 * instead of calling the hook itself, so when the chat's state changes only
 * this child re-renders, never the assistant's shell (its header, its panel,
 * the sprite).
 */
export function MascotChatReactions(): null {
  useMascotChatReactions();
  return null;
}
