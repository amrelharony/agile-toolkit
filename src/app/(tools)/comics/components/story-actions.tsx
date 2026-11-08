"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { FIRST_WEEKLY_EP } from "@/lib/comics/entry";
import { READ_EVENT, markAsked, markRead, sentLinks, setSentLinks } from "@/lib/comics/reading";
import { beaconStats } from "@/lib/comics/stats-client";
import { dispatch } from "@/lib/gamification/engine";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import { RETRO_BOARD_ID } from "@/lib/handoffs/targets/retro-board";
import type { HandoffLink } from "@/lib/handoffs/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useCounting } from "./use-counting";

/** How long the page has to be open before reaching its end counts as reading it. */
export const READ_DWELL_MS = 8_000;

/**
 * "Discuss in your retro": the story's question for the team becomes a topic on
 * the current retro board, in a column for talking things over (a question is
 * neither good nor bad news). The card links back to the story, and Undo takes
 * it away again. While the card is on the current board, the button says so and
 * opens the retro; once that retro is archived, the question can go to the next.
 *
 * Waits for the workspace to load: until then it can't see a card sent before,
 * and would send a second one. The links are kept in this component as well as
 * in storage, so a browser that can't store them still can't send twice.
 */
export function DiscussInRetro({ ep, question }: { ep: number; question: string }) {
  const hydrated = useWorkspaceHydrated();
  const counting = useCounting();
  // Subscribed, so a card removed elsewhere (another tab, sync) frees the button.
  const board = useWorkspaceStore((s) =>
    (s.retroBoards ?? []).find((b) => b.id === RETRO_BOARD_ID)
  );
  // Read after mount: the server and the first render know nothing of this browser.
  const [links, setLinks] = useState<HandoffLink[] | null>(null);
  const held = useRef<HandoffLink[]>([]);
  useEffect(() => {
    held.current = sentLinks(ep);
    setLinks(held.current);
  }, [ep]);

  const route = getHandoffRoute("retro-topic");
  const onBoard = useCallback(
    (all: readonly HandoffLink[] | undefined) =>
      (all ?? []).filter(
        (l) => l.route === "retro-topic" && board?.cards.some((c) => c.id === l.targetId)
      ),
    [board]
  );
  const [sent] = hydrated && links ? onBoard(links) : [];

  // The clicked control is replaced by the other one: focus follows it, so a
  // keyboard user isn't sent back to the top of the page.
  const control = useRef<HTMLElement | null>(null);
  const hadFocus = useRef(false);
  const isSent = Boolean(sent);
  useEffect(() => {
    if (hadFocus.current) control.current?.focus();
  }, [isSent]);
  const focusProps = {
    ref: (node: HTMLElement | null) => {
      control.current = node;
    },
    onFocus: () => {
      hadFocus.current = true;
    },
    onBlur: () => {
      hadFocus.current = false;
    },
  };

  if (sent) {
    return (
      <Button asChild variant="outline" className="self-start">
        <Link href={route.targetHref(sent.targetId)} {...focusProps}>
          <Check aria-hidden="true" className="text-success" />
          In your retro: open it
        </Link>
      </Button>
    );
  }

  const send = () => {
    hadFocus.current = true;
    const link = sendHandoff(
      "retro-topic",
      {
        title: question,
        tone: "question",
        sourceRef: { tool: "comics", id: `ep-${ep}`, doc: String(ep) },
      },
      {
        // Only a card on the current board counts: an archived one is history.
        getLinks: () => onBoard(held.current),
        setLinks: (update) => {
          held.current = update(held.current);
          setSentLinks(ep, () => held.current);
          setLinks(held.current);
        },
      }
    );
    // The trophy counts the first question a story sends, not each send and Undo.
    if (link && markAsked(ep)) {
      dispatch({ name: "tool:comics:retro-question", meta: { ep } });
      if (counting && ep >= FIRST_WEEKLY_EP) beaconStats(ep, ["retro"]);
    }
  };

  return (
    <Button
      type="button"
      variant="toolkit"
      className="self-start"
      disabled={!hydrated || links === null}
      onClick={send}
      {...focusProps}
    >
      <MessagesSquare aria-hidden="true" />
      Discuss in your retro
    </Button>
  );
}

/**
 * Counts the story as read, once per browser, when its end has been on screen
 * with the page open and in view for a few seconds: a page that opens with its
 * end already in view (a short story on a tall screen) still waits for the
 * dwell, and so does one opened in a background tab. Then the reading trophies
 * get their event and Amr jumps.
 */
export function ReadTracker({ ep }: { ep: number }) {
  const end = useRef<HTMLDivElement>(null);
  const counting = useCounting();

  const finish = useCallback(() => {
    const first = markRead(ep);
    if (!first) return;
    if (counting && ep >= FIRST_WEEKLY_EP) beaconStats(ep, ["reader"]);
    window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: first }));
    dispatch({
      name: "tool:comics:completed",
      meta: { ep, total: first.total, weekStreak: first.weekStreak },
    });
    const mascot = useMascotStore.getState();
    // Nobody plays the queue while he isn't on screen.
    if (mascot.ready) mascot.queueReaction("excited");
  }, [ep, counting]);

  useEffect(() => {
    const node = end.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // The dwell starts when the page is first seen, not when a background tab loads it.
    let shownAt: number | null = document.visibilityState === "visible" ? Date.now() : null;
    let inView = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const arm = () => {
      clearTimeout(timer);
      if (done || !inView || shownAt === null) return;
      timer = setTimeout(
        () => {
          done = true;
          observer.disconnect();
          finish();
        },
        Math.max(0, shownAt + READ_DWELL_MS - Date.now())
      );
    };
    const observer = new IntersectionObserver((entries) => {
      // One callback can hold several changes: the last is where it is now.
      inView = entries[entries.length - 1]?.isIntersecting ?? false;
      arm();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible" && shownAt === null) {
        shownAt = Date.now();
        arm();
      }
    };
    observer.observe(node);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [finish]);

  return <div ref={end} aria-hidden="true" data-story-end="" />;
}
