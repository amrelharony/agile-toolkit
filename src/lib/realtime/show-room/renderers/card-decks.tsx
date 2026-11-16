/**
 * Card Decks' show-room renderers: frame kind → component, one per kind in
 * `../frames/card-decks.ts`. Kept small and free of tool page code: the
 * `/join` page loads this for every show room.
 *
 *   "cards"  the dealt cards as comic panels: one card large on a phone, a
 *            hand as a list, each with its title and hint. The text is
 *            React text only (the parser already checked it).
 */

import { CARDS_FRAME_KIND, type CardsFrame } from "../frames/card-decks";
import { defineShowRenderer, type ShowRendererProps, type ShowRenderers } from "./types";

export function CardsFrameView({ payload, surface }: ShowRendererProps<CardsFrame>) {
  const phone = surface === "phone";
  const one = payload.cards.length === 1;
  return (
    <div className="space-y-3">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-sub">
        {payload.deck}
        {!one && ` · ${payload.cards.length} cards`}
      </p>
      <ul className={one ? "space-y-3" : "grid gap-3 sm:grid-cols-2"}>
        {payload.cards.map((card, i) => (
          <li
            // Cards in a frame never move, and two may share a text.
            key={i}
            className={
              phone && one
                ? "panel motion-safe:animate-scale-in space-y-2 p-5 text-center sm:p-8"
                : "panel space-y-1.5 p-3 sm:p-4"
            }
          >
            {card.title && (
              <p className="break-words text-sm font-semibold text-accent">{card.title}</p>
            )}
            <p
              className={
                phone && one
                  ? "break-words font-display text-2xl font-bold text-text sm:text-3xl"
                  : "break-words text-base font-semibold text-text"
              }
            >
              {card.text}
            </p>
            {card.hint && <p className="break-words text-sm text-sub">{card.hint}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const CARD_DECKS_RENDERERS: ShowRenderers = {
  [CARDS_FRAME_KIND]: defineShowRenderer<CardsFrame>(CardsFrameView),
};
