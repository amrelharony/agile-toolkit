"use client";

/**
 * The strip kit: the parts that draw a chat's messages (each item's view,
 * where the reply's end goes, the confirm card and where it stands, a tool's
 * name in words), which the log and the status line take from the holder
 * (chat/strip-kit-ref) instead of importing them.
 *
 * Whoever evaluates this module fills the holder: the owner's chat imports it
 * statically (agent-conversation), so a resumed thread draws on its first
 * render; a visitor's comes with the runtime on the first message
 * (mascot/visitor-chat-runtime), before the question reaches the store, so
 * the visitor's first paint doesn't carry the markdown renderer, the steps,
 * the card or the tools' names; tests import it to draw messages.
 */

import { toolLabel } from "@/lib/agent/tool-label";
import { ChatItemView, latestReply } from "./chat-items";
import { ConfirmCard } from "./confirm-card";
import { provideStripKit } from "./strip-kit-ref";
import { cardUnderStep } from "./tool-steps";

export const STRIP_KIT = Object.freeze({
  ChatItemView,
  latestReply,
  ConfirmCard,
  cardUnderStep,
  toolLabel,
});

export type StripKit = typeof STRIP_KIT;

provideStripKit(STRIP_KIT);
