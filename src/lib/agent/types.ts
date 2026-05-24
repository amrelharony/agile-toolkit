/**
 * Anthropic-shaped message blocks. Mirrors the Messages API content
 * format so we can pass our messages array straight through to Claude.
 */

export type TextBlock = { type: "text"; text: string };
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

/** Pending tool_use awaiting user approval. BUG-G9: the resolver lives
 *  on the pending object itself, not on globalThis, so concurrent
 *  confirmation requests can't orphan each other. */
export interface PendingToolUse {
  toolUseId: string;
  actionId: string; // e.g. "workspace_sprint_create" (Claude name)
  resolvedActionId: string; // e.g. "workspace.sprint.create" (registry id)
  input: Record<string, unknown>;
  summary: string;
  /** Called by the confirm dialog. Approves or denies the tool execution. */
  resolve: (approved: boolean) => void;
}
