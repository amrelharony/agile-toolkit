"use client";

/**
 * Tab 1 — MoSCoW. Groups items into Must/Should/Could/Won't cards, each
 * listing its items as colored badges, then "Not sorted yet".
 *
 * The bucket is the method registry's reading of the item (old-default
 * fingerprints cleared), the one the items table, All methods, the MoSCoW
 * tool and the agent's list_state use: an item whose only bucket is the
 * old "Add item" default reads as Not sorted yet everywhere.
 */

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { evaluateItemIn } from "@/lib/prioritization/methods";
import { isMoscowBucket } from "@/lib/prioritization/methods/moscow";
import type { BacklogItem, MoSCoWCategory } from "../types";
import { MOSCOW_CONFIG } from "../constants";

const CATEGORIES = Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[];

export function MoSCoWTab({ items }: { items: BacklogItem[] }) {
  const { groups, unsorted } = useMemo(() => {
    const result = Object.fromEntries(CATEGORIES.map((k) => [k, [] as BacklogItem[]])) as Record<
      MoSCoWCategory,
      BacklogItem[]
    >;
    const rest: BacklogItem[] = [];
    for (const item of items) {
      const bucket = evaluateItemIn(item, [], "moscow").bucket;
      if (isMoscowBucket(bucket)) result[bucket].push(item);
      else rest.push(item);
    }
    return { groups: result, unsorted: rest };
  }, [items]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {CATEGORIES.map((category) => {
        const cfg = MOSCOW_CONFIG[category];
        const groupItems = groups[category];
        return (
          <Card key={category} className={`bg-surface border ${cfg.borderColor}`}>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-display">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: cfg.color }}
                />
                <span style={{ color: cfg.color }}>{cfg.label}</span>
                <span className="ml-auto text-xs text-sub font-data">
                  {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {groupItems.length === 0 ? (
                <p className="text-xs text-sub italic">No items in this category</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupItems.map((item) => (
                    <Badge
                      key={item.id}
                      className={`${cfg.bg} ${cfg.borderColor} border text-sm font-normal`}
                      style={{ color: cfg.color }}
                    >
                      {item.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {unsorted.length > 0 && (
        <Card className="bg-surface border border-border sm:col-span-2">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm font-display text-sub">
              Not sorted yet
              <span className="ml-auto text-xs font-data">
                {unsorted.length} item{unsorted.length !== 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {unsorted.map((item) => (
                <Badge
                  key={item.id}
                  variant="outline"
                  className="border-border text-sm font-normal text-sub"
                >
                  {item.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
