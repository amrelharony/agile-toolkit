/**
 * What a tool call came to, in plain words, worked out when the chat draws it.
 *
 * A result is the tool_result block execute-tool.ts sends back to the model:
 * the handler's JSON, or one of its fixed error strings. classifyResult reads
 * those strings (they are written for the model, with ids in them) and gives
 * the chat one plain state to show instead: done, denied, failed,
 * unavailable, stopped or timeout. Nothing new is stored, so saved threads
 * read the same. test/agent/tool-result-text.test.ts runs execute-tool itself,
 * so a change to one of its strings fails here rather than in the chat.
 *
 * Pure, with no registry import, so the visitor chat may use it
 * (test/agent/bundle-boundary.test.ts).
 */

import type { ChatMessage, ToolResultBlock, ToolUseBlock } from "./types";

/** What a finished call came to. */
export type ToolResultStatus = "done" | "denied" | "failed" | "unavailable" | "stopped" | "timeout";

/** Where a call stands: still on its way, or finished. */
export type ToolStepState = "preparing" | "waiting" | "working" | ToolResultStatus;

/** Each state in words, never in the first person: the chat shows these, never the result string. */
export const STEP_WORDS: Readonly<Record<ToolStepState, string>> = {
  preparing: "Getting ready…",
  waiting: "Waiting for you",
  working: "Working…",
  done: "Done",
  denied: "You said no",
  failed: "Didn't work",
  unavailable: "Not available here",
  stopped: "Stopped",
  timeout: "Took too long",
};

/** States that mean something went wrong (shown in words, with the danger colour only as a second cue). */
export const TROUBLE_STATES: ReadonlySet<ToolStepState> = new Set<ToolStepState>([
  "failed",
  "unavailable",
  "timeout",
]);

/**
 * Flags a handler sets to false when it changed nothing it was asked to
 * (`{ added: false, reason: "no_retro" }`). `found`, `exists` and `changed`
 * are left out: a read that finds nothing, or a change already in place, did
 * its job.
 */
const FAILURE_FLAGS = [
  "ok",
  "success",
  "added",
  "archived",
  "created",
  "deleted",
  "derived",
  "logged",
  "moved",
  "persisted",
  "posted",
  "promoted",
  "raised",
  "recorded",
  "refunded",
  "removed",
  "retired",
  "saved",
  "sent",
  "set",
  "shipped",
  "started",
  "taken",
  "updated",
] as const;

/** Fields that name a thing plainly, in the order they are tried. */
const NAME_FIELDS = ["title", "name", "text", "label"] as const;

/** The longest summary shown, in characters. */
const SUMMARY_MAX = 60;

/** A result's text, whichever shape its content has. */
export function resultText(result: Pick<ToolResultBlock, "content">): string {
  const { content } = result;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block.text === "string" ? block.text : ""))
    .join("");
}

/** A plain object parsed from JSON text, or null. */
function parseObject(text: string): Record<string, unknown> | null {
  const start = text.trimStart();
  if (!start.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(start);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The handler's JSON says it changed nothing: an `error`, or a flag such as `added: false`. */
function saysItFailed(value: Record<string, unknown> | null): boolean {
  if (!value) return false;
  const { error } = value;
  if (error === true || (typeof error === "string" && error.trim() !== "")) return true;
  return FAILURE_FLAGS.some((flag) => value[flag] === false);
}

/** execute-tool.ts's own strings, matched whether or not is_error survived a reload; null for anything else. */
function fixedStatus(text: string): ToolResultStatus | null {
  if (text.startsWith("User denied execution of")) return "denied";
  if (text.startsWith("Unknown tool") || text.startsWith("Tool not available"))
    return "unavailable";
  if (text === "Cancelled." || /^Handler error: cancelled$/i.test(text)) return "stopped";
  if (text.startsWith("Handler timeout") || text.startsWith("Handler error: Handler timeout")) {
    return "timeout";
  }
  if (
    text.startsWith("Invalid input for") ||
    text.startsWith("Handler error") ||
    text.startsWith("Input too large") ||
    text.startsWith("Input is not JSON")
  ) {
    return "failed";
  }
  return null;
}

/** What one result block comes to: its state and the plain name its JSON gives, if any. */
interface ResultReading {
  status: ToolResultStatus;
  summary: string | null;
}

/**
 * Each block's reading, worked out once. The chat redraws every row on each
 * streamed flush and each keystroke, and an owner's result can be tens of KB
 * of JSON; the store keeps a block's identity until the block changes, so the
 * block is the key and its JSON is parsed at most once.
 */
const readings = new WeakMap<object, ResultReading>();

function readResult(result: Pick<ToolResultBlock, "content" | "is_error">): ResultReading {
  const known = readings.get(result);
  if (known) return known;
  const text = resultText(result).trim();
  const fixed = fixedStatus(text);
  // Only a result that isn't one of execute-tool's strings is the handler's JSON.
  const object = fixed ? null : parseObject(text);
  const reading: ResultReading = {
    status: fixed ?? (result.is_error || saysItFailed(object) ? "failed" : "done"),
    summary: plainSummary(object),
  };
  readings.set(result, reading);
  return reading;
}

/** What a finished call came to, read from its tool_result block. */
export function classifyResult(
  result: Pick<ToolResultBlock, "content" | "is_error">
): ToolResultStatus {
  return readResult(result).status;
}

/** A value's first plain name field (title, name, text, label), cut short; null when it has none. */
export function plainSummary(value: unknown): string | null {
  const object =
    typeof value === "string"
      ? parseObject(value)
      : value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
  if (!object) return null;
  for (const field of NAME_FIELDS) {
    const raw = object[field];
    if (typeof raw !== "string") continue;
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (text.length <= SUMMARY_MAX) return text;
    const cut = text.slice(0, SUMMARY_MAX - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return null;
}

/** A result's plain name for what it made or read ("flaky CI"), when its JSON has an obvious one. */
export function resultSummary(result: Pick<ToolResultBlock, "content">): string | null {
  return readResult(result).summary;
}

/** The streaming parser's placeholder for arguments not yet (or never) parsed (as client.ts reads it). */
export function isPartialInput(input: ToolUseBlock["input"] | null | undefined): boolean {
  return (
    !!input && typeof input === "object" && "_partial" in input && Object.keys(input).length === 1
  );
}

/**
 * The short plain words a step row adds after its state: the result's own
 * name for what it touched when it is done, else the name in the call's
 * arguments ("flaky CI"). Null when neither has one; never JSON.
 */
export function stepSummary(
  call: Pick<ToolUseBlock, "input">,
  result: Pick<ToolResultBlock, "content" | "is_error"> | undefined
): string | null {
  if (result) {
    const { status, summary } = readResult(result);
    if (status === "done" && summary) return summary;
  }
  // A saved thread may carry `{_truncated: "…"}` in place of the arguments.
  if (isPartialInput(call.input) || "_truncated" in (call.input ?? {})) return null;
  return plainSummary(call.input);
}

/** Which result answers which call, across a chat's messages. */
export interface ToolResultPairs {
  /** The result that answers this call of this assistant message, if one has come. */
  resultOf(messageId: string, toolUseId: string): ToolResultBlock | undefined;
  /** This result (by its tool message and block index) answers a call shown in the chat. */
  answersACall(messageId: string, index: number): boolean;
  /** The id of the chat's last assistant message: the only one whose calls can still be running. */
  latestAssistantId: string | null;
}

const pairKey = (messageId: string, part: string) => `${messageId}\u0000${part}`;

/**
 * Pair each tool result with the call it answers. A tool message answers the
 * calls of the assistant message before it, never an earlier one: a gateway
 * that sends no call ids gets `tc_0` every round, so an id alone can match
 * the wrong round (client.ts canRetryLastTurn pairs the same way).
 */
export function pairToolResults(messages: readonly ChatMessage[]): ToolResultPairs {
  const byCall = new Map<string, ToolResultBlock>();
  const answered = new Set<string>();
  let latestAssistantId: string | null = null;
  /** The latest assistant message's unanswered calls: tool_use id → message id. */
  let open = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      latestAssistantId = message.id;
      open = new Map();
      for (const block of message.content) {
        if (block.type === "tool_use") open.set(block.id, message.id);
      }
      continue;
    }
    if (message.role !== "tool") continue;
    message.content.forEach((block, index) => {
      if (block.type !== "tool_result") return;
      const owner = open.get(block.tool_use_id);
      if (owner === undefined) return;
      byCall.set(pairKey(owner, block.tool_use_id), block);
      answered.add(pairKey(message.id, String(index)));
      open.delete(block.tool_use_id);
    });
  }
  return {
    resultOf: (messageId, toolUseId) => byCall.get(pairKey(messageId, toolUseId)),
    answersACall: (messageId, index) => answered.has(pairKey(messageId, String(index))),
    latestAssistantId,
  };
}

/**
 * Where one call stands. A result decides it. Without one: waiting while its
 * confirm card shows; getting ready while its arguments still stream, and
 * working once they are in, but only in the latest reply of a turn still
 * under way. Arguments that never parsed in a finished turn never ran
 * (client.ts never runs a `_partial` call), so that reads "didn't work".
 * Null when nothing is known: a call left without a result after its turn.
 */
export function stepState(
  call: Pick<ToolUseBlock, "id" | "input">,
  result: Pick<ToolResultBlock, "content" | "is_error"> | undefined,
  opts: { pendingId?: string | null; live?: boolean }
): ToolStepState | null {
  if (result) return classifyResult(result);
  if (opts.pendingId != null && opts.pendingId === call.id) return "waiting";
  const partial = isPartialInput(call.input);
  if (opts.live) return partial ? "preparing" : "working";
  return partial ? "failed" : null;
}
