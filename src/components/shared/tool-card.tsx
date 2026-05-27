"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { useToolPrefs } from "@/lib/tools/tool-prefs";
import { cn } from "@/lib/utils";

interface ToolCardProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  tags?: string[];
  accentColor?: string;
  /** When provided, a star toggle renders in the top-right corner. */
  toolId?: string;
}

export function ToolCard({
  href,
  icon,
  title,
  description,
  tags,
  accentColor,
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
    <Link
      href={href}
      data-sonify-hover="card"
      className="
        group relative flex flex-col gap-3
        p-4 sm:p-5 rounded-2xl
        bg-[var(--card)] border border-border
        backdrop-blur-[20px] saturate-[1.4]
        overflow-hidden
        transition-all duration-medium ease-spring
        hover:bg-[var(--cardH)]
        hover:border-accent/20
        hover:shadow-glow
        hover:-translate-y-[3px]
        will-change-transform
      "
      style={accentColor ? ({ "--tool-accent": accentColor } as React.CSSProperties) : undefined}
    >
      {/* Inset top light */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.06)] to-transparent" />

      {/* Shimmer sweep overlay */}
      <div
        className="
          absolute inset-0 pointer-events-none z-0
          opacity-0 group-hover:opacity-100
        "
      >
        <div
          className="
            absolute inset-0
            bg-[linear-gradient(105deg,transparent_40%,var(--glow)_50%,transparent_60%)]
            -translate-x-full group-hover:animate-shimmer
          "
        />
      </div>

      {/* Content */}
      <div className="relative z-[1] flex items-start justify-between">
        <div
          className="
            w-11 h-11 rounded-xl
            bg-[var(--card)] border border-border
            flex items-center justify-center
            transition-border-color duration-default
            group-hover:border-accent/20
            text-accent text-lg
          "
        >
          {icon}
        </div>
        <div className="flex items-center gap-2">
          {toolId && (
            <button
              type="button"
              onClick={handleStarClick}
              aria-label={favorited ? `Unstar ${title}` : `Star ${title}`}
              aria-pressed={favorited}
              data-no-sound="true"
              className={cn(
                // `min-touch-coarse` lifts the tap area to 44 × 44 on touch
                // devices without enlarging the visual glyph on desktop where
                // the 32 × 32 chip pairs with the adjacent ArrowRight.
                "min-touch-coarse w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-default",
                favorited
                  ? "text-accent-amber"
                  : "text-sub opacity-40 hover:opacity-100 hover:text-accent-amber"
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
            className="
              w-4 h-4 text-sub opacity-40
              group-hover:opacity-100 group-hover:text-accent
              group-hover:translate-x-0.5
              transition-all duration-default ease-spring
            "
          />
        </div>
      </div>

      <div className="relative z-[1]">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="text-caption text-sub mt-1 line-clamp-2">{description}</p>
      </div>

      {tags && tags.length > 0 && (
        <div className="relative z-[1] flex flex-wrap gap-1.5 mt-auto">
          {tags.map((tag) => (
            <span
              key={tag}
              className="
                font-mono text-nano tracking-wider uppercase
                px-2 py-0.5 rounded-xs
                bg-[var(--card)] border border-border text-sub
                transition-all duration-default
                group-hover:border-accent/15
                group-hover:text-accent
              "
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
