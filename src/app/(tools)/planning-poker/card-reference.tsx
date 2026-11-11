"use client";

/**
 * Under the deck: what the card being discussed means in the team's
 * Estimation Guide, with its example and pinned reference stories, so
 * "is this an 8?" can be answered against stories the team already did.
 */

import Link from "@/components/motion/transition-link";
import { pointsOf, type CardReference } from "@/app/(tools)/estimation-guide/references";

export function CardReferencePanel({
  card,
  reference,
  prompt,
}: {
  /** The card being discussed; null when none is picked yet. */
  card: string | null;
  reference: CardReference | null;
  /** Shown while no card is picked. */
  prompt: string;
}) {
  if (card === null) return <p className="mt-3 text-center text-xs text-sub">{prompt}</p>;
  // "?", "∞", or a custom card the guide has no entry for.
  if (reference === null) return null;
  const pts = (n: number | undefined) =>
    n === undefined ? "" : ` · ${n} ${n === 1 ? "point" : "points"}`;
  const calibrated = reference.example !== "" || reference.stories.length > 0;

  return (
    <section
      aria-label={`Estimation Guide for ${card}`}
      className="mt-3 rounded-lg border border-border bg-surface-deep p-3 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-sub">
          What <span className="font-data text-text">{card}</span> means here
        </p>
        <Link
          href="/estimation-guide"
          className="text-xs text-accent underline-offset-4 hover:underline"
        >
          Estimation Guide
        </Link>
      </div>
      {reference.description && <p className="mt-1 text-text">{reference.description}</p>}
      {/* The guide's loaded example is marked, so example data never reads
          as the team's in a real session. */}
      {reference.example && (
        <p className="mt-1 text-sub">
          <span className="font-medium text-text">
            {reference.exampleIsExample ? "Example:" : "Team example:"}
          </span>{" "}
          {reference.example}
          {reference.exampleIsExample && <span className="text-sub"> (example)</span>}
        </p>
      )}
      {reference.stories.length > 0 && (
        <>
          <p className="mt-2 text-xs text-sub">Reference stories</p>
          <ul className="mt-0.5 space-y-0.5">
            {reference.stories.map((s) => (
              <li key={s.id} className="break-words text-text">
                {s.title}
                <span className="text-sub">
                  {pts(s.points)}
                  {s.example ? " (example)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* Only a card with points can have a done story pinned on it. */}
      {!calibrated && (
        <p className="mt-1 text-xs text-sub">
          {pointsOf(card) === null
            ? "No team example for this card yet: add one in the Estimation Guide."
            : "No team example or reference story for this card yet: pin one in the Estimation Guide."}
        </p>
      )}
    </section>
  );
}
