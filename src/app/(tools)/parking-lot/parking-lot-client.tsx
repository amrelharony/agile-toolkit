"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { SquareParking } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { generateParkingLotPrompts } from "@/lib/ai-prompts/parking-lot";
import { cheer } from "@/lib/celebrate/cheer";
import { findLink } from "@/lib/handoffs/registry";
import { sendHandoff, sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import { PARKING_LOT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ParkingLotItem, ParkingLotStatus } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  DESTINATION_ROUTE,
  PARKING_ROUTES,
  ROUTE_PLACE,
  changedFields,
  countedItems,
  editedParkingItem,
  matchesMeeting,
  meetingsOf,
  newParkingItem,
  normalizeParkingItem,
  parkingItems,
  parkingSource,
  parkingSummary,
  rememberedMeeting,
  summaryText,
  withParkingLinks,
  type MeetingFilter,
  type ParkingDestination,
  type ParkingRoute,
  type ParkingValues,
  type RouteSuggestion,
} from "@/lib/parking-lot/model";
import { CaptureForm } from "./capture-form";
import { buildExample } from "./example";
import { ParkingRow, shortText } from "./item-row";
import { toCsv, toMarkdown } from "./markdown";
import { ReviewPanel } from "./review-panel";
import {
  currentParkingItems,
  findParkingItem,
  patchParkingItem,
  removeParkingItem,
  saveParkingItem,
} from "./store";

export const TOOL_ID = "parking-lot";

type View = "list" | "review";

const ALL_MEETINGS = "all";
/** A meeting filter as a toggle value: "m:" + its key ("m:" alone is no meeting). */
const filterValue = (f: MeetingFilter) => (f === null ? ALL_MEETINGS : `m:${f}`);
const filterOf = (v: string): MeetingFilter => (v === ALL_MEETINGS ? null : v.slice(2));

const EXAMPLE_BLOCKED =
  "Example points stay here: clear the example and park your own to send them on.";

const nowIso = () => new Date().toISOString();
const fresh = (id: string) => normalizeParkingItem(findParkingItem(id));

/** Focus the text of the point with `id` (or `fallback`) once React has re-rendered. */
function focusSoon(id: string | null, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>("[data-parking-text]")).find(
          (e) => e.getAttribute("data-parking-text") === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/**
 * Parking Lot: off-topic points parked during a meeting, so the meeting
 * stays on track and nothing is lost. A point is captured on one line
 * (Enter parks it, the meeting is remembered), then decided at the end of
 * the meeting: discussed, sent to the backlog, the Impediment Tracker or
 * Retro Actions through the hand-off routes (with Undo, and a link both
 * ways), or dropped. Amr can suggest where each open point goes; the
 * person accepts each one. Everything lives in workspace.parkingLotItems,
 * which the agent verbs and the next step read too.
 */
export function ParkingLotClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.parkingLotItems);
  // Read so a point's "Sent to … · Open" follows its target being removed or finished.
  useWorkspaceStore((s) => s.stories);
  useWorkspaceStore((s) => s.impediments);
  useWorkspaceStore((s) => s.retroBoards);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [now] = useState(() => new Date());
  const [view, setView] = useState<View>("list");
  const [filterChoice, setFilterChoice] = useState<MeetingFilter>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const cleared = useRef<ParkingLotItem[]>([]);

  const items = useMemo(() => parkingItems(raw), [raw]);
  const meetings = useMemo(() => meetingsOf(items), [items]);
  // A meeting whose last point went drops out of the filter.
  const filter =
    filterChoice !== null && meetings.some((m) => m.key === filterChoice) ? filterChoice : null;
  const shown = useMemo(() => items.filter((i) => matchesMeeting(i, filter)), [items, filter]);
  const open = shown.filter((i) => i.status === "open");
  const decided = shown.filter((i) => i.status !== "open");
  const summary = parkingSummary(countedItems(shown));
  const hasExample = hasExampleItems(items);
  const exampleOnly = items.length > 0 && items.every((i) => isExampleId(i.id));
  const filterName =
    filter === null
      ? undefined
      : meetings.find((m) => m.key === filter)?.name || "No meeting named";
  // The export lists the team's own points while there are any.
  const exported = useMemo(() => countedItems(shown), [shown]);
  const markdown = useMemo(
    () => toMarkdown(exported, now, filterName),
    [exported, now, filterName]
  );
  const csv = useMemo(() => toCsv(exported), [exported]);
  const promptConfig = useMemo(
    () => ({ toolName: "Parking Lot", prompts: generateParkingLotPrompts(exported) }),
    [exported]
  );

  const sendBlocked = (item: Pick<ParkingLotItem, "id">) =>
    isExampleId(item.id) ? EXAMPLE_BLOCKED : null;

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's points aren't the team's history.
  const record = (
    item: Pick<ParkingLotItem, "id">,
    action: string,
    payload: Record<string, unknown>
  ) => {
    if (!isExampleId(item.id)) log(action, payload);
  };

  /** Amr's cheer when the team's last open point is decided, in the tick of its log. */
  const cheerIfClear = (item: Pick<ParkingLotItem, "id">) => {
    if (isExampleId(item.id)) return;
    const left = parkingItems(currentParkingItems()).filter(
      (i) => i.status === "open" && !isExampleId(i.id)
    );
    if (left.length === 0) cheer(TOOL_ID, "done");
  };

  const park = (values: ParkingValues) => {
    const item = saveParkingItem(newParkingItem(values, `parking_${nanoid(8)}`, nowIso()));
    record(item, PARKING_LOT_ACTIONS.ITEM_PARKED, {
      itemId: item.id,
      ...(item.meeting ? { meeting: item.meeting } : {}),
    });
    announce(`Parked “${shortText(item.text)}”`);
    captureRef.current?.focus();
  };

  /** Set a point's status with Undo; false when it is gone. */
  const changeStatus = (
    item: ParkingLotItem,
    status: ParkingLotStatus,
    label: string,
    action: string,
    payload: Record<string, unknown> = {}
  ): boolean => {
    const prev = findParkingItem(item.id);
    if (!prev) return false;
    undoable({
      label,
      apply: () => {
        saveParkingItem({ ...prev, status, updatedAt: nowIso() });
        record(item, action, { itemId: item.id, ...payload });
      },
      revert: () => {
        saveParkingItem(prev);
      },
    });
    announce(label);
    return true;
  };

  const markDiscussed = (item: ParkingLotItem) => {
    if (
      changeStatus(
        item,
        "discussed",
        `Marked “${shortText(item.text)}” discussed`,
        PARKING_LOT_ACTIONS.ITEM_DISCUSSED
      )
    ) {
      cheerIfClear(item);
    }
  };

  const drop = (item: ParkingLotItem) => {
    if (
      changeStatus(
        item,
        "dropped",
        `Dropped “${shortText(item.text)}”`,
        PARKING_LOT_ACTIONS.ITEM_DROPPED
      )
    ) {
      cheerIfClear(item);
    }
  };

  const reopen = (item: ParkingLotItem) => {
    changeStatus(
      item,
      "open",
      `Reopened “${shortText(item.text)}”`,
      PARKING_LOT_ACTIONS.ITEM_UPDATED,
      {
        fields: ["status"],
      }
    );
  };

  /**
   * The links store a send writes through: the point turns "sent" with its
   * first link, and Undo puts back the status it had before (`before`).
   */
  const linkStore = (id: string, before: ParkingLotStatus): HandoffLinkStore => ({
    getLinks: () => findParkingItem(id)?.sentTo,
    setLinks: (update) => {
      patchParkingItem(id, (x) => withParkingLinks(x, update(x.sentTo), before));
    },
  });

  /** Send a point on one route (Undo in the toast); false when nothing was sent. */
  const send = (item: ParkingLotItem, route: ParkingRoute): boolean => {
    const blocked = sendBlocked(item);
    if (blocked) {
      announce(blocked);
      return false;
    }
    const current = fresh(item.id);
    if (!current) return false;
    const link = sendHandoff(route, parkingSource(current), linkStore(item.id, current.status));
    if (!link) {
      announce(`“${shortText(item.text)}” is already on ${ROUTE_PLACE[route]}`);
      return false;
    }
    record(item, PARKING_LOT_ACTIONS.ITEM_SENT, {
      itemId: item.id,
      route,
      targetId: link.targetId,
    });
    announce(`Sent “${shortText(item.text)}” to ${ROUTE_PLACE[route]}`);
    return true;
  };

  const sendFromMenu = (item: ParkingLotItem, route: ParkingRoute) => {
    const wasOpen = item.status === "open";
    if (send(item, route) && wasOpen) cheerIfClear(item);
  };

  /** One decision from the review or an accepted suggestion. */
  const decide = (id: string, destination: ParkingDestination) => {
    const item = fresh(id);
    if (!item) return;
    if (item.status !== "open") {
      announce(`“${shortText(item.text)}” is already decided`);
      return;
    }
    if (destination === "drop") drop(item);
    else if (send(item, DESTINATION_ROUTE[destination])) cheerIfClear(item);
  };

  /** "Accept all": one send (and one Undo) per route, one for the drops. */
  const decideAll = (list: readonly RouteSuggestion[]) => {
    const todo = list
      .map((s) => ({ s, item: fresh(s.id) }))
      .filter((x): x is { s: RouteSuggestion; item: ParkingLotItem } => x.item?.status === "open");
    let done = 0;
    let skipped = 0;
    for (const route of PARKING_ROUTES) {
      const batch = todo.filter(
        (x) => x.s.destination !== "drop" && DESTINATION_ROUTE[x.s.destination] === route
      );
      const sendable = batch.filter((x) => !sendBlocked(x.item));
      skipped += batch.length - sendable.length;
      if (sendable.length === 0) continue;
      const before = new Map(sendable.map((x) => [x.item.id, findLink(x.item.sentTo, route)]));
      sendHandoffBatch(
        route,
        sendable.map((x) => ({
          src: parkingSource(x.item),
          links: linkStore(x.item.id, x.item.status),
        })),
        `Sent ${sendable.length === 1 ? "a point" : `${sendable.length} points`} to ${ROUTE_PLACE[route]}`
      );
      for (const x of sendable) {
        const link = findLink(findParkingItem(x.item.id)?.sentTo, route);
        if (!link || link.targetId === before.get(x.item.id)?.targetId) continue;
        done += 1;
        record(x.item, PARKING_LOT_ACTIONS.ITEM_SENT, {
          itemId: x.item.id,
          route,
          targetId: link.targetId,
        });
      }
    }
    const drops = todo.filter((x) => x.s.destination === "drop").map((x) => x.item);
    if (drops.length > 0) {
      const prevs = drops.map((d) => findParkingItem(d.id)).filter((d): d is ParkingLotItem => !!d);
      undoable({
        label:
          prevs.length === 1
            ? `Dropped “${shortText(prevs[0].text)}”`
            : `Dropped ${prevs.length} points`,
        apply: () => {
          const at = nowIso();
          for (const p of prevs) {
            saveParkingItem({ ...p, status: "dropped", updatedAt: at });
            record(p, PARKING_LOT_ACTIONS.ITEM_DROPPED, { itemId: p.id });
          }
        },
        revert: () => prevs.forEach(saveParkingItem),
      });
      done += prevs.length;
    }
    announce(
      `Decided ${done === 1 ? "1 point" : `${done} points`}${
        skipped > 0
          ? `; ${skipped} example ${skipped === 1 ? "point stays" : "points stay"} here`
          : ""
      }`
    );
    const first = todo.find((x) => !isExampleId(x.item.id));
    if (first && done > 0) cheerIfClear(first.item);
  };

  const save = (item: ParkingLotItem, values: ParkingValues) => {
    const current = findParkingItem(item.id);
    setEditingId(null);
    if (current) {
      const fields = changedFields(current, values);
      if (fields.length > 0) {
        patchParkingItem(item.id, (x) => editedParkingItem(x, values, nowIso()));
        record(item, PARKING_LOT_ACTIONS.ITEM_UPDATED, { itemId: item.id, fields });
        announce(`Saved “${shortText(values.text)}”`);
      }
    }
    focusSoon(item.id);
  };

  const startEdit = (item: ParkingLotItem | null) => {
    const closing = editingId;
    setEditingId(item?.id ?? null);
    if (!item && closing) focusSoon(closing);
  };

  const remove = (item: ParkingLotItem) => {
    let snapshot: ParkingLotItem | null = null;
    // Focus moves to the next point on screen (or the one before) as this one goes.
    const at = shown.findIndex((x) => x.id === item.id);
    const neighbour = shown[at + 1] ?? shown[at - 1];
    const label = `Deleted “${shortText(item.text)}”`;
    undoable({
      label,
      apply: () => {
        snapshot = removeParkingItem(item.id);
        record(item, PARKING_LOT_ACTIONS.ITEM_REMOVED, { itemId: item.id });
      },
      revert: () => {
        if (snapshot) saveParkingItem(snapshot);
        focusSoon(item.id);
      },
    });
    if (editingId === item.id) setEditingId(null);
    focusSoon(neighbour?.id ?? null, captureRef.current);
    announce(label);
  };

  // Loading is offered on an empty parking lot only, and neither it nor its
  // clearing is logged: the example isn't the team's work.
  const loadExample = () => {
    buildExample(new Date()).forEach(saveParkingItem);
  };
  const clearExample = () => {
    let removed: ParkingLotItem[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentParkingItems()
          .filter((i) => isExampleId(i.id))
          .map((i) => removeParkingItem(i.id))
          .filter((i): i is ParkingLotItem => i !== null);
      },
      revert: () => removed.forEach(saveParkingItem),
    });
    focusSoon(null, captureRef.current);
  };

  const clearDecided = () => {
    const ids = decided.map((i) => i.id);
    cleared.current = ids
      .map((id) => removeParkingItem(id))
      .filter((i): i is ParkingLotItem => i !== null);
    const own = cleared.current.filter((i) => !isExampleId(i.id)).length;
    if (own > 0) log(PARKING_LOT_ACTIONS.PARKING_LOT_RESET, { count: own });
    focusSoon(null, captureRef.current);
  };
  const undoClear = () => {
    cleared.current.forEach(saveParkingItem);
    cleared.current = [];
  };

  const rowProps = {
    now,
    offerAddToRoster: !exampleOnly,
    onDiscussed: markDiscussed,
    onDrop: drop,
    onReopen: reopen,
    onSend: sendFromMenu,
    onEdit: startEdit,
    onSave: save,
    onDelete: remove,
  };

  return (
    <ToolPageWrapper
      toolId="parking-lot"
      title="Parking Lot"
      description="Park off-topic points during a meeting, then send each one to the backlog, impediments or retro actions so none get lost."
      category="Ceremonies"
    >
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the parking lot…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExample && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: points from a Sprint Planning and a Daily Scrum. They are never sent to
                other tools{exampleOnly ? "" : ", and they aren't counted while you have your own"}.
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="parking-lot"
                markdown={markdown}
                clipboardText={markdown}
                csvData={csv}
                jsonData={exported}
              />
            </div>
          )}

          <SectionCard title="Park a point" icon={SquareParking}>
            <CaptureForm
              ref={captureRef}
              onPark={park}
              meeting={() => rememberedMeeting(parkingItems(currentParkingItems()))}
              offerAddToRoster={!exampleOnly}
            />
          </SectionCard>

          {items.length === 0 ? (
            <EmptyState icon={SquareParking} action={<LoadExampleButton onLoad={loadExample} />}>
              Nothing parked yet. When a point comes up off topic, type it above and press Enter:
              the meeting stays on track, and the point waits here for the end of the meeting.
            </EmptyState>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <ToggleGroup<View>
                  label="View"
                  value={view}
                  onValueChange={setView}
                  options={[
                    { value: "list", label: "All points" },
                    { value: "review", label: "End-of-meeting review" },
                  ]}
                />
                {meetings.length > 1 && (
                  <ToggleGroup<string>
                    label="Meeting"
                    size="sm"
                    value={filterValue(filter)}
                    onValueChange={(v) => setFilterChoice(filterOf(v))}
                    options={[
                      { value: ALL_MEETINGS, label: "All meetings" },
                      ...meetings.map((m) => ({
                        value: filterValue(m.key),
                        label: `${shortText(m.name || "No meeting named", 32)} (${m.open} open)`,
                      })),
                    ]}
                  />
                )}
              </div>

              <KpiGrid cols={4} marginBottom="none">
                <StatCard variant="compact" label="Open" value={summary.open} hint="To decide" />
                <StatCard
                  variant="compact"
                  label="Discussed"
                  value={summary.discussed}
                  hint="Settled in the meeting"
                />
                <StatCard
                  variant="compact"
                  label="Sent"
                  value={summary.sent}
                  hint="Backlog, impediments, actions"
                />
                <StatCard
                  variant="compact"
                  label="Dropped"
                  value={summary.dropped}
                  hint="No longer needed"
                />
              </KpiGrid>

              {view === "review" ? (
                <ReviewPanel
                  open={open}
                  now={now}
                  sendBlocked={sendBlocked}
                  onDiscussed={markDiscussed}
                  onDecide={decide}
                  onDecideAll={decideAll}
                  decidedText={summaryText(parkingSummary(shown))}
                />
              ) : (
                <>
                  <section aria-labelledby="parking-open" className="space-y-2">
                    <h2 id="parking-open" className="text-sm font-semibold text-text">
                      Open ({open.length})
                    </h2>
                    {open.length === 0 ? (
                      <p className="text-sm text-sub">
                        No open points{filterName ? ` from ${filterName}` : ""}. Everything parked
                        is decided.
                      </p>
                    ) : (
                      <ul className="space-y-2" aria-label="Open points, in the order parked">
                        {open.map((item) => (
                          <ParkingRow
                            key={item.id}
                            item={item}
                            editing={editingId === item.id}
                            sendBlocked={sendBlocked(item)}
                            {...rowProps}
                          />
                        ))}
                      </ul>
                    )}
                  </section>

                  {decided.length > 0 && (
                    <section aria-labelledby="parking-decided" className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 id="parking-decided" className="text-sm font-semibold text-text">
                          Decided ({decided.length})
                        </h2>
                        <ResetButton
                          label="Clear decided points"
                          title="Clear the decided points?"
                          description={`${decided.length} discussed, sent or dropped ${
                            decided.length === 1 ? "point leaves" : "points leave"
                          } the parking lot${filterName ? ` (${filterName} only)` : ""}. What was sent to other tools stays there.`}
                          confirmLabel="Clear points"
                          doneLabel={`Cleared ${decided.length} decided ${
                            decided.length === 1 ? "point" : "points"
                          }`}
                          onReset={clearDecided}
                          onUndo={undoClear}
                        />
                      </div>
                      <ul className="space-y-2" aria-label="Decided points">
                        {decided.map((item) => (
                          <ParkingRow
                            key={item.id}
                            item={item}
                            editing={editingId === item.id}
                            sendBlocked={sendBlocked(item)}
                            {...rowProps}
                          />
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
