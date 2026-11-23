/**
 * What the narrator says beside Amr while his chat panel is shut and a turn
 * still runs in it (turns outlive the panel, the owner's and a visitor's
 * alike). Narration, in the third person, never a line of Amr's own (DNA-SPEC
 * §6 "Chat strip"):
 *
 *   waiting    a card waits for an OK: "Amr is waiting for your OK",
 *              with an Open button that brings the panel back to the card
 *   tool       a tool call is out: "Amr is working in Retro Board…", the tool
 *              named from the call's wire name by lib/agent/tool-label
 *   answering  the rest of the turn: "Amr is answering…"
 *
 * Drawn by components/agent/mascot/mascot-bubble.tsx as a caption box with no
 * tail. The phase is a string, so a store selector re-renders the bubble only
 * when it changes, never for each streamed token. Pure: tool-label comes in as
 * an argument, because the bubble ships on every page and fetches that helper
 * only once a turn runs (by then the chat that runs it has loaded it).
 */

import type { ToolLabel } from "../tool-label";
import type { ChatMessage } from "../types";

/** A card waits for an OK. Also the owner header's note on "Back to chat". */
export const AMR_WAITING_FOR_OK = "Amr is waiting for your OK";
/** The turn runs, with no tool call out. */
export const AMR_ANSWERING = "Amr is answering…";

/** Where the turn is, as the bubble needs it: a card, a tool call (by wire name), or the rest. */
export type OutsidePhase = "waiting" | "answering" | `tool:${string}`;

/** The parts of the agent store the phase is read from. */
export interface TurnView {
  open: boolean;
  chatProfile: "owner" | "visitor";
  streaming: boolean;
  pendingToolUse: unknown;
  messages: readonly ChatMessage[];
}

/** A turn runs, the owner's or a visitor's, with the panel open or shut (a card waiting counts). */
export function turnRuns(s: TurnView): boolean {
  return s.streaming || s.pendingToolUse != null;
}

/**
 * The narration's phase, or null when there is nothing to tell: the panel is
 * open (the chat says it there), or no turn runs.
 * A tool call is out while the turn's latest message is Amr's and holds one;
 * its result arrives with the next message. The first call of the round names
 * the tool.
 */
export function outsidePhase(s: TurnView): OutsidePhase | null {
  if (s.open || !turnRuns(s)) return null;
  if (s.pendingToolUse != null) return "waiting";
  const last = s.messages[s.messages.length - 1];
  if (last?.role === "assistant") {
    for (const c of last.content) if (c.type === "tool_use" && c.name) return `tool:${c.name}`;
  }
  return "answering";
}

/**
 * "Amr is working in Retro Board…". Workspace data and cross-tool intents are
 * the owner's own workspace; a name the catalog doesn't know (tool-label's
 * "Tool") goes unnamed rather than read as a tool called Tool.
 */
export function workingIn(label: ToolLabel): string {
  if (label.tool === "Workspace") return "Amr is working in your workspace…";
  if (label.tool === "Tool") return "Amr is working…";
  return `Amr is working in ${label.tool}…`;
}

/**
 * The narration for a phase, or null for none. A tool call needs tool-label
 * (`labelOf`) to name it: until that has loaded, there is none yet.
 */
export function outsideNarration(
  phase: OutsidePhase | null,
  labelOf: ((wireName: string) => ToolLabel) | null
): string | null {
  if (phase === null) return null;
  if (phase === "waiting") return AMR_WAITING_FOR_OK;
  if (phase === "answering") return AMR_ANSWERING;
  return labelOf ? workingIn(labelOf(phase.slice("tool:".length))) : null;
}
