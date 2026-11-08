"use client";

import { Heart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLoveCounted, isLoved, setLoveCounted, setLoved } from "@/lib/comics/reading";
import { SHOW_READERS_AT } from "@/lib/comics/stats";
import { sendStats } from "@/lib/comics/stats-client";
import { cn } from "@/lib/utils";
import { useCounting } from "./use-counting";

/** The line beside the heart: how many readers love the story, this one included. */
export function lovesLabel(count: number, loved = false): string {
  if (loved && count <= 1) return "You love this";
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
 * are the page's when it was built; a press shows the server's fresh ones.
 *
 * Only a love the server counted is ever taken back from its count (the
 * record's `counted`), so the owner's own presses, a press while sign-in is
 * still being checked, or one sent while offline can't cancel another reader's
 * love. When the browser can't keep the heart (storage blocked), it still works
 * for this visit. The label stays "Love this"; whether it's pressed is in
 * aria-pressed and the filled heart, so the button never changes width.
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
  const [loves, setLoves] = useState(initialLoves);
  const [readers, setReaders] = useState(initialReaders);
  // Once the browser couldn't keep the heart, this visit works from memory.
  const memoryOnly = useRef(false);
  // Whether the server holds this visit's love when the browser can't remember it.
  const heldThisVisit = useRef(false);
  // Only the answer to the latest press is shown.
  const latest = useRef(0);

  useEffect(() => {
    setLovedState(isLoved(ep));
  }, [ep]);

  const toggle = () => {
    const next = !loved;
    const kept = memoryOnly.current ? "unavailable" : setLoved(ep, next);
    // Another tab got there first: this button only catches up.
    if (kept === "unchanged") {
      setLovedState(isLoved(ep));
      return;
    }
    if (kept === "unavailable") memoryOnly.current = true;
    const remembered = kept === "changed";
    setLovedState(next);
    if (!counting) return;

    const held = remembered ? isLoveCounted(ep) : heldThisVisit.current;
    // A love the server already holds isn't sent twice, and one it never
    // counted isn't taken back.
    if (next === held) return;
    const press = ++latest.current;
    setLoves((n) => Math.max(0, n + (next ? 1 : -1)));
    void sendStats(ep, [next ? "love" : "unlove"]).then((answer) => {
      if (!answer) return;
      if (remembered) setLoveCounted(ep, next);
      else heldThisVisit.current = next;
      if (press !== latest.current) return;
      setLoves(answer.loves);
      setReaders(answer.readers);
    });
  };

  const readersLine = readersLabel(readers);
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
      <p role="status" className="text-sm text-sub">
        {lovesLabel(loves, loved)}
        {readersLine ? ` · ${readersLine}` : null}
      </p>
    </div>
  );
}
