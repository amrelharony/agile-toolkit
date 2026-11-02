"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AmrPortrait } from "@/components/vip/amr-portrait";
import { castAnchor, hookTargets, type CastCard as CastCardData } from "@/lib/vip/cast";

/** Every card has one id for its heading, so a link between cards can land on it. */
export const castHeadingId = (id: string) => `${castAnchor(id)}-name`;

function CardFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-sub">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}

/**
 * One colleague, in the bible's words. Shared with Which Colleague Are You?, so
 * a result is the same card anyone can read here. `cast` turns relationships into
 * links; with none, or `onOpen` absent, they stay plain text.
 */
export function CastCardView({
  card,
  cast = [],
  onOpen,
}: {
  card: CastCardData;
  cast?: readonly CastCardData[];
  onOpen?: (id: string) => void;
}) {
  return (
    <Card id={castAnchor(card.id)} className="h-full scroll-mt-24">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          {card.name === "Amr" ? <AmrPortrait /> : null}
          <h2
            id={castHeadingId(card.id)}
            tabIndex={-1}
            className="font-display text-lg font-semibold text-text focus-visible:outline-none"
          >
            {card.name}
          </h2>
        </div>
        <dl className="space-y-2">
          <CardFact label="Wants to">{card.human_want}</CardFact>
          <CardFact label="At their best">{card.strength}</CardFact>
          <CardFact label="When it goes too far">{card.overused_strength}</CardFact>
        </dl>
        {card.relationship_hooks.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">
              Relationships
            </h3>
            <ul className="mt-1 list-none space-y-2">
              {card.relationship_hooks.map((hook) => {
                const targets = onOpen ? hookTargets(hook, cast) : [];
                return (
                  <li key={hook.with} className="text-sm text-text">
                    {targets.length > 0 ? (
                      targets.map((target, i) => (
                        <span key={target.id}>
                          {i > 0 ? " or " : null}
                          <a
                            href={`#${castAnchor(target.id)}`}
                            className="font-medium underline"
                            onClick={(e) => {
                              e.preventDefault();
                              onOpen?.(target.id);
                            }}
                          >
                            {target.name}
                          </a>
                        </span>
                      ))
                    ) : (
                      <span className="font-medium">{hook.with}</span>
                    )}
                    <span className="block text-sub">{hook.collision}</span>
                    {hook.advance ? <span className="block text-sub">{hook.advance}</span> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
