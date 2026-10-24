"use client";

import { Clock, History, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IceBreaker } from "@/lib/constants/icebreakers";
import { CATEGORY_COLORS, ENERGY_COLORS } from "../labels";
import { peopleLabel } from "../sizes";
import { FavoriteToggle } from "./favorite-toggle";

/** One activity in Browse All: open it, favourite it, see when it was last used. */
export function IcebreakerCard({
  icebreaker,
  isFavorite,
  usedText,
  onToggleFavorite,
  onSelect,
}: {
  icebreaker: IceBreaker;
  isFavorite: boolean;
  /** "Used 3 days ago" when it was used in the last two weeks. */
  usedText: string | null;
  onToggleFavorite: (id: string) => void;
  onSelect: (ib: IceBreaker) => void;
}) {
  return (
    // The title is the card's button; its ::after stretches over the whole
    // card so the card stays clickable, while the favourite toggle sits above
    // it (a clickable <Card> div was mouse-only, and a button can't contain
    // the favourite button).
    <Card className="relative bg-card border-border hover:border-accent-cyan/30 transition-all duration-200 cursor-pointer group">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
            <button
              type="button"
              onClick={() => onSelect(icebreaker)}
              className="text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent"
            >
              {icebreaker.name}
            </button>
          </CardTitle>
          <FavoriteToggle
            name={icebreaker.name}
            isFavorite={isFavorite}
            onToggle={() => onToggleFavorite(icebreaker.id)}
            className="relative z-10 p-1 -m-1"
          />
        </div>
        <CardDescription className="text-xs text-sub line-clamp-2">
          {icebreaker.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={`text-xs ${CATEGORY_COLORS[icebreaker.category]}`}>
            {icebreaker.category}
          </Badge>
          <Badge variant="outline" className="text-xs bg-cardH text-sub border-border">
            <Clock className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {icebreaker.timeMinutes}m
          </Badge>
          <Badge variant="outline" className="text-xs bg-cardH text-sub border-border">
            <Users className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {peopleLabel(icebreaker)}
          </Badge>
          <Badge variant="outline" className={`text-xs ${ENERGY_COLORS[icebreaker.energyLevel]}`}>
            <Zap className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {icebreaker.energyLevel}
          </Badge>
          {usedText && (
            <Badge
              variant="outline"
              className="text-xs bg-warning/10 text-warning border-warning/30"
            >
              <History className="w-3 h-3 mr-0.5" aria-hidden="true" />
              {usedText}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
