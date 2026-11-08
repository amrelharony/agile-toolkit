"use client";

import { Heart } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLoveCounted, isLoved, setLoveCounted, setLoved } from "@/lib/comics/reading";
import { sendStats } from "@/lib/comics/stats-client";
import { cn } from "@/lib/utils";
import { useCounting } from "./use-counting";

/** Said when a press couldn't be counted: the heart stays on this device. */
export const NOT_COUNTED = "That couldn't be counted just now.";

/**
 * The line beside the heart: how many readers love the story. `own` is whether
 * this reader's love is among them, so "You love this" never hides another
 * reader's love behind one the server didn't count; `pressed` is whether the
 * heart is on, so a heart that wasn't counted never sits beside "Be the first".
 */
export function lovesLabel(count: number, own = false, pressed = own): string {
  if (own && count <= 1) return "You love this";
  if (count <= 0) return pressed ? "No loves counted yet" : "Be the first to love this";
  return `${count} ${count === 1 ? "reader loves" : "readers love"} this`;
}

/**
 * The whole line beside the heart, shown and announced after a press: the
 * count, and, when this visit knows the reader's heart isn't among it
 * (`uncounted`: a send failed, or the press wasn't sent), that it isn't. A
 * counted mark missing from this device (after a restore, or storage wiped)
 * proves nothing, so says nothing.
 */
export function heartLine(count: number, own = false, pressed = own, uncounted = false): string {
  const line = lovesLabel(count, own, pressed);
  return pressed && !own && uncounted && count > 0 ? `${line} (yours isn't counted)` : line;
}

/** Runs `task` with this story's heart to itself across the browser's tabs, where it can. */
function exclusive(ep: number, task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.request) return task();
  return locks.request(`agile-toolkit:comics:love:${ep}`, task).then(() => undefined);
}

/**
 * "Love this": one heart per browser (the reading record), counted anonymously
 * (/api/comics/stats) and taken back by pressing again. `initialLoves` is the
 * count when the page was built; after a press, the server's fresh one.
 *
 * Only a love the server counted is ever taken back from its count (the
 * device's counted mark, lib/comics/reading), so the owner's own presses, a
 * press while sign-in is still being checked, or one that failed to send can't
 * cancel another reader's love. One send at a time for the story across the
 * browser's tabs (Web Locks, where there are any): each sends what the reader
 * wants now if the server doesn't hold it already, so quick taps, or taps in a
 * second tab, never send a love twice; a tab that finds another sent its press
 * catches its count up (a press on a stale heart goes through the lock too).
 * A press the server didn't count (or that isn't sent: the owner's, one before
 * sign-in settles) leaves the count as the server has it, and the line says
 * this visit's heart isn't counted; it isn't sent again by itself, since the
 * owner's presses must never be. When the browser can't keep the heart
 * (storage blocked or full) it works for the visit but sends nothing: with no
 * record, every visit could add another love.
 *
 * The label stays "Love this" (aria-pressed and the filled heart say it's on),
 * so the button never changes width. The line beside it isn't a live region,
 * since it changes on mount for a returning reader; a press's outcome is
 * announced on its own.
 */
export function LoveButton({ ep, initialLoves }: { ep: number; initialLoves: number }) {
  const counting = useCounting();
  const [loved, setLovedState] = useState(false);
  // The server's count as last heard, and whether it holds this browser's love,
  // with a ref for reading it outside a render.
  const [server, setServerState] = useState({ loves: initialLoves, held: false });
  const serverNow = useRef(server);
  const setServer = useCallback((next: typeof server) => {
    serverNow.current = next;
    setServerState(next);
  }, []);
  // This visit knows the reader's heart isn't counted: a send failed, or the
  // press wasn't sent. Never guessed from a missing counted mark.
  const [uncounted, setUncountedState] = useState(false);
  const uncountedNow = useRef(false);
  const setUncounted = useCallback((value: boolean) => {
    uncountedNow.current = value;
    setUncountedState(value);
  }, []);
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Once the browser couldn't keep the heart, this visit works from memory.
  const memoryOnly = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setLovedState(isLoved(ep));
    setServer({ ...serverNow.current, held: isLoveCounted(ep) });
  }, [ep, setServer]);

  // Another tab sent (or took back) this browser's love: count it in as the
  // server now has it. The new state, or null when nothing changed.
  const catchUp = () => {
    const s = serverNow.current;
    const held = isLoveCounted(ep);
    if (held === s.held) return null;
    const next = { ...s, held, loves: Math.max(0, s.loves + (held ? 1 : -1)) };
    setServer(next);
    return next;
  };

  // Send what the reader wants until the server holds it, or a send fails.
  const sync = () => {
    if (inFlight.current || memoryOnly.current) return;
    inFlight.current = true;
    setSending(true);
    setAnnouncement("");
    let outcome = "";
    let failed = false;
    void exclusive(ep, async () => {
      while (!memoryOnly.current) {
        const want = isLoved(ep);
        if (want === isLoveCounted(ep)) return;
        const answer = await sendStats(ep, [want ? "love" : "unlove"]);
        if (!answer) {
          failed = true;
          outcome = NOT_COUNTED;
          setUncounted(true);
          return;
        }
        if (!setLoveCounted(ep, want)) memoryOnly.current = true;
        setUncounted(false);
        setServer({ ...serverNow.current, loves: answer.loves, held: want });
        outcome = heartLine(answer.loves, want);
      }
    })
      .catch(() => {
        failed = true;
      })
      .finally(() => {
        inFlight.current = false;
        setSending(false);
        // Another tab may have sent this press meanwhile. With nothing sent,
        // say what the line now says.
        const s = (memoryOnly.current ? null : catchUp()) ?? serverNow.current;
        const now = isLoved(ep);
        setAnnouncement(outcome || heartLine(s.loves, now && s.held, now, uncountedNow.current));
        // A press that came in as the lock was let go.
        if (!failed && !memoryOnly.current && isLoved(ep) !== isLoveCounted(ep)) sync();
      });
  };

  const toggle = () => {
    const next = !loved;
    const kept = memoryOnly.current ? "unavailable" : setLoved(ep, next);
    // Another tab got there first: this button catches up. When it counts, it
    // goes through the lock, so it waits for a send that other tab still has out.
    if (kept === "unchanged") {
      const now = isLoved(ep);
      setLovedState(now);
      if (counting && !memoryOnly.current) {
        sync();
        return;
      }
      const s = catchUp() ?? serverNow.current;
      setUncounted(now && !s.held);
      setAnnouncement(heartLine(s.loves, now && s.held, now, now && !s.held));
      return;
    }
    if (kept === "unavailable") memoryOnly.current = true;
    setLovedState(next);
    if (counting && !memoryOnly.current) {
      sync();
      return;
    }
    // Not sent: say what the line now says.
    const s = serverNow.current;
    setUncounted(next && !s.held);
    setAnnouncement(heartLine(s.loves, next && s.held, next, next && !s.held));
  };

  // While a press is being sent the count follows the heart; otherwise it's
  // the server's.
  const shown = sending
    ? Math.max(0, server.loves - (server.held ? 1 : 0) + (loved ? 1 : 0))
    : server.loves;
  const own = loved && (sending || server.held);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        type="button"
        variant="outline"
        aria-pressed={loved}
        onClick={toggle}
        className={cn("min-h-11 gap-2", loved && "border-accent text-accent")}
      >
        <Heart className={cn("size-5", loved && "fill-current")} aria-hidden="true" />
        Love this
      </Button>
      <p className="text-sm text-sub">{heartLine(shown, own, loved, uncounted)}</p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
