/**
 * Which button a chat notice offers, by its kind (see ChatNoticeKind in
 * client.ts). Both chats draw it in the notice's narration caption.
 *
 *  - "go_on": the answer stopped short ("cut_off"), or the owner's turn used
 *    every tool round ("round_limit": "Send a follow-up and he'll carry on").
 *    It sends a real "Go on" message (client goOn).
 *  - "retry": a failure the same question may get past a moment later: a
 *    round with no answer, a broken stream, a busy or failing AI service, a
 *    timeout, a refused request, the server out of reach, too many messages
 *    at once. The chat still offers it only when the last turn ran no change
 *    (canRetryLastTurn), so trying again never repeats one.
 *  - null: nothing to press. Asking the same thing again won't help (a chat
 *    too long, signed out, a key refused, a limit reached, an action that
 *    keeps failing, something Amr can't do here), or the notice is plain.
 *
 * A visitor's "round_limit" offers nothing. It comes only from the chat being
 * over the visitor route's limits (the client's own check, or the route's
 * refusal), which a "Go on" would only add to, and each message costs one of
 * the day's allowance; its own words ask for smaller pieces. A visitor's turn
 * that used every tool round says so in its stand-in reply, with no notice.
 *
 * No runtime imports, so the visitor's chat chunk can use it without the agent
 * runtime (which loads on the first message).
 */

import type { AgentNotice, ChatProfile } from "./store";

/** The button a notice offers. */
export type NoticeAction = "retry" | "go_on";

/** Failures where the same question may work on a second try. */
const RETRY_KINDS: ReadonlySet<string> = new Set([
  "no_answer",
  "stream_failed",
  "upstream_busy",
  "upstream_error",
  "timeout",
  "request_failed",
  "unreachable",
  "slow_down",
]);

/** The button this notice offers in this profile's chat, or null for none. */
export function noticeAction(
  notice: AgentNotice | null,
  profile: ChatProfile
): NoticeAction | null {
  if (!notice) return null;
  if (notice.kind === "cut_off") return "go_on";
  if (notice.kind === "round_limit") return profile === "owner" ? "go_on" : null;
  return RETRY_KINDS.has(notice.kind) ? "retry" : null;
}
