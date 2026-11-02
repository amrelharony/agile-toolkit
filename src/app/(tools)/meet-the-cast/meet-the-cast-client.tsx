"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { castAnchor, filterCast, type CastCard } from "@/lib/vip/cast";
import { CastCardView, castHeadingId } from "./cast-card";

/**
 * The cast as cards: what each colleague wants, does well and overdoes, and who
 * they collide with. Filter by name, and a relationship links to the other card.
 */
export function MeetTheCastClient({ cast }: { cast: readonly CastCard[] }) {
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const shown = useMemo(() => filterCast(cast, query), [cast, query]);

  // The other card may be filtered out, so the filter clears first and the jump
  // waits until the card is back on the page.
  useEffect(() => {
    if (!opening) return;
    setOpening(null);
    document.getElementById(castAnchor(opening))?.scrollIntoView?.({ block: "start" });
    document.getElementById(castHeadingId(opening))?.focus({ preventScroll: true });
  }, [opening]);

  const open = (id: string) => {
    setQuery("");
    setOpening(id);
  };

  return (
    <ToolPageWrapper
      title="Meet the Cast"
      description="Capable colleagues and familiar habits: what each of them wants, does well and sometimes overdoes, and how they get along."
    >
      <div className="space-y-4">
        <Field label="Filter by name" className="max-w-sm">
          {(control) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub"
                aria-hidden="true"
              />
              <Input
                {...control}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                autoComplete="off"
              />
            </div>
          )}
        </Field>
        <p className="text-sm text-sub" role="status">
          {shown.length === cast.length
            ? `${cast.length} colleagues`
            : `${shown.length} of ${cast.length} colleagues`}
        </p>
        {shown.length === 0 ? (
          <EmptyState
            icon={Users}
            action={
              <Button type="button" variant="outline" onClick={() => setQuery("")}>
                Show everyone
              </Button>
            }
          >
            <p>No colleague has that name.</p>
          </EmptyState>
        ) : (
          <ul className="grid list-none gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((card) => (
              <li key={card.id}>
                <CastCardView card={card} cast={cast} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolPageWrapper>
  );
}
