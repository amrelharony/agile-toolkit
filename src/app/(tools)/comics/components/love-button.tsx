"use client";

import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isLoved, setLoved } from "@/lib/comics/reading";
import { sendStats } from "@/lib/comics/stats-client";
import { cn } from "@/lib/utils";
import { useCounting } from "./use-counting";

export function lovesLabel(count: number): string {
  if (count <= 0) return "Be the first to love this";
  return `${count} ${count === 1 ? "reader loves" : "readers love"} this`;
}

/**
 * "Love this": one heart per browser (the reading record), counted anonymously
 * (/api/comics/stats) and taken back by pressing again. `initialLoves` is the
 * count when the page was built; a press shows the server's fresh one. The
 * owner's own presses change only their browser, never the count readers see.
 */
export function LoveButton({ ep, initialLoves }: { ep: number; initialLoves: number }) {
  const counting = useCounting();
  const [loved, setLovedState] = useState(false);
  const [loves, setLoves] = useState(initialLoves);

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
      if (answer) setLoves(answer.loves);
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
      </p>
    </div>
  );
}
