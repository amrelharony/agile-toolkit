"use client";

import { useEffect, useRef } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { MethodInputs } from "@/components/prioritization/method-inputs";
import {
  shortName,
  useMethodActions,
  type MethodInputsSlotProps,
  type MethodToolConfig,
} from "@/components/prioritization/method-tool";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem } from "@/lib/stores/workspace-types";
import { formatNumber } from "@/lib/prioritization/methods/fields";
import {
  MOSCOW_BUCKETS,
  MOSCOW_LABEL,
  MOSCOW_MEANING,
  moscowEffort,
  type MoscowBucket,
} from "@/lib/prioritization/methods/moscow";
import type { RankedRow } from "@/lib/prioritization/rank";
import { bucketOf, effortOf } from "./budget";

const NO_ITEMS: BacklogItem[] = [];

/**
 * MoSCoW's inputs in the method-tool shell: the bucket (required, never a
 * default: the form starts with none picked) and an optional effort for
 * the Must budget. A linked backlog item's job size replaces the effort,
 * so for a row (or an import) whose item has one, the job size shows in
 * its place, read-only: it's changed in the Backlog Prioritizer.
 */
export function MoscowInputs({
  method,
  draft,
  update,
  errors,
  custom,
  size,
  item,
}: MethodInputsSlotProps) {
  const jobSize = item ? moscowEffort(undefined, item) : null;
  return (
    <>
      <MethodInputs
        method={method}
        draft={draft}
        update={update}
        errors={errors}
        custom={custom}
        size={size}
        hide={jobSize !== null ? ["effort"] : undefined}
        labels={{ effort: "Effort (points, optional)" }}
      />
      {jobSize !== null && (
        <p className="text-sm text-sub">
          Effort: <span className="font-mono text-text">{formatNumber(jobSize, 2)}</span>{" "}
          {jobSize === 1 ? "point" : "points"} from the backlog job size.
        </p>
      )}
    </>
  );
}

/**
 * The row whose Move menu was just used. Moving a row re-renders it in
 * its new bucket's list (a new element), so its new Move button takes
 * focus back when it mounts.
 */
let refocusMove: string | null = null;

/** A row's effort (and where it came from) and its "Move to" menu. */
export function MoscowRowValues({
  ranked,
  config,
}: {
  ranked: RankedRow;
  config: MethodToolConfig;
}) {
  const items = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const actions = useMethodActions(config);
  const announce = useAnnounce();
  const trigger = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const { row } = ranked;
  const bucket = bucketOf(ranked);
  const { effort, source } = effortOf(ranked, items);

  useEffect(() => {
    if (refocusMove !== row.id) return;
    refocusMove = null;
    trigger.current?.focus();
  }, [row.id]);

  const move = (to: MoscowBucket) => {
    moved.current = true;
    refocusMove = row.id;
    actions.save(row.id, { title: row.title, bucket: to });
    announce(`Moved “${shortName(row.title)}” to ${MOSCOW_LABEL[to]}.`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-sub">
        {effort === null ? (
          <span className="font-sans">No effort</span>
        ) : (
          <>
            <span className="text-text">{formatNumber(effort, 2)}</span>{" "}
            {effort === 1 ? "point" : "points"}
            {source === "backlog" && <span className="font-sans"> · backlog job size</span>}
          </>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="outline"
            size="sm"
            aria-label={`${bucket ? "Move" : "Sort"} ${row.title}`}
          >
            <ArrowRightLeft aria-hidden="true" />
            {bucket ? "Move" : "Sort"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(e) => {
            // After a move the row lives in another list: its new button
            // takes focus (see refocusMove), not this one.
            if (!moved.current) return;
            moved.current = false;
            e.preventDefault();
          }}
        >
          <DropdownMenuLabel className="text-xs font-normal text-sub">
            {bucket ? "Move to" : "Sort into"}
          </DropdownMenuLabel>
          {MOSCOW_BUCKETS.filter((b) => b !== bucket).map((b) => (
            <DropdownMenuItem key={b} onSelect={() => move(b)} className="flex-col items-start">
              <span>{MOSCOW_LABEL[b]}</span>
              <span className="text-xs text-sub">{MOSCOW_MEANING[b]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
