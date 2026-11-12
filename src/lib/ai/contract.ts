/**
 * The contract between the tools' Ask Amr buttons and the two tool AI routes:
 * the paths, the request and answer bodies, the error codes and what each one
 * tells the person. Both sides import it. No server or browser APIs.
 *
 *   POST /api/ai/tool          the signed-in owner (the middleware and the
 *                              handler both check the session)
 *   POST /api/ai/tool/visitor  signed-out visitors, metered like Amr's chat
 *
 * The body is `{ task, input }`: the task's id and its input. The browser
 * never sends a prompt; the server builds it from the task's server half.
 */

import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import type { AiFallbackReason, AiSource } from "./task-types";

export const TOOL_AI_OWNER_PATH = "/api/ai/tool";
export const TOOL_AI_VISITOR_PATH = "/api/ai/tool/visitor";

/** Body caps: the owner's free-form prompt can be long, a visitor's task input can't. */
export const TOOL_AI_OWNER_MAX_BODY_BYTES = 256 * 1024;
export const TOOL_AI_VISITOR_MAX_BODY_BYTES = 64 * 1024;

/**
 * How long one request may run inside the route (maxDuration is 300 s). Past
 * it the repair call is skipped and the upstream call is aborted.
 */
export const TOOL_AI_DEADLINE_MS = 240_000;

/** The request body. */
export interface ToolAiRequest {
  task: string;
  input: unknown;
}

/** A JSON task's answer (status 200). */
export interface ToolAiAnswer<O = unknown> {
  ok: true;
  data: O;
  source: AiSource;
  /** Why the fallback stood in, when source is "fallback". */
  reason?: AiFallbackReason;
}

/** Every error code a tool AI route answers with, in `{ error: code }`. */
export type ToolAiErrorCode =
  | VisitorErrorCode
  /** 401: the owner route without a session. */
  | "unauthenticated"
  /** 403: signed in, but not the owner. */
  | "not_authorized"
  /** 400: no task by that id. */
  | "unknown_task"
  /** 400: the visitor route refuses an owner-only task (and prompt.run). */
  | "owner_only"
  /** 400: the input doesn't fit the task's schema. */
  | "bad_input"
  /** 429: the owner's tool AI limit (check_tool_ai_rate_limit) is reached. */
  | "rate_limited"
  /** 503: no AI backend is set up on the server. */
  | "no_backend"
  /** Browser side only: the request never got an answer. */
  | "network"
  /** Browser side only: the answer wasn't readable. */
  | "bad_answer";

/** What each code tells the person: plain words, and the tool still works. */
export const TOOL_AI_ERROR_TEXT: Record<ToolAiErrorCode, string> = {
  disabled: "Amr's AI is switched off right now. The tool still works without AI.",
  forbidden: "Amr's AI only answers this site's own pages.",
  slow_down: "That was a lot of AI requests at once. Wait a minute and try again.",
  too_large: "That's too much for Amr in one go. Choose less and try again.",
  bad_request: "Amr couldn't read that request. Try again.",
  round_limit: "Amr couldn't read that request. Try again.",
  meter_unavailable:
    "Amr can't check today's AI count right now, so his AI is paused. The tool still works without AI.",
  visitor_limit: "Amr has used today's AI answers. The tool still works without AI.",
  visitor_peak_limit:
    "Amr has used his AI answers for these busy hours. The tool still works without AI.",
  site_limit: "Amr's AI is resting for today. The tool still works without AI.",
  site_peak_limit: "Amr's AI is resting until the busy hours end. The tool still works without AI.",
  site_busy: "Amr's AI is very busy right now. Try again later; the tool still works without AI.",
  upstream_busy: "Amr's AI service is busy. Try again in a moment.",
  upstream_error: "Amr's AI service answered with an error. Try again in a moment.",
  timeout: "Amr's AI service took too long to answer. Try again in a moment.",
  unauthenticated: "Sign in again to use Amr's AI.",
  not_authorized: "Only the owner's account can use this.",
  unknown_task: "This tool's AI isn't available on the server yet.",
  owner_only: "Only the owner can use this AI feature.",
  bad_input: "That's too long or incomplete for Amr. Check it and try again.",
  rate_limited: "You've reached the AI limit for now. The tool still works without AI.",
  no_backend: "No AI service is set up on the server. Add your own key in AI settings instead.",
  network: "Couldn't reach the site. Check your connection and try again.",
  bad_answer: "Amr's answer didn't come through properly. Try again.",
};

/** The plain-words text for any code, known or not. */
export function toolAiErrorText(code: string): string {
  return (
    (TOOL_AI_ERROR_TEXT as Record<string, string>)[code] ??
    "Amr's AI didn't answer this time. The tool still works without AI."
  );
}
