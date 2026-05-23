import { registry, idFromClaudeName } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import type { ToolResultBlock, ToolUseBlock } from "./types";

interface ExecuteOptions {
  userId: string;
  /** Resolves true to proceed with a write/intent action, false to deny. */
  confirm: (summary: string) => Promise<boolean>;
  /** When true, skip confirm() for write/intent actions. Read still no-prompt. */
  autoApprove: boolean;
}

/**
 * Run a single tool_use block, returning an Anthropic tool_result block
 * to feed back into the next API turn.
 *
 * Action lookup:
 *   - Try the block's exact name first (MCP format with dots).
 *   - Fall back to the dot-decoded form (Anthropic format with underscores).
 *
 * The registry's `id` is the canonical form (`workspace.sprint.create`);
 * Anthropic names munge dots to underscores (`workspace_sprint_create`),
 * so both lookups together cover both transports.
 */
export async function executeToolUse(
  block: ToolUseBlock,
  opts: ExecuteOptions
): Promise<ToolResultBlock> {
  const dotted = block.name.includes(".") ? block.name : idFromClaudeName(block.name);
  const action = registry.get(block.name) ?? registry.get(dotted);
  if (!action) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Unknown tool: ${block.name}`,
      is_error: true,
    };
  }

  // Validate input — the model occasionally drifts from the schema.
  const parsed = (action.paramsSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }).safeParse(block.input);
  if (!parsed.success) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Invalid input for ${action.id}: ${parsed.error?.message ?? "schema violation"}`,
      is_error: true,
    };
  }

  // Confirmation gate for write / intent.
  const needsConfirm = action.requiresConfirmation ?? (action.category !== "read");
  if (needsConfirm && !opts.autoApprove) {
    const summary = describeAction(action.id, parsed.data as Record<string, unknown>);
    const ok = await opts.confirm(summary);
    if (!ok) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `User denied execution of ${action.id}.`,
        is_error: true,
      };
    }
  }

  try {
    const ctx = makeContext(opts.userId, "agent");
    const result = await action.handler(parsed.data, ctx);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Handler error: ${msg}`,
      is_error: true,
    };
  }
}

function describeAction(actionId: string, input: Record<string, unknown>): string {
  // Compact pretty-print of params: 1-line per top-level key. The UI shows
  // the JSON anyway; this is what voice-overs and screen-readers narrate.
  const keys = Object.keys(input);
  if (keys.length === 0) return `Call ${actionId}`;
  const sample = keys
    .slice(0, 3)
    .map((k) => `${k}=${shortValue(input[k])}`)
    .join(", ");
  const tail = keys.length > 3 ? `, +${keys.length - 3} more` : "";
  return `Call ${actionId} with ${sample}${tail}`;
}

function shortValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 37)}…"` : `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).length} keys}`;
  return String(v);
}
