/**
 * What POST /api/agent/visitor accepts from the browser.
 *
 * The body is rebuilt from whitelisted fields only, never forwarded as sent:
 * system and developer messages are dropped (the server writes the only system
 * prompt), so are unknown roles' keys and every field the contract doesn't
 * name (a model, max_tokens, reasoning settings, extra tool keys). Everything
 * is size-capped, so one visitor can't make a request expensive.
 *
 * Two answers on failure: "bad_request" for anything malformed or over a
 * limit, and "round_limit" when the model has already had its
 * VISITOR_LIMITS.maxToolRounds tool rounds since the visitor's last message.
 */

import "server-only";
import { getToolById } from "@/lib/constants/tools";
import { isVipHidden } from "@/lib/tools/catalog";
import { VISITOR_LIMITS, type VisitorWireMessage, type VisitorWireTool } from "./contract";

/**
 * Every limit the browser also keeps is VISITOR_LIMITS' own value, so raising
 * one in the contract raises it on both sides at once. The rest are the
 * server's alone.
 */
export const REQUEST_LIMITS = {
  /**
   * Messages kept after system/developer ones are dropped. Deliberately more
   * than VISITOR_LIMITS.historyMessages (16), which the browser trims to: a
   * little slack, so a browser a release behind is never refused for it.
   */
  messages: 24,
  /** One visitor message. */
  userChars: VISITOR_LIMITS.userChars,
  /** One assistant message's text. */
  assistantChars: VISITOR_LIMITS.assistantChars,
  /** Tool calls in one assistant message. */
  toolCallsPerMessage: VISITOR_LIMITS.toolCallsPerMessage,
  /** One tool call's arguments (a JSON string). */
  argumentsChars: VISITOR_LIMITS.argumentsChars,
  /** One tool result. */
  toolResultChars: VISITOR_LIMITS.toolResultChars,
  /** All the text above, summed over the conversation. */
  totalChars: VISITOR_LIMITS.totalChars,
  /** Tools offered in one request. */
  tools: VISITOR_LIMITS.maxTools,
  /** A tool's description; a longer one is cut, not refused. */
  toolDescriptionChars: 1_024,
  /**
   * How deeply a tool's `parameters` schema may nest (objects and arrays).
   * The registry's deepest is far below it; a deeper one is refused here,
   * before anything walks it recursively.
   */
  toolSchemaDepth: 32,
  /** The tools as JSON. Past it, the last-offered tools are left out (never one the history calls). */
  toolsJsonBytes: 48 * 1024,
  /** Model rounds that called tools since the visitor's last message. */
  toolRounds: VISITOR_LIMITS.maxToolRounds,
} as const;

/**
 * An action's OpenAI tool name: its registry id with dots as underscores
 * (`claudeNameFromId` in lib/actions/registry.ts), so `tool.retro.add_card`
 * is `tool_retro_add_card`. Every registered action is a `tool.`,
 * `workspace.` or `intent.` id in lower snake case (test/agent/
 * visitor-request.test.ts checks the real registry against this).
 */
export const VISITOR_TOOL_NAME = /^(tool|workspace|intent)_[a-z0-9_]{1,120}$/;

/** A tool-call id as the model hands it out: printable ASCII, no spaces. */
const TOOL_CALL_ID = /^[\x21-\x7e]{1,128}$/;

export interface ParsedVisitorBody {
  /** The conversation to forward, after the server's own system prompt. */
  messages: VisitorWireMessage[];
  /** The tools to offer (possibly none). */
  tools: VisitorWireTool[];
  /** The page's tool, when it is a known tool every visitor can open; else null. */
  toolId: string | null;
  /** The visitor's latest message, for picking related tools. */
  lastUserText: string;
  /** The request starts with a new visitor message (a turn), not a tool round. */
  newTurn: boolean;
}

export type VisitorBodyResult =
  | { ok: true; body: ParsedVisitorBody }
  | { ok: false; error: "bad_request" | "round_limit" };

const BAD: VisitorBodyResult = { ok: false, error: "bad_request" };

/** Thrown inside the parser for "malformed", caught at the top. */
class Malformed extends Error {}

function fail(): never {
  throw new Malformed();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function text(v: unknown, max: number): string {
  if (typeof v !== "string" || v.length > max) fail();
  return v;
}

type ToolCall = NonNullable<
  Extract<VisitorWireMessage, { role: "assistant" }>["tool_calls"]
>[number];

function parseToolCall(raw: unknown): ToolCall {
  if (!isRecord(raw) || raw.type !== "function" || !isRecord(raw.function)) fail();
  const id = text(raw.id, 128);
  if (!TOOL_CALL_ID.test(id)) fail();
  const name = text(raw.function.name, 128);
  if (!VISITOR_TOOL_NAME.test(name)) fail();
  const args = text(raw.function.arguments, REQUEST_LIMITS.argumentsChars);
  return { id, type: "function", function: { name, arguments: args } };
}

/** One message rebuilt from its allowed fields; null for a system/developer one (dropped). */
function parseMessage(raw: unknown): VisitorWireMessage | null {
  if (!isRecord(raw)) fail();
  switch (raw.role) {
    case "system":
    case "developer":
      return null;
    case "user": {
      const content = text(raw.content, REQUEST_LIMITS.userChars);
      if (!content.trim()) fail();
      return { role: "user", content };
    }
    case "assistant": {
      const content =
        raw.content === null || raw.content === undefined
          ? null
          : text(raw.content, REQUEST_LIMITS.assistantChars);
      let calls: ToolCall[] = [];
      if (raw.tool_calls !== undefined && raw.tool_calls !== null) {
        if (!Array.isArray(raw.tool_calls)) fail();
        if (raw.tool_calls.length > REQUEST_LIMITS.toolCallsPerMessage) fail();
        calls = raw.tool_calls.map(parseToolCall);
        if (new Set(calls.map((c) => c.id)).size !== calls.length) fail();
      }
      if (calls.length === 0) return { role: "assistant", content: content ?? "" };
      return { role: "assistant", content: content || null, tool_calls: calls };
    }
    case "tool": {
      const id = text(raw.tool_call_id, 128);
      if (!TOOL_CALL_ID.test(id)) fail();
      return {
        role: "tool",
        tool_call_id: id,
        content: text(raw.content, REQUEST_LIMITS.toolResultChars),
      };
    }
    default:
      return fail();
  }
}

/**
 * Whether a JSON value nests no deeper than `max` objects and arrays. A loop
 * with its own stack, not recursion: the value comes from the visitor, and a
 * 95,000-deep array fits in the body cap (JSON.parse takes it, but
 * JSON.stringify and any recursive walk overflow the call stack on it).
 */
function nestsWithin(value: unknown, max: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop() as [unknown, number];
    if (v === null || typeof v !== "object") continue;
    if (depth > max) return false;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
  }
  return true;
}

function parseTool(raw: unknown): VisitorWireTool {
  if (!isRecord(raw) || raw.type !== "function" || !isRecord(raw.function)) fail();
  const name = text(raw.function.name, 128);
  if (!VISITOR_TOOL_NAME.test(name)) fail();
  const fn: VisitorWireTool["function"] = { name };
  const description = raw.function.description;
  if (description !== undefined && description !== null) {
    if (typeof description !== "string") fail();
    fn.description = description.slice(0, REQUEST_LIMITS.toolDescriptionChars);
  }
  const parameters = raw.function.parameters;
  if (parameters !== undefined && parameters !== null) {
    if (!isRecord(parameters)) fail();
    if (!nestsWithin(parameters, REQUEST_LIMITS.toolSchemaDepth)) fail();
    fn.parameters = parameters;
  }
  return { type: "function", function: fn };
}

const encoder = new TextEncoder();
const jsonBytes = (v: unknown) => encoder.encode(JSON.stringify(v)).length;

/**
 * Keep the tools within REQUEST_LIMITS.toolsJsonBytes. The browser offers
 * them best first, so the later ones are left out first; a tool the history
 * calls is always kept (the model API refuses a history that calls a function
 * missing from `tools`). Over the limit with those alone ⇒ malformed.
 */
function fitTools(tools: VisitorWireTool[], required: ReadonlySet<string>): VisitorWireTool[] {
  const sizes = tools.map(jsonBytes);
  let total = 0;
  tools.forEach((t, i) => {
    if (required.has(t.function.name)) total += sizes[i];
  });
  if (total > REQUEST_LIMITS.toolsJsonBytes) fail();
  return tools.filter((t, i) => {
    if (required.has(t.function.name)) return true;
    if (total + sizes[i] > REQUEST_LIMITS.toolsJsonBytes) return false;
    total += sizes[i];
    return true;
  });
}

/** The page's tool id, kept only when it names a tool every visitor can open. */
function parseToolId(context: unknown): string | null {
  if (!isRecord(context) || typeof context.toolId !== "string") return null;
  if (context.toolId.length > 200) return null;
  const tool = getToolById(context.toolId);
  if (!tool || isVipHidden(tool, false)) return null;
  return tool.id;
}

function parse(raw: unknown): VisitorBodyResult {
  if (!isRecord(raw) || !Array.isArray(raw.messages)) fail();

  const messages: VisitorWireMessage[] = [];
  for (const m of raw.messages) {
    const parsed = parseMessage(m);
    if (parsed) messages.push(parsed);
    if (messages.length > REQUEST_LIMITS.messages) fail();
  }
  if (messages.length === 0) fail();

  const last = messages[messages.length - 1];
  if (last.role !== "user" && last.role !== "tool") fail();

  // Every tool result answers a call of the assistant message just before its
  // run of results, each call is answered once, and every call is answered
  // before the conversation moves on (the model API refuses anything else).
  let pending = new Set<string>();
  let totalChars = 0;
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === "tool") {
      if (!pending.delete(m.tool_call_id)) fail();
      totalChars += m.content.length;
      return;
    }
    if (pending.size > 0) fail();
    if (m.role === "user") {
      lastUser = i;
      totalChars += m.content.length;
      return;
    }
    totalChars += m.content?.length ?? 0;
    for (const c of m.tool_calls ?? []) totalChars += c.function.arguments.length;
    pending = new Set((m.tool_calls ?? []).map((c) => c.id));
  });
  if (pending.size > 0) fail();
  if (totalChars > REQUEST_LIMITS.totalChars) fail();
  if (lastUser < 0) fail();

  // Tools: a known shape, unique names, and every function the history calls.
  let tools: VisitorWireTool[] = [];
  if (raw.tools !== undefined && raw.tools !== null) {
    if (!Array.isArray(raw.tools) || raw.tools.length > REQUEST_LIMITS.tools) fail();
    tools = raw.tools.map(parseTool);
  }
  const offered = new Set(tools.map((t) => t.function.name));
  if (offered.size !== tools.length) fail();
  const called = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.tool_calls ?? []) {
      if (!offered.has(c.function.name)) fail();
      called.add(c.function.name);
    }
  }
  tools = fitTools(tools, called);

  const rounds = messages
    .slice(lastUser + 1)
    .filter((m) => m.role === "assistant" && (m.tool_calls?.length ?? 0) > 0).length;
  if (rounds > REQUEST_LIMITS.toolRounds) return { ok: false, error: "round_limit" };

  return {
    ok: true,
    body: {
      messages,
      tools,
      toolId: parseToolId(raw.context),
      lastUserText: (messages[lastUser] as { content: string }).content,
      newTurn: last.role === "user",
    },
  };
}

/**
 * Rebuild and check a visitor request body (already JSON-parsed). Never
 * throws for anything the visitor sent: a RangeError (a value too deep or too
 * big for JSON.stringify, should one get past the checks above) is a bad
 * request too, so the route still answers `{ error: "bad_request" }`, not 500.
 */
export function parseVisitorBody(raw: unknown): VisitorBodyResult {
  try {
    return parse(raw);
  } catch (err) {
    if (err instanceof Malformed || err instanceof RangeError) return BAD;
    throw err;
  }
}
