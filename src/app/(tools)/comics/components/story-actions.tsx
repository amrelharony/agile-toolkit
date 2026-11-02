"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { markRead, sentLinks, setSentLinks } from "@/lib/comics/reading";
import { dispatch } from "@/lib/gamification/engine";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";

/** How long the page has to be open before reaching its end counts as reading it. */
export const READ_DWELL_MS = 8_000;

/**
 * "Discuss in your retro": the story's question for the team becomes a topic on
 * the current retro board, in a column for talking things over (a question is
 * neither good nor bad news). The card links back to the story, and Undo takes
 * it away again. Once it's there, the button says so and opens the retro.
 *
 * Waits for the workspace to load: until then it can't see a card sent before,
 * and would send a second one.
 */
export function DiscussInRetro({ ep, question }: { ep: number; question: string }) {
  const hydrated = useWorkspaceHydrated();
  // Read after mount: the server and the first render know nothing of this browser.
  const [links, setLinks] = useState<HandoffLink[] | null>(null);
  useEffect(() => setLinks(sentLinks(ep)), [ep]);

  const route = getHandoffRoute("retro-topic");
  const sent = hydrated && links ? liveLink(links, "retro-topic") : undefined;

  if (sent) {
    return (
      <Button asChild variant="outline" className="self-start">
        <Link href={route.targetHref(sent.targetId)}>
          <Check aria-hidden="true" className="text-success" />
          In your retro: open it
        </Link>
      </Button>
    );
  }

  const send = () => {
    const link = sendHandoff(
      "retro-topic",
      {
        title: question,
        tone: "question",
        sourceRef: { tool: "comics", id: `ep-${ep}`, doc: String(ep) },
      },
      {
        getLinks: () => sentLinks(ep),
        setLinks: (update) => {
          setSentLinks(ep, update);
          setLinks(sentLinks(ep));
        },
      }
    );
    if (link) dispatch({ name: "tool:comics:retro-question", meta: { ep } });
  };

  return (
    <Button
      type="button"
      variant="toolkit"
      className="self-start"
      disabled={!hydrated || links === null}
      onClick={send}
    >
      <MessagesSquare aria-hidden="true" />
      Discuss in your retro
    </Button>
  );
}

/**
 * Counts the story as read, once per browser, when its end has been on screen
 * with the page open for a few seconds: a page that opens with its end already
 * in view (a short story on a tall screen) still waits for the dwell. Then the
 * reading trophies get their event and Amr jumps.
 */
export function ReadTracker({ ep }: { ep: number }) {
  const end = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    const first = markRead(ep);
    if (!first) return;
    dispatch({
      name: "tool:comics:completed",
      meta: { ep, total: first.total, weekStreak: first.weekStreak },
    });
    const mascot = useMascotStore.getState();
    // Nobody plays the queue while he isn't on screen.
    if (mascot.ready) mascot.queueReaction("excited");
  }, [ep]);

  useEffect(() => {
    const opened = Date.now();
    const node = end.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (!entry?.isIntersecting) return;
      timer = setTimeout(
        () => {
          observer.disconnect();
          finish();
        },
        Math.max(0, opened + READ_DWELL_MS - Date.now())
      );
    });
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [finish]);

  return <div ref={end} aria-hidden="true" data-story-end="" />;
}
