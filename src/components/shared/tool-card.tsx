"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { useToolPrefs } from "@/lib/tools/tool-prefs";
import { cn } from "@/lib/utils";
import { InkArt } from "@/components/ink/ink-art";
import { seedFrom } from "@/lib/ink/rng";
import { TONE_VAR, type InkDrawing, type InkTone } from "@/lib/ink/types";

interface ToolCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  tags?: string[];
  accentColor?: string;
  /**
   * The section's watercolour (lib/ink/drawings/sections SECTION_TONE): the
   * icon sits on a wash of it, in its colour, instead of the plain tile.
   */
  tone?: InkTone;
  /** When provided, a star toggle renders in the top-right corner. */
  toolId?: string;
}

/** The wash under a card's icon: its own blob per card, drawn still. */
function tileWash(tone: InkTone, key: string): InkDrawing {
  return {
    name: "tile-wash",
    viewBox: "0 0 48 48",
    washes: [{ cx: 24, cy: 25, rx: 21, ry: 18, seed: seedFrom(key), tone }],
    strokes: [],
  };
}

/**
 * Home-grid tool card.
 *
 * The title is the card's link and its `::after` stretches over the whole
 * card, so the card stays clickable while the favourite star sits beside
 * the link instead of inside it (a <button> inside an <a> is invalid and
 * screen readers announce it as part of the link). Layers, bottom to top:
 * title/description with the stretched link (z-1) → tags
 * (z-1, click-through) → top row with the star (z-2, click-through except
 * the star). Flex items honour `z-index` without `position`, so the title
 * block stays above the panel without becoming the link's containing block.
 */
export function ToolCard({
  href,
  icon,
  title,
  description,
  tags,
  accentColor,
  tone,
  toolId,
}: ToolCardProps) {
  const { isFavorite, toggleFavorite } = useToolPrefs();
  const favorited = toolId ? isFavorite(toolId) : false;

  const handleStarClick = (e: React.MouseEvent) => {
    if (!toolId) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(toolId);
  };

  return (
    <div
      data-sonify-hover="card"
      className="
        panel group relative flex flex-col gap-3
        p-4 sm:p-5
        overflow-hidden
        transition-[transform,box-shadow,background-color] duration-fast
        hover:bg-[var(--cardH)]
        hover:shadow-xl
        hover:-translate-x-px hover:-translate-y-px
      "
      style={accentColor ? ({ "--tool-accent": accentColor } as React.CSSProperties) : undefined}
    >
      {/* Content — above the stretched link so the star stays clickable;
          everything else in the row lets clicks fall through to the link. */}
      <div className="pointer-events-none relative z-[2] flex items-start justify-between">
        {tone ? (
          <div
            aria-hidden="true"
            className="relative flex h-11 w-11 items-center justify-center text-lg"
            style={{ color: TONE_VAR[tone] }}
          >
            <InkArt
              drawing={tileWash(tone, toolId ?? href)}
              still
              className="absolute -left-1.5 -top-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)]"
            />
            <span className="relative">{icon}</span>
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="
              w-11 h-11 rounded-lg
              bg-accent/10 border border-border
              flex items-center justify-center
              text-accent text-lg
            "
          >
            {icon}
          </div>
        )}
        <div className="flex items-center gap-2">
          {toolId && (
            <button
              type="button"
              onClick={handleStarClick}
              aria-label={
                favorited ? `Remove ${title} from favorites` : `Add ${title} to favorites`
              }
              aria-pressed={favorited}
              data-no-sound="true"
              className={cn(
                // `min-touch-coarse` lifts the tap area to 44 × 44 on touch
                // devices without enlarging the visual glyph on desktop where
                // the 32 × 32 chip pairs with the adjacent ArrowRight.
                "pointer-events-auto min-touch-coarse w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-default",
                favorited ? "text-accent-amber" : "text-sub hover:text-accent-amber"
              )}
            >
              <Star
                className="w-4 h-4"
                fill={favorited ? "currentColor" : "none"}
                aria-hidden="true"
              />
            </button>
          )}
          <ArrowRight
            aria-hidden="true"
            className="
              w-4 h-4 text-sub
              group-hover:text-accent
              group-hover:translate-x-0.5
              transition-all duration-default ease-spring
            "
          />
        </div>
      </div>

      <div className="z-[1]">
        <h3 className="font-display text-sm font-semibold text-text">
          <Link
            href={href}
            className="focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent"
          >
            {title}
          </Link>
        </h3>
        <p className="text-caption text-sub mt-1 line-clamp-2">{description}</p>
      </div>

      {tags && tags.length > 0 && (
        <div className="pointer-events-none relative z-[1] flex flex-wrap gap-1.5 mt-auto">
          {tags.map((tag) => (
            <span
              key={tag}
              className="
                font-mono text-xs
                px-2 py-0.5 rounded-xs
                border border-rule text-sub
              "
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
