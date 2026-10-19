"use client";

import { Star } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useToolPrefs } from "@/lib/tools/tool-prefs";
import { cn } from "@/lib/utils";

/**
 * Star this tool from its own page. Favorites used to be reachable only from
 * the home grid's cards; they show on the home page ("Continue where you
 * left off"), in the sidebar and in search.
 */
export function FavoriteButton({ toolId, toolName }: { toolId: string; toolName: string }) {
  const { isFavorite, toggleFavorite } = useToolPrefs();
  const favorited = isFavorite(toolId);
  return (
    <IconButton
      variant="outline"
      label={favorited ? `Remove ${toolName} from favorites` : `Add ${toolName} to favorites`}
      aria-pressed={favorited}
      onClick={() => toggleFavorite(toolId)}
      icon={
        <Star
          className={cn("h-4 w-4", favorited ? "text-warning" : "text-sub")}
          fill={favorited ? "currentColor" : "none"}
          aria-hidden="true"
        />
      }
    />
  );
}
