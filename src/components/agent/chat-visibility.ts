"use client";

import { createContext, useContext } from "react";

/**
 * Whether the chat is in view. Amr's panel keeps its chat mounted but hidden while
 * his Scenes view covers it, so a turn in flight goes on; a hidden chat can neither
 * take focus nor scroll, so it focuses its message box and scrolls to the latest
 * message again when it comes back. Anywhere else the chat is always in view.
 */
export const ChatVisibleContext = createContext(true);

/** Whether the chat around this component is in view (see ChatVisibleContext). */
export const useChatVisible = () => useContext(ChatVisibleContext);
