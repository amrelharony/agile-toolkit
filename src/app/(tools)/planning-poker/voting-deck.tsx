"use client";

/**
 * Playing cards and the voting deck.
 *
 * The deck is one radiogroup of card buttons with a roving tab stop. The
 * facilitator's own "Your vote" deck and the deck they open for each
 * player in facilitator mode are the same component; a player's deck never
 * marks a card as checked, so their face-down vote can't be read off it.
 */

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

function CardFace({
  value,
  faceDown,
  selected,
  small,
}: {
  value: string;
  faceDown: boolean;
  selected: boolean;
  small: boolean;
}) {
  return faceDown ? (
    <div
      className="absolute inset-1 rounded-lg overflow-hidden"
      // Theme variables, so the card back reads in the light theme too.
      style={{
        background:
          "repeating-linear-gradient(45deg, var(--surface-hover) 0px, var(--surface-hover) 4px, var(--surface-deep) 4px, var(--surface-deep) 8px)",
      }}
    />
  ) : (
    <span
      className={[
        "font-data font-bold tabular-nums leading-none z-10",
        small ? "text-sm" : "text-2xl",
        selected ? "text-accent" : "text-text",
      ].join(" ")}
    >
      {value}
    </span>
  );
}

/**
 * A card in the voting deck when `onSelect` is given — a real button with
 * radio semantics inside the deck's radiogroup, so it's reachable and
 * operable from the keyboard. Without `onSelect` it's a read-only card
 * (other participants' face-down or revealed votes).
 */
export function PlayingCard({
  value,
  faceDown = false,
  selected = false,
  onSelect,
  small = false,
  rotation = 0,
  tabIndex,
  buttonRef,
}: {
  value: string;
  faceDown?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  small?: boolean;
  rotation?: number;
  tabIndex?: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const w = small ? 48 : 64;
  const h = small ? 68 : 90;
  const className = [
    "relative rounded-xl border-2 flex items-center justify-center shrink-0 select-none",
    onSelect
      ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      : "cursor-default",
    faceDown
      ? "bg-surface border-border"
      : selected
        ? "bg-surface-deep border-accent shadow-lg shadow-accent/40"
        : "bg-surface-hover border-border hover:border-accent/40",
  ].join(" ");
  const face = <CardFace value={value} faceDown={faceDown} selected={selected} small={small} />;

  if (!onSelect) {
    return (
      <motion.div
        animate={{ rotate: rotation, scale: selected ? 1.12 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        style={{ width: w, height: h, rotate: rotation }}
        className={className}
      >
        {face}
      </motion.div>
    );
  }

  return (
    <motion.button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      whileHover={{ y: -8, scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      animate={{ rotate: rotation, scale: selected ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{ width: w, height: h, rotate: rotation }}
      className={className}
    >
      {face}
    </motion.button>
  );
}

/**
 * The fanned deck of cards to vote with. Arrow keys move between cards
 * (wrapping), Home/End jump to the ends, and Space/Enter plays the card —
 * moving focus alone never votes. The checked card holds the deck's single
 * tab stop; with none checked it's the first card.
 */
export function VotingDeck({
  label,
  scale,
  selected,
  onPick,
  focusOnMount = false,
}: {
  /** Names the radiogroup: "Your vote", "Priya's vote". */
  label: string;
  scale: readonly string[];
  /** The checked card; null for none (always, on a player's deck). */
  selected: string | null;
  onPick: (value: string) => void;
  /** Move focus into the deck when it opens. */
  focusOnMount?: boolean;
}) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardCount = scale.length;
  const maxRotation = Math.min(20, cardCount * 1.5);
  const tabStopIdx = Math.max(0, selected === null ? 0 : scale.indexOf(selected));

  useEffect(() => {
    if (focusOnMount) cardRefs.current[tabStopIdx]?.focus();
    // Once, when the deck opens: later picks keep focus where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = cardRefs.current.indexOf(e.target as HTMLButtonElement);
    if (current === -1 || cardCount === 0) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % cardCount;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + cardCount) % cardCount;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = cardCount - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    cardRefs.current[next]?.focus();
  };

  return (
    // Arrow keys are handled here for the whole deck; focus itself lives on
    // the cards (roving tabindex), not on the group.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap justify-center gap-3 pt-2 pb-2"
    >
      {scale.map((value, i) => {
        const mid = (cardCount - 1) / 2;
        const rotation = cardCount > 1 ? ((i - mid) / mid) * maxRotation : 0;
        return (
          <PlayingCard
            key={value}
            value={value}
            selected={selected === value}
            onSelect={() => onPick(value)}
            rotation={rotation}
            tabIndex={i === tabStopIdx ? 0 : -1}
            buttonRef={(el) => {
              cardRefs.current[i] = el;
            }}
          />
        );
      })}
    </div>
  );
}
