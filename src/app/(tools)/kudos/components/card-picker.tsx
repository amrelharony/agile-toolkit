"use client";

/**
 * The kudos form's card picker: the printed Agile at Work cards, sorted as a
 * Scrum Master's stack is. First the theme (the four habits, told apart by
 * their colour, and Open), then that theme's cards: a habit's episode cards,
 * each with its comic panel, its EP number and its headline; or, for Open,
 * "Thank you!" and "Great teamwork!" with the book episode the card reminds
 * the sender of, if any.
 *
 * Choosing a theme keeps the card when it is already on that theme, else
 * picks the theme's first card (its lowest episode; "Thank you!" for Open).
 * The form owns the choice; this only shows it and reports changes.
 */

import { useId } from "react";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import {
  cardDesign,
  designFor,
  designsByHabit,
  epLabel,
  splitHeadline,
  type CardDesign,
  type CardDesignKey,
  type HabitDesigns,
} from "@/lib/kudos/card-designs";
import { cardPanelUrl } from "@/lib/kudos/card-panels";

const THEMES: readonly HabitDesigns[] = designsByHabit();

const CHOICE =
  "min-touch-coarse flex items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors";
const CHOICE_ON = "border-accent bg-accent/10 text-text";
const CHOICE_OFF = "border-border bg-surface-deep text-sub hover:text-text";

const SELECT_CLASS =
  "h-10 [@media(pointer:coarse)]:h-11 rounded-md bg-surface-deep border border-border px-3 text-sm text-text";

// The panel's own paper and the print's ink, as on the card (inline: print colours).
const BLANK_PANEL = "#F2EFE8";
const PRINT_INK = "#14252A";

interface Props {
  design: CardDesignKey;
  /** The book episode an open card reminds the sender of, or null. */
  remindsOf: number | null;
  onDesignChange: (key: CardDesignKey) => void;
  onRemindsOfChange: (ep: number | null) => void;
}

/** A card's panel, small: decoration beside the words that name the card. */
function Thumbnail({ design }: { design: CardDesign }) {
  const src = cardPanelUrl(design.key, "small");
  const shape = "h-12 w-12 shrink-0 rounded";
  const style = { background: BLANK_PANEL, border: `1px solid ${PRINT_INK}` };
  if (!src) return <span aria-hidden="true" className={`block ${shape}`} style={style} />;
  return (
    // Plain <img>: the 360 px art is already sized, and the optimiser would add
    // a second copy of every panel to the download bill. Same CORS mode as the
    // card's own panel, so the browser caches one copy for both.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      crossOrigin="anonymous"
      src={src}
      width={48}
      height={48}
      alt=""
      loading="lazy"
      decoding="async"
      className={`block object-cover ${shape}`}
      style={style}
    />
  );
}

export function CardPicker({ design, remindsOf, onDesignChange, onRemindsOfChange }: Props) {
  const captionId = useId();
  const remindsId = useId();
  const current = cardDesign(design) ?? designFor(null);
  const theme = THEMES.find((t) => t.habit === current.habit)!;

  const pickTheme = (t: HabitDesigns) => {
    if (t.habit !== current.habit) onDesignChange(t.designs[0].key);
  };

  return (
    <div className="flex flex-col gap-3">
      <p id={captionId} className="text-sm font-medium leading-none text-sub">
        Card
      </p>
      <div
        role="group"
        aria-labelledby={captionId}
        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
      >
        {THEMES.map((t) => {
          const on = t.habit === current.habit;
          return (
            <button
              key={t.habit}
              type="button"
              aria-pressed={on}
              onClick={() => pickTheme(t)}
              className={`${CHOICE} justify-center text-xs font-medium ${on ? CHOICE_ON : CHOICE_OFF}`}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full border border-border"
                style={{ background: t.colour }}
              />
              <span>{t.habit}</span>
            </button>
          );
        })}
      </div>

      <div
        role="group"
        aria-label={`${theme.habit} cards`}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {theme.designs.map((d) => {
          const on = d.key === current.key;
          const pick = () => onDesignChange(d.key);
          if (d.ep === null) {
            return (
              <button
                key={d.key}
                type="button"
                aria-pressed={on}
                onClick={pick}
                className={`${CHOICE} text-sm font-semibold ${on ? CHOICE_ON : CHOICE_OFF}`}
              >
                <Thumbnail design={d} />
                <span className="min-w-0">{d.title}</span>
              </button>
            );
          }
          const { rest } = splitHeadline(d.headline);
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={on}
              aria-label={`Episode ${d.ep}: ${d.headline}`}
              onClick={pick}
              className={`${CHOICE} ${on ? CHOICE_ON : CHOICE_OFF}`}
            >
              <Thumbnail design={d} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-bold">{epLabel(d.ep)}</span>
                <span className="text-sm leading-snug">{rest}</span>
              </span>
            </button>
          );
        })}
      </div>

      {current.kind === "open" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={remindsId} className="text-sm font-medium text-sub">
            Which episode does this remind you of?
          </label>
          <select
            id={remindsId}
            value={remindsOf ?? ""}
            onChange={(e) => onRemindsOfChange(e.target.value ? Number(e.target.value) : null)}
            className={SELECT_CLASS}
          >
            <option value="">No episode</option>
            {BOOK_EPISODES.map((e) => (
              <option key={e.ep} value={e.ep}>
                {`${epLabel(e.ep)} · ${e.title}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
