"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The heart on a card: a pressed toggle named after the activity, so a
 * screen reader hears "Add Two Truths and a Lie to favorites", not "Favorite".
 */
export function FavoriteToggle({
  name,
  isFavorite,
  onToggle,
  size = "sm",
  className,
}: {
  name: string;
  isFavorite: boolean;
  onToggle: () => void;
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={`${isFavorite ? "Remove" : "Add"} ${name} ${isFavorite ? "from" : "to"} favorites`}
      aria-pressed={isFavorite}
      className={cn(
        "min-touch-coarse shrink-0 inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
    >
      <Heart
        aria-hidden="true"
        className={cn(
          "transition-all duration-200",
          size === "lg" ? "w-5 h-5" : "w-4 h-4",
          isFavorite
            ? "fill-accent-magenta text-accent-magenta"
            : "text-sub hover:text-accent-magenta"
        )}
      />
    </button>
  );
}
