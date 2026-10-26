"use client";

import Link from "next/link";
import { Gauge } from "lucide-react";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { MUST_BUDGET_MIN_SIZED, MUST_BUDGET_SHARE } from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/charts/chart-text";
import { budgetOf } from "./budget";
import { LIMIT_TEXT, budgetLine, excessText, pct } from "./verdict";

const NO_ITEMS: BacklogItem[] = [];

/**
 * The Must budget bar: the Musts' share of the planned effort (Must +
 * Should + Could; Won't is out of the plan) against a marker at the ~60%
 * limit, in words as well as width. Over the limit it turns to the danger
 * token and says how much Must effort to move down. It waits for three
 * planned items with an effort (a linked item's job size, else the row's
 * effort) and names the planned items that have none.
 */
export function MustBudgetPanel({ rows }: { rows: readonly RankedRow[] }) {
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const budget = budgetOf(rows, items);
  const share = budget.share;
  const width = share === null ? 0 : Math.min(100, Math.round(share * 100));

  return (
    <SectionCard title="Must budget" icon={Gauge}>
      <div className="space-y-3">
        {share === null ? (
          <NotEnoughData
            have={budget.sized}
            need={MUST_BUDGET_MIN_SIZED}
            unit={["planned item with an effort", "planned items with an effort"]}
            action="Size"
            what="how much of the plan the Musts take"
          />
        ) : (
          <>
            <p className={cn("text-sm", budget.over ? "text-danger" : "text-text")}>
              {budgetLine(budget)}
            </p>
            <div className="relative h-3 rounded-full bg-muted/40">
              <div
                role="meter"
                aria-label="Musts' share of the planned effort"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(share * 100)}
                aria-valuetext={`${pct(share)}, limit ${LIMIT_TEXT}`}
                className={cn(
                  "h-3 rounded-full",
                  budget.over
                    ? "bg-danger"
                    : share > MUST_BUDGET_SHARE - 0.1
                      ? "bg-warning"
                      : "bg-success"
                )}
                style={{ width: `${width}%` }}
              />
              {/* The limit marker: a line at 60% across the bar. */}
              <span
                aria-hidden="true"
                className="absolute -top-1 h-5 w-0.5 bg-text"
                style={{ left: `${MUST_BUDGET_SHARE * 100}%` }}
              />
            </div>
            <p className="text-xs text-sub">
              {budget.over
                ? excessText(budget)
                : `Inside the limit: the Shoulds and Coulds leave room to absorb surprises.`}
            </p>
          </>
        )}
        {budget.unsized > 0 && (
          <p className="text-xs text-sub">
            {plural(budget.unsized, "planned item has", "planned items have")} no effort: give{" "}
            {budget.unsized === 1 ? "it" : "them"} a job size in the{" "}
            <Link href="/prioritizer" className="text-accent underline-offset-2 hover:underline">
              Backlog Prioritizer
            </Link>{" "}
            or an effort here.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
