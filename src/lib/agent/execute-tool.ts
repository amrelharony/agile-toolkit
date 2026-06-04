import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import type { ToolResultBlock, ToolUseBlock } from "./types";

interface ExecuteOptions {
  userId: string;
  /** Resolves true to proceed with a write/intent action, false to deny. */
  confirm: (summary: string) => Promise<boolean>;
  /** When true, skip confirm() for write/intent actions. Read still no-prompt. */
  autoApprove: boolean;
  /** Turn abort signal — closing the panel cancels an in-flight handler so the
   *  loop doesn't stay parked (and `streaming`) for up to the 30s timeout. */
  signal?: AbortSignal;
}

/**
 * A promise that rejects when `signal` aborts OR after `timeoutMs`, plus a
 * `cleanup` to call once the race settles. Without the cleanup, the timeout
 * timer keeps running (and fires) up to `timeoutMs` after the handler already
 * returned, and the abort listener stays attached — every tool call would leak
 * a dangling timer + listener across a multi-tool turn.
 */
function raceGuards(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { promise: Promise<never>; cleanup: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs);
    if (!signal) return;
    if (signal.aborted) return reject(new Error("cancelled"));
    onAbort = () => reject(new Error("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  };
  return { promise, cleanup };
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
// Hard cap on the size of a tool-use input. Real action params are
// always under a few KB; anything larger is a misbehaving / malicious
// model trying to exhaust memory or stall Zod validation. Same shape
// as the MCP body cap (1 MiB).
const MAX_INPUT_BYTES = 1_048_576;

export async function executeToolUse(
  block: ToolUseBlock,
  opts: ExecuteOptions
): Promise<ToolResultBlock> {
  // The turn was aborted (panel closed) before we got to this tool — answer it
  // with an error result rather than running it, so the tool_call isn't left
  // orphaned in the transcript.
  if (opts.signal?.aborted) {
    return { type: "tool_result", tool_use_id: block.id, content: "Cancelled.", is_error: true };
  }
  const action = registry.resolve(block.name);
  if (!action) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Unknown tool: ${block.name}`,
      is_error: true,
    };
  }

  // Reject oversized inputs BEFORE schema validation — Zod walking a
  // 10 MB nested object is slow enough to look like a hang.
  try {
    const approx = JSON.stringify(block.input ?? {});
    if (approx.length > MAX_INPUT_BYTES) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `Input too large (${approx.length} bytes > ${MAX_INPUT_BYTES}).`,
        is_error: true,
      };
    }
  } catch {
    // JSON.stringify can throw on circular refs in `input` itself
    // (would arrive only via in-process injection, never from the wire).
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: "Input is not JSON-serialisable.",
      is_error: true,
    };
  }

  // Validate input — the model occasionally drifts from the schema.
  const parsed = (
    action.paramsSchema as {
      safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
    }
  ).safeParse(block.input);
  if (!parsed.success) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Invalid input for ${action.id}: ${parsed.error?.message ?? "schema violation"}`,
      is_error: true,
    };
  }

  // Confirmation gate for write / intent.
  const needsConfirm = action.requiresConfirmation ?? action.category !== "read";
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

  const ctx = makeContext(opts.userId, "agent");
  // Race the handler against a 30 s timeout and the abort signal. Without the
  // timeout a hung/looping handler would wedge the whole agent turn (the
  // streaming loop awaits this result); abort wins if the user closes the panel
  // mid-handler so the loop unwinds immediately. guards.cleanup tears down the
  // timer + listener once the race settles.
  const HANDLER_TIMEOUT_MS = 30_000;
  const guards = raceGuards(opts.signal, HANDLER_TIMEOUT_MS);
  try {
    const result = await Promise.race([action.handler(parsed.data, ctx), guards.promise]);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      // JSON.stringify returns `undefined` (not a string) for a void/undefined
      // handler result; coerce to "null" so the tool_result content is always a
      // string — an undefined content drops the field and yields an invalid
      // block in the next API turn. (Mirrors the MCP transport's coercion.)
      content: JSON.stringify(result) ?? "null",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Handler error: ${msg}`,
      is_error: true,
    };
  } finally {
    guards.cleanup();
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
