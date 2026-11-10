"use client";

import Link from "@/components/motion/transition-link";
import { Gauge } from "lucide-react";
import { shortName } from "@/components/prioritization/method-tool";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { MUST_BUDGET_MIN_SIZED, MUST_BUDGET_SHARE } from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { cn } from "@/lib/utils";
import { listAnd, plural } from "@/lib/charts/chart-text";
import { budgetOf, unsizedPlanned } from "./budget";
import { LIMIT_TEXT, bucketCounts, budgetLine, excessText, pct, unsizedMustsText } from "./verdict";

const NO_ITEMS: BacklogItem[] = [];

/** The unsized items named in full; past this many, "and 3 more". */
const MAX_NAMED = 5;

/**
 * The planned items with no effort, by name, and where each gets one: a
 * backlog item its job size in the Backlog Prioritizer (the row's own
 * effort doesn't count for it), any other row an effort through Edit.
 */
function MissingEffort({ missing }: { missing: ReturnType<typeof unsizedPlanned> }) {
  const named = missing.slice(0, MAX_NAMED).map((m) => `“${shortName(m.ranked.row.title)}”`);
  const rest = missing.length - named.length;
  const names = listAnd(rest > 0 ? [...named, `${rest} more`] : named);
  const linked = missing.filter((m) => m.linked).length;
  const other = missing.length - linked;
  const prioritizer = (
    <Link href="/prioritizer" className="text-accent underline-offset-2 hover:underline">
      Backlog Prioritizer
    </Link>
  );
  return (
    <p className="text-xs text-sub">
      {plural(missing.length, "planned item has", "planned items have")} no effort: {names}.{" "}
      {linked > 0 && other === 0 ? (
        <>
          Give {linked === 1 ? "it" : "them"} a job size in the {prioritizer}.
        </>
      ) : linked === 0 ? (
        `Use Edit on ${other === 1 ? "the row to give it" : "each row to give them"} an effort.`
      ) : (
        <>
          Give the backlog {linked === 1 ? "item" : "items"} a job size in the {prioritizer}, and
          use Edit to give the {other === 1 ? "other one" : "others"} an effort.
        </>
      )}
    </p>
  );
}

/**
 * The Must budget bar: the Musts' share of the planned effort (Must +
 * Should + Could; Won't is out of the plan) against a marker at the ~60%
 * limit, in words as well as width. Over the limit it turns to the danger
 * token and says how much Must effort to move down. It waits for three
 * planned items with an effort (a linked item's job size, else the row's
 * effort) and names the planned items that have none. An unsized Must
 * isn't in the share, so while one is, the share reads as a floor ("at
 * least") and never as inside the limit; with no Must sized there's no
 * bar at all.
 */
export function MustBudgetPanel({ rows }: { rows: readonly RankedRow[] }) {
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const budget = budgetOf(rows, items);
  const musts = bucketCounts(rows).must;
  const missing = unsizedPlanned(rows, items);
  const share = budget.share;
  const unjudged = share !== null && musts > 0 && budget.unsizedMusts >= musts;
  const floor = share !== null && !unjudged && budget.unsizedMusts > 0;
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
        ) : unjudged ? (
          <p className="text-sm text-text">
            {unsizedMustsText(budget, musts)}, so the budget can&apos;t be judged: size{" "}
            {musts === 1 ? "it" : "them"} first.
          </p>
        ) : (
          <>
            <p className={cn("text-sm", budget.over ? "text-danger" : "text-text")}>
              {budgetLine(budget, musts)}
            </p>
            <div className="relative h-3 rounded-full bg-muted/40">
              <div
                role="meter"
                aria-label="Musts' share of the planned effort"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(share * 100)}
                aria-valuetext={`${floor ? "at least " : ""}${pct(share)}, limit ${LIMIT_TEXT}`}
                className={cn(
                  "h-3 rounded-full",
                  budget.over
                    ? "bg-danger"
                    : floor || share > MUST_BUDGET_SHARE - 0.1
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
                : floor
                  ? `At least ${pct(share)}: ${unsizedMustsText(budget, musts)}, so the share can only rise.`
                  : `Inside the limit: the Shoulds and Coulds leave room to absorb surprises.`}
            </p>
          </>
        )}
        {missing.length > 0 && <MissingEffort missing={missing} />}
      </div>
    </SectionCard>
  );
}
