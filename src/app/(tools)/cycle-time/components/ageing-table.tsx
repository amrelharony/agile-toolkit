"use client";

/**
 * Ageing work in progress: the stories and cards in progress or in review
 * on either board, oldest first, aged like a cycle time (the start day is
 * 1). One older than the finished items' P85 is tinted: it's likely to
 * miss the service-level expectation. A blocked one can be raised as an
 * impediment in one step.
 */

import { AlertTriangle, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { SendToMenu } from "@/components/handoff/send-to-menu";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Impediment } from "@/lib/stores/workspace-types";
import type { AgeingItem } from "@/lib/flow";
import type { HandoffLink } from "@/lib/handoffs/types";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<string, string> = { in_progress: "In progress", review: "Review" };
/** Where an item is, as a phrase: "is blocked (in review for 3 days)". */
const STAGE_PHRASE: Record<string, string> = { in_progress: "in progress", review: "in review" };

/** The impediment raised from a blocked item: its title, stage and age. */
export function blockedTitle(a: Pick<AgeingItem, "title" | "stage" | "ageDays">): string {
  const age = a.ageDays === 1 ? "1 day" : `${a.ageDays} days`;
  return `${a.title} is blocked (${STAGE_PHRASE[a.stage] ?? "in progress"} for ${age})`;
}
const KIND_LABEL = { story: "Sprint board", card: "Flow board" } as const;

export const CYCLE_TIME_TOOL = "cycle-time";

/**
 * Where an item was raised as an impediment: the impediments that came
 * from it. Read from the impediments, since a story or card keeps no links
 * of its own, so "Sent · Open" survives a reload and Undo of the send.
 */
export function impedimentLinks(impediments: readonly Impediment[], itemId: string): HandoffLink[] {
  return impediments
    .filter((i) => i.sourceRef?.tool === CYCLE_TIME_TOOL && i.sourceRef.id === itemId)
    .map((i) => ({ route: "impediment", targetId: i.id, at: i.raisedAt }));
}

export function AgeingTable({
  items,
  sleDays,
  preview,
}: {
  items: AgeingItem[];
  /** The SLE the ages are checked against (the P85), once it may be quoted. */
  sleDays: number | null;
  /** Example items can't be sent anywhere. */
  preview: boolean;
}) {
  const impediments = useWorkspaceStore((s) => s.impediments) ?? [];
  const columns: DataTableColumn<AgeingItem>[] = [
    {
      key: "title",
      header: "Item",
      primary: true,
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm", a.overP85 ? "font-medium text-warning" : "text-text")}>
            {a.title}
          </span>
          {a.blocked && (
            <Badge variant="outline" className="gap-1 border-danger/40 text-xs text-danger">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Blocked
            </Badge>
          )}
        </span>
      ),
    },
    { key: "stage", header: "Stage", cell: (a) => STAGE_LABEL[a.stage] ?? a.stage },
    { key: "board", header: "Board", hiddenBelow: "lg", cell: (a) => KIND_LABEL[a.kind] },
    { key: "owner", header: "Owner", cell: (a) => a.owner ?? <span className="text-sub">—</span> },
    {
      key: "age",
      header: "Age",
      align: "right",
      sortValue: (a) => a.ageDays,
      cell: (a) => (
        <span className={cn("font-data", a.overP85 ? "font-semibold text-warning" : "text-text")}>
          {a.overP85 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
          {a.ageDays === 1 ? "1 day" : `${a.ageDays} days`}
          {a.overP85 && sleDays !== null && (
            <span className="sr-only">, older than the {sleDays}-day SLE</span>
          )}
        </span>
      ),
    },
    {
      key: "send",
      header: <span className="sr-only">Send</span>,
      sortLabel: "Send",
      align: "right",
      cell: (a) =>
        a.blocked && !preview ? (
          <SendToMenu
            routes={["impediment"]}
            item={{
              title: blockedTitle(a),
              ...(a.owner ? { owner: a.owner, raisedBy: a.owner } : {}),
              sourceRef: { tool: CYCLE_TIME_TOOL, id: a.id },
            }}
            sentTo={impedimentLinks(impediments, a.id)}
            getLinks={() => impedimentLinks(useWorkspaceStore.getState().impediments ?? [], a.id)}
            // The links are read back from the impediments, so there is nothing to store.
            onLinksChange={() => undefined}
          />
        ) : null,
    },
  ];
  return <DataTable columns={columns} rows={items} rowKey={(a) => `${a.kind}:${a.id}`} />;
}
