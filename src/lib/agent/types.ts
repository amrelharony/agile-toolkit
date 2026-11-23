/**
 * Anthropic-shaped message blocks. Mirrors the Messages API content
 * format so we can pass our messages array straight through to Claude.
 */

export type TextBlock = {
  type: "text";
  text: string;
  /**
   * Narration the client wrote in an assistant message, not the model's own
   * words (client.ts roundLimitNote standing in for a wrap-up): the chat draws
   * it as a narration caption, never in Amr's balloon. On the block, so it is
   * stored with the content; the wire still sends it as assistant text.
   */
  note?: true;
};
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<TextBlock>;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: ContentBlock[];
  createdAt: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  toolId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

/**
 * What a confirm card asks before Amr runs a change, in words. Built by
 * execute-tool's describeAction from the action and its checked arguments;
 * never an action id, a key name or JSON.
 */
export interface ConfirmPrompt {
  /** What the call does, in sentence case, from tool-label: "Add card". The step caption shows it. */
  verb: string;
  /** The tool's human name, from tool-label: "Retro Board" ("Workspace" for workspace data and intents). */
  title: string;
  /** The card's question, as a sentence: "Add a card to Retro Board?" */
  question: string;
  /**
   * The arguments in words, text quoted and shortened, and a value the schema
   * calls internal (an enum's, a column's key) said as words: `Column: Went
   * well · Text: “flaky CI”`. Ids are left out. Empty when nothing is worth
   * showing.
   */
  detail: string;
  /**
   * A delete, remove, reset, clear or archive (by the action's name). It always
   * asks, whatever the action declares and even after Approve all, and its
   * button is drawn as destructive.
   */
  destructive: boolean;
  /** The action's own verb phrase ("Delete this risk"), when it has one: the button and the question use it. */
  confirmLabel?: string;
}

/** Pending tool_use awaiting user approval. BUG-G9: the resolver lives
 *  on the pending object itself, not on globalThis, so concurrent
 *  confirmation requests can't orphan each other. */
export interface PendingToolUse {
  toolUseId: string;
  actionId: string; // e.g. "workspace_sprint_create" (Claude name)
  resolvedActionId: string; // e.g. "workspace.sprint.create" (registry id)
  input: Record<string, unknown>;
  /** What the card asks, in words. */
  prompt: ConfirmPrompt;
  /** Called by the confirm card. Approves or denies the tool execution. */
  resolve: (approved: boolean) => void;
}
