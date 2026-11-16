"use client";

/**
 * The strip kit: the parts that draw and read a chat's messages (each item's
 * view, where the reply's end goes, the confirm card and where it stands, a
 * tool's name in words; and the reading layer: the view that turns messages
 * into items, with the markdown parser and the tool results' words, and a
 * settled turn's words as they are said out loud), which the strip, the log,
 * the status line and the announcer take from the holder (chat/strip-kit-ref)
 * instead of importing them.
 *
 * Whoever evaluates this module fills the holder: the owner's chat imports it
 * statically (agent-conversation), so a resumed thread draws on its first
 * render; a visitor's comes with the runtime on the first message
 * (mascot/visitor-chat-runtime), before the question reaches the store, so
 * the visitor's first paint doesn't carry the markdown renderer or parser,
 * the chat view, the steps, the card, the spoken words or the tools' names;
 * tests import it to draw messages.
 */

import { createChatView } from "@/lib/agent/chat-view";
import { toolLabel } from "@/lib/agent/tool-label";
import { ChatItemView, latestReply } from "./chat-items";
import { ConfirmCard } from "./confirm-card";
import { turnAnnouncement } from "./spoken-text";
import { provideStripKit } from "./strip-kit-ref";
import { cardUnderStep } from "./tool-steps";

export const STRIP_KIT = Object.freeze({
  ChatItemView,
  latestReply,
  ConfirmCard,
  cardUnderStep,
  toolLabel,
  createChatView,
  turnAnnouncement,
});

export type StripKit = typeof STRIP_KIT;

provideStripKit(STRIP_KIT);
