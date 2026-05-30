"use client";

/**
 * Tab 1 — MoSCoW. Groups items into Must/Should/Could/Won't cards, each
 * listing its items as colored badges.
 */

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BacklogItem, MoSCoWCategory } from "../types";
import { MOSCOW_CONFIG } from "../constants";

export function MoSCoWTab({ items }: { items: BacklogItem[] }) {
  const groups = useMemo(() => {
    const result = {} as Record<MoSCoWCategory, BacklogItem[]>;
    (Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).forEach((k) => {
      result[k] = items.filter((i) => i.moscow === k);
    });
    return result;
  }, [items]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {(Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).map((category) => {
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
    </div>
  );
}
