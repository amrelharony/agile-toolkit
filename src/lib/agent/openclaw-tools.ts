/**
 * OpenClaw prompt-based tool-calling adapter.
 *
 * OpenClaw (chat.amrelharony.com) is OpenAI-compatible for chat, but does NOT
 * emit native `tool_calls`. The model writes the call as Claude-style XML in the
 * message CONTENT and returns finish_reason "stop":
 *
 *   <tool_caller><invoke name="X"><parameter name="k">v</parameter></invoke></tool_caller>
 *
 * and it accepts results fed back as a user turn:
 *
 *   <tool_result name="X">{json}</tool_result>
 *
 * (Verified live against the gateway: a 3-message round-trip — call → result →
 * natural confirmation — works.) This module parses invokes out of streamed text
 * and serialises calls + results back into that format. Pure / no React.
 */

export interface ParsedInvoke {
  name: string;
  input: Record<string, unknown>;
}

// `[\s\S]*?` (not the /s flag) keeps this lazy + multiline without needing ES2018.
const TOOL_CALLER_SRC = "<tool_caller>[\\s\\S]*?<\\/tool_caller>";
const INVOKE_SRC = '<invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)<\\/invoke>';
const PARAM_SRC = '<parameter\\s+name="([^"]+)"\\s*>([\\s\\S]*?)<\\/parameter>';

/** JSON-coerce a parameter value, falling back to the trimmed raw string.
 *  `5` → 5, `true` → true, `["a"]` → array, `Login flow` → "Login flow". */
function coerceValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/**
 * Pull every `<invoke>` out of an assistant message's text and return the prose
 * with the tool XML stripped. Lenient: handles wrapped (`<tool_caller>`) or bare
 * invokes, multiple blocks, and missing parameters.
 */
export function parseOpenClawToolCalls(text: string): {
  visibleText: string;
  invokes: ParsedInvoke[];
} {
  const invokes: ParsedInvoke[] = [];
  const invokeRe = new RegExp(INVOKE_SRC, "g");
  let m: RegExpExecArray | null;
  while ((m = invokeRe.exec(text)) !== null) {
    const name = m[1];
    const inner = m[2];
    const input: Record<string, unknown> = {};
    const paramRe = new RegExp(PARAM_SRC, "g");
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(inner)) !== null) {
      input[pm[1]] = coerceValue(pm[2]);
    }
    invokes.push({ name, input });
  }

  // Strip the wrapper blocks first, then any stray invokes outside a wrapper.
  const visibleText = text
    .replace(new RegExp(TOOL_CALLER_SRC, "g"), "")
    .replace(new RegExp(INVOKE_SRC, "g"), "")
    .trim();

  return { visibleText, invokes };
}

function valueToXml(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Reconstruct the `<tool_caller>` XML for an assistant turn carrying a tool
 *  call — used when wiring the conversation back to OpenClaw on the next turn. */
export function serializeOpenClawToolCall(name: string, input: Record<string, unknown>): string {
  const params = Object.entries(input)
    .map(([k, v]) => `<parameter name="${k}">${valueToXml(v)}</parameter>`)
    .join("\n");
  return `<tool_caller>\n<invoke name="${name}">\n${params}\n</invoke>\n</tool_caller>`;
}

/** Render a tool result as the user-turn `<tool_result>` OpenClaw expects. */
export function serializeOpenClawToolResult(name: string, content: string): string {
  return `<tool_result name="${name}">${content}</tool_result>`;
}
