/**
 * Visitor AI (Amr for signed-out visitors): the contract between the browser and
 * POST /api/agent/visitor. Both sides import from here, so header names, error
 * codes and client-side limits can't drift apart. No server-only or browser-only
 * imports: safe in either bundle.
 *
 * The server owns the model, the system prompt, max_tokens, reasoning effort and
 * the quotas (the visitor_ai_config row in Supabase). The browser sends only the
 * conversation, the tools it offers this turn, and the page's tool id.
 */

/** The route. */
export const VISITOR_AI_PATH = "/api/agent/visitor";

/** Is visitor AI switched on in this build? (The server has its own kill switch.) */
export function visitorAiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VISITOR_AI === "1";
}

/** Limits the browser keeps so the server never has to refuse (the server checks again). */
export const VISITOR_LIMITS = {
  /** Tools offered in one request. */
  maxTools: 24,
  /** Tool rounds after one visitor message. */
  maxToolRounds: 5,
  /** A tool result is cut to this many characters before it is sent. */
  toolResultChars: 6000,
  /** Messages sent per request (always starting at a visitor message). */
  historyMessages: 16,
  /** One visitor message. */
  userChars: 2000,
  /** One assistant message's text (a longer reply is cut before it is sent back). */
  assistantChars: 8000,
  /** Tool calls in one assistant message. */
  toolCallsPerMessage: 8,
  /** One tool call's arguments (a JSON string). */
  argumentsChars: 8000,
  /** All the message text in one request: user, assistant, tool results and arguments. */
  totalChars: 48_000,
} as const;

/** One message on the wire (OpenAI chat format). */
export type VisitorWireMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** One tool on the wire (OpenAI function tool). */
export interface VisitorWireTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

/** The request body. Anything else is dropped by the server. */
export interface VisitorRequestBody {
  messages: VisitorWireMessage[];
  tools?: VisitorWireTool[];
  context?: { toolId?: string };
}

/** Response headers on a streamed answer (and on 429s, where they apply). */
export const VISITOR_HEADERS = {
  /** Messages left today for this visitor. */
  remaining: "x-visitor-ai-remaining",
  /** This visitor's daily message limit. */
  limit: "x-visitor-ai-limit",
  /** "1" while Z.AI's peak window is on, else "0". */
  peak: "x-visitor-ai-peak",
  /** Messages left in this peak window (only while peak = "1"). */
  peakRemaining: "x-visitor-ai-peak-remaining",
  /** This visitor's limit for one peak window. */
  peakLimit: "x-visitor-ai-peak-limit",
  /** When the current peak window ends, ISO 8601 (only while peak = "1"). */
  peakEnds: "x-visitor-ai-peak-ends",
} as const;

/** Error codes, in the JSON body `{ error: code }` of a refusal. */
export type VisitorErrorCode =
  /** 503: visitor AI is switched off (env or the config row). */
  | "disabled"
  /** 403: not from this site. */
  | "forbidden"
  /** 429: too many requests in a burst. */
  | "slow_down"
  /** 413: body too big. */
  | "too_large"
  /** 400: malformed or over a size limit. */
  | "bad_request"
  /** 400: more than VISITOR_LIMITS.maxToolRounds tool rounds after one message. */
  | "round_limit"
  /** 503: the meter couldn't be reached; the server refuses rather than run unmetered. */
  | "meter_unavailable"
  /** 429: this visitor's daily messages are used up. */
  | "visitor_limit"
  /** 429: this visitor's messages for the current peak window are used up. */
  | "visitor_peak_limit"
  /** 429: the site's daily messages are used up. */
  | "site_limit"
  /** 429: the site's messages for the current peak window are used up. */
  | "site_peak_limit"
  /** 429: the model-call caps (per visitor, per day, or per 5 hours) are reached. */
  | "site_busy"
  /** 503: the AI service is busy or down (its 429 / 5xx); try again later. */
  | "upstream_busy"
  /** 502: the AI service answered with an error. */
  | "upstream_error"
  /** 504: the AI service didn't start answering in time. */
  | "timeout";

/** Refusals that mean "no more AI today/now": the panel falls back to the offline guide. */
export const VISITOR_FALLBACK_CODES: ReadonlySet<VisitorErrorCode> = new Set<VisitorErrorCode>([
  "disabled",
  "meter_unavailable",
  "visitor_limit",
  "visitor_peak_limit",
  "site_limit",
  "site_peak_limit",
  "site_busy",
]);
