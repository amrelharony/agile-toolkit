"use client";

import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLoved, setLoved } from "@/lib/comics/reading";
import { SHOW_READERS_AT } from "@/lib/comics/stats";
import { sendStats } from "@/lib/comics/stats-client";
import { cn } from "@/lib/utils";
import { useCounting } from "./use-counting";

export function lovesLabel(count: number): string {
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
 * are the page's when it was built; a press shows the server's fresh ones. The
 * owner's own presses change only their browser, never the counts readers see.
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

  useEffect(() => {
    setLovedState(isLoved(ep));
  }, [ep]);

  const toggle = () => {
    const next = !loved;
    // Another tab may have got there first: then only this button catches up.
    if (!setLoved(ep, next)) {
      setLovedState(isLoved(ep));
      return;
    }
    setLovedState(next);
    if (!counting) return;
    setLoves((n) => Math.max(0, n + (next ? 1 : -1)));
    void sendStats(ep, [next ? "love" : "unlove"]).then((answer) => {
      if (!answer) return;
      setLoves(answer.loves);
      setReaders(answer.readers);
    });
  };

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
        {loved ? "Loved" : "Love this"}
      </Button>
      <p role="status" className="text-sm text-sub">
        {lovesLabel(loves)}
        {readersLabel(readers) ? <> · {readersLabel(readers)}</> : null}
      </p>
    </div>
  );
}
