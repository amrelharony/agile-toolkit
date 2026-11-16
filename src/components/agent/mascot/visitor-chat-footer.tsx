"use client";

/**
 * The visitor chat's read-only footer (visitor-agent-panel): what takes the
 * composer's place once no message can go out, so the chat stays readable
 * (its log, Copy reply) instead of the panel swapping it for the tool finder.
 *
 * When: no turn is under way, and either the visitor route refused with a
 * "no more AI for now" code (visitorFallback: a limit reached, Amr too busy
 * or switched off, his message count out of reach), or its last allowance
 * says no message is left, so the visitor can't send one that is sure to be
 * refused.
 *
 *   note         a narration caption, the narrator's line, never Amr's: what
 *                ran out and when Amr can answer again (tomorrow, the end of
 *                the busy hours in the visitor's own time, a few minutes)
 *   Open the tool finder
 *                back to the guide, its search on the question Amr couldn't
 *                answer when one waits (the guide's Ask button then goes back
 *                to this chat, sending nothing)
 *   Try again    only for a refusal a later try may get past (Amr too busy,
 *                his count out of reach), while a message is left and the
 *                last turn ran no change, so trying again repeats none. It
 *                says what it spends, and the box comes back for the turn it
 *                starts. When the last turn did run a change, "Ask again"
 *                gives the box back and sends nothing.
 *
 * Busy hours. Their smaller allowance ends on the clock, as the hours do (the
 * end the route gave): the footer marks the allowance so, lets go of a
 * refusal for them and its notice, and goes, the box back; said once
 * (BUSY_HOURS_OVER) when the chat was waiting on them as they ended. Only a
 * read-only chat waits on that clock, so it is kept here: a chat with
 * messages left drops the busy-hours note on its own minute tick.
 *
 * Focus. The footer takes focus as it replaces a message box the visitor was
 * using (focus left on nothing), so no keyboard is stranded; when the chat
 * opens on it, it is the chat's first target, on a fine pointer only, as the
 * box would be (panel-context useInitialFocus). Focus on it reads it out;
 * nothing here is live. Try again and Ask again hand focus to the box that
 * comes back, or after a tap on a touch screen to the question asked again.
 *
 * A chunk of its own, loaded with the first message (no chat runs out before
 * one), so the chat's first paint doesn't carry it.
 */

import { useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { useAgentStore, type VisitorQuota } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { peakOver, retryCost } from "@/lib/visitor-ai/allowance";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { formatPeakTime } from "@/lib/visitor-ai/peak";
import { focusFromCode, tapOnTouchScreen, useChat } from "../chat/chat-context";
import { Narration } from "../comic/comic-parts";
import { useInitialFocus } from "./panel-context";

/** The footer's way back to the guide. */
export const OPEN_TOOL_FINDER = "Open the tool finder";
/** Its way back to the box when Try again would repeat a change. */
export const ASK_AGAIN = "Ask again";
/** Said once the busy hours end while the chat waited on them: the box is back. */
export const BUSY_HOURS_OVER = "The busy hours are over, so Amr can answer again.";

/** Refusals a later try may get past: the footer offers Try again for these. */
const TRY_LATER: ReadonlySet<VisitorErrorCode> = new Set<VisitorErrorCode>([
  "site_busy",
  "meter_unavailable",
]);

/**
 * The footer's note: what ran out (the refusal's `code`, or with none the
 * allowance at none left) and when Amr can answer again, in the visitor's
 * own time for the busy hours (from the route's last answer). Narration, in
 * the third person: no I, me or my.
 */
export function readOnlyNote(
  code: VisitorErrorCode | null,
  quota: VisitorQuota | null,
  now: Date = new Date()
): string {
  const ends = quota?.peak && quota.peakEndsAt ? new Date(quota.peakEndsAt) : null;
  const again = ends && ends > now ? `at ${formatPeakTime(ends)}` : "once they end";
  // None left with no refusal yet: the busy hours' allowance, or the day's.
  const busyHours =
    !!quota?.peak && quota.peakRemaining === 0 && quota.remaining > 0 && !peakOver(quota, now);
  switch (code ?? (busyHours ? "visitor_peak_limit" : "visitor_limit")) {
    case "visitor_limit":
      return "You've used all of today's messages with Amr. He can answer again tomorrow.";
    case "visitor_peak_limit":
      return `You've used all your messages for these busy hours. Amr can answer again ${again}.`;
    case "site_limit":
      return "Amr has answered all he can for today. He can answer again tomorrow.";
    case "site_peak_limit":
      return `Amr has answered all he can for these busy hours. He can answer again ${again}.`;
    case "site_busy":
      return "Amr is too busy to answer right now. Try again in a few minutes.";
    case "disabled":
      return "Amr's AI is switched off right now.";
    case "meter_unavailable":
      return "Amr can't check today's message count right now. Try again in a few minutes.";
    default:
      return "Amr can't answer any more for now.";
  }
}

/**
 * The question Amr couldn't answer: the visitor's latest message, when no
 * reply in words came after it (a refusal leaves it on its own, or after a
 * tool round). Empty when the latest turn was answered.
 */
export function unansweredQuestion(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.content.some((b) => b.type === "text" && b.text.trim())) {
      return "";
    }
    if (m.role === "user") {
      return m.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join(" ")
        .trim();
    }
  }
  return "";
}

export interface ReadOnlyFooterProps {
  /** The refusal that stopped the chat, or null when the allowance says none are left. */
  code: VisitorErrorCode | null;
  /** The route's last allowance. */
  quota: VisitorQuota | null;
  /** The chat's clock (busy hours end on it). */
  now: Date;
  /** Messages left now (lib/visitor-ai/allowance messagesLeft): Try again says it spends one. */
  left: number | null;
  /** The chat's one retry, the runtime's word on it: true when the last turn ran no change. */
  canRetry(messages: ChatMessage[]): boolean;
  /** Ask the last question again (the runtime's retry). */
  onTryAgain(): void;
  /** Back to the tool finder, its search on the question Amr couldn't answer ("" for none). */
  onToolFinder(unanswered: string): void;
  /** Take focus as it shows: it replaced the message box the visitor was using. */
  takeFocus?: boolean;
}

/** The read-only footer: see the file comment. */
export function ReadOnlyFooter({
  code,
  quota,
  now,
  left,
  canRetry,
  onTryAgain,
  onToolFinder,
  takeFocus = false,
}: ReadOnlyFooterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { focusComposer, logId } = useChat();
  const later = code !== null && TRY_LATER.has(code) && left !== 0;
  const retryable = useAgentStore((s) => later && canRetry(s.messages));

  // The busy hours end (see the file comment).
  const announce = useAnnounce();
  const peakEndsAt = quota?.peak ? quota.peakEndsAt : null;
  useEffect(() => {
    if (!peakEndsAt) return;
    const wait = new Date(peakEndsAt).getTime() - Date.now();
    const id = window.setTimeout(
      () => {
        const s = useAgentStore.getState();
        const q = s.visitorQuota;
        if (!q?.peak || q.peakEndsAt !== peakEndsAt) return;
        const refusal = s.visitorFallback;
        const refused = refusal === "visitor_peak_limit" || refusal === "site_peak_limit";
        // Said only when the end gives the box back: the day's messages remain.
        const waited = (refused || q.peakRemaining === 0) && q.remaining > 0;
        s.setVisitorQuota({ ...q, peak: false, peakRemaining: null, peakEndsAt: null });
        if (refused) {
          s.setVisitorFallback(null);
          if (s.notice?.kind === refusal) s.setNotice(null);
        }
        if (waited && wait > 0) announce(BUSY_HOURS_OVER);
      },
      Math.max(0, wait)
    );
    return () => window.clearTimeout(id);
  }, [peakEndsAt, announce]);

  // Opened on it: the chat's first target, on a fine pointer, as the box would be.
  useInitialFocus(ref);
  // In the box's place: the focus the box had, left on nothing as it went.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!takeFocus || !el) return;
    const doc = el.ownerDocument;
    const held = doc.activeElement;
    if (!held || held === doc.body) el.focus({ preventScroll: true });
  }, [takeFocus]);

  /** The box back (the refusal let go), with focus on it, or after a tap on the question asked again. */
  const backToBox = (e: MouseEvent<HTMLButtonElement>) => {
    const tap = tapOnTouchScreen(e);
    const doc = e.currentTarget.ownerDocument;
    flushSync(() => useAgentStore.getState().setVisitorFallback(null));
    if (!tap) {
      focusComposer();
      return;
    }
    const asked = doc
      .getElementById(logId)
      ?.querySelectorAll<HTMLElement>('[data-chat-item="you"]');
    focusFromCode(asked?.[asked.length - 1]);
  };

  return (
    <div ref={ref} tabIndex={-1} data-visitor-read-only="" className="focus:outline-none">
      <Narration
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onToolFinder(unansweredQuestion(useAgentStore.getState().messages))}
            >
              {OPEN_TOOL_FINDER}
            </Button>
            {later && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  backToBox(e);
                  if (retryable) onTryAgain();
                }}
              >
                {retryable ? `Try again (${retryCost(left)})` : ASK_AGAIN}
              </Button>
            )}
          </>
        }
      >
        {readOnlyNote(code, quota, now)}
      </Narration>
    </div>
  );
}
