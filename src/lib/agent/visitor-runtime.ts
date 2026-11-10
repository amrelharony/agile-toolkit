"use client";

/**
 * The visitor chat's runtime (visitor AI), loaded on demand.
 *
 * Everything a visitor's chat needs to run tools in their own tab, the action
 * registry (~830 actions + zod) and the streaming client, sits behind this
 * module. The visitor panel imports it with a dynamic import() on the
 * visitor's FIRST send, so the page, the guide and the consent card never ship
 * it, and a visitor who never asks Amr anything never downloads it.
 */

// Populate the tool action registry before any agent code reads it.
import "@/lib/actions/register-all";
import { abortInFlight, sendUserMessage } from "./client";

/** The id a visitor's tool calls run under (their own browser data; no account). */
const VISITOR_USER_ID = "visitor";

/**
 * Send one visitor message and run the turn to its end: the visitor route
 * answers, and any tool Amr calls runs here, asking first before a change.
 * `toolId` is the open page's tool (an id or a path), or null.
 */
export function sendVisitorMessage(
  text: string,
  opts: { toolId: string | null; signal?: AbortSignal }
): Promise<void> {
  return sendUserMessage(text, {
    userId: VISITOR_USER_ID,
    profile: "visitor",
    toolId: opts.toolId,
    signal: opts.signal,
  });
}

export { abortInFlight };
