"use client";

import { Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLoveCounted, isLoved, setLoveCounted, setLoved } from "@/lib/comics/reading";
import { SHOW_READERS_AT } from "@/lib/comics/stats";
import { sendStats } from "@/lib/comics/stats-client";
import { cn } from "@/lib/utils";
import { useCounting } from "./use-counting";

/**
 * The line beside the heart: how many readers love the story. `own` is whether
 * this reader's love is among them, so "You love this" never hides another
 * reader's love behind one the server didn't count.
 */
export function lovesLabel(count: number, own = false): string {
  if (own && count <= 1) return "You love this";
  if (count <= 0) return "Be the first to love this";
  return `${count} ${count === 1 ? "reader loves" : "readers love"} this`;
}

/** "Read by N readers", once enough have finished the story to say so. */
export function readersLabel(count: number): string | null {
  return count >= SHOW_READERS_AT ? `Read by ${count} readers` : null;
}

/**
 * "Love this": one heart per browser (the reading record), counted anonymously
 * (/api/comics/stats) and taken back by pressing again, beside how many readers
 * love the story and, from SHOW_READERS_AT, how many have read it. The counts
 * are the page's when it was built; after a press, the server's fresh ones.
 *
 * Only a love the server counted is ever taken back from its count (the
 * device's counted mark, lib/comics/reading), so the owner's own presses, a
 * press while sign-in is still being checked, or one that failed to send can't
 * cancel another reader's love. One request at a time: presses while it's out
 * only change what the reader wants, and its answer sends the difference, if
 * any, so quick taps never send a love twice. A press the server didn't count
 * leaves the count as the server has it. When the browser can't keep the heart
 * (storage blocked or full) it works for the visit but sends nothing: with no
 * record, every visit could add another love.
 *
 * The label stays "Love this" (aria-pressed and the filled heart say it's on),
 * so the button never changes width. The line beside it isn't a live region,
 * since it changes on mount for a returning reader; a press's outcome is
 * announced on its own.
 */
export function LoveButton({
  ep,
  initialLoves,
  initialReaders = 0,
}: {
  ep: number;
  initialLoves: number;
  initialReaders?: number;
}) {
  const counting = useCounting();
  const [loved, setLovedState] = useState(false);
  // The server's counts as last heard, and whether it holds this browser's love.
  const [server, setServer] = useState({
    loves: initialLoves,
    readers: initialReaders,
    held: false,
  });
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Once the browser couldn't keep the heart, this visit works from memory.
  const memoryOnly = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setLovedState(isLoved(ep));
    setServer((s) => ({ ...s, held: isLoveCounted(ep) }));
  }, [ep]);

  // Send what the reader wants now, if the server doesn't hold it already.
  const sync = () => {
    if (inFlight.current || memoryOnly.current) return;
    const want = isLoved(ep);
    if (want === isLoveCounted(ep)) return;
    inFlight.current = true;
    setSending(true);
    void sendStats(ep, [want ? "love" : "unlove"]).then((answer) => {
      inFlight.current = false;
      setSending(false);
      if (!answer) return;
      if (!setLoveCounted(ep, want)) memoryOnly.current = true;
      setServer({ loves: answer.loves, readers: answer.readers, held: want });
      if (isLoved(ep) !== want) sync();
      else setAnnouncement(lovesLabel(answer.loves, want));
    });
  };

  const toggle = () => {
    const next = !loved;
    const kept = memoryOnly.current ? "unavailable" : setLoved(ep, next);
    // Another tab got there first: this button only catches up.
    if (kept === "unchanged") {
      setLovedState(isLoved(ep));
      return;
    }
    if (kept === "unavailable") memoryOnly.current = true;
    setLovedState(next);
    if (counting) sync();
  };

  // While a press is being sent the count follows the heart; otherwise it's
  // the server's.
  const shown = sending
    ? Math.max(0, server.loves - (server.held ? 1 : 0) + (loved ? 1 : 0))
    : server.loves;
  const own = loved && (sending || server.held);
  const readersLine = readersLabel(server.readers);
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
      <p className="text-sm text-sub">
        {lovesLabel(shown, own)}
        {readersLine ? ` · ${readersLine}` : null}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
