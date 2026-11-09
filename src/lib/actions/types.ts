import type { z } from "zod";
import type { ActionContext } from "./context";

/**
 * A `ToolAction` is the atomic unit the agent runtime and MCP server
 * speak. Every callable verb in the toolkit — from `workspace.sprint.create`
 * to `tool.canvas.add_sticky` — is one of these.
 *
 * The handler MUST be pure-ish: it can read/write Zustand stores and
 * call other actions, but it should not depend on React render state or
 * mounted components. Action modules are imported by the server-side
 * agent and MCP route handlers; anything that needs the DOM should go
 * through the imperative-handle registry, not through the action
 * directly.
 */
export type ActionCategory = "read" | "write" | "intent";

export interface ToolAction<P = unknown, R = unknown> {
  /** Full id `${toolId}.${name}` — used by both Anthropic tool-use and MCP. */
  id: string;
  /** Tool group: `workspace`, `tool.canvas`, `intent`, etc. */
  toolId: string;
  /** Short verb: `create`, `move`, `cast_vote`. */
  name: string;
  category: ActionCategory;
  /** One-line description shown to the agent. */
  description: string;
  /** Longer guidance (multi-line). Optional. */
  longDescription?: string;
  paramsSchema: z.ZodType<P>;
  resultSchema?: z.ZodType<R>;
  /** When true, the in-app agent UI prompts for confirmation before
   *  executing. `write` and `intent` default to true; `read` to false. */
  requiresConfirmation?: boolean;
  /**
   * Whether Amr may offer this action to a signed-out visitor's chat
   * (visitor AI). Defaults to true: an action runs in the visitor's own tab on
   * their own browser data, and every non-read one asks first. Set false for
   * actions with effects beyond that tab, such as the canvas actions, which
   * broadcast to the people in a live room.
   */
  visitor?: boolean;
  handler: (params: P, ctx: ActionContext) => Promise<R>;
  /**
   * Optional server-only handler used when `ctx.source === "mcp"`. MCP
   * requests run server-side where the browser Zustand workspace store
   * is a fresh empty singleton — actions that read or write workspace
   * data via `useWorkspaceStore.getState()` would silently no-op for
   * the real user. The mcpHandler reads/writes Supabase directly via
   * `src/lib/actions/server-store.ts` using `ctx.userId` (resolved
   * from the PAT bearer). Omit to fall back to `handler`.
   */
  mcpHandler?: (params: P, ctx: ActionContext) => Promise<R>;
}

/** Untyped variant used by the registry's internal storage. */
export type AnyToolAction = ToolAction<unknown, unknown>;
