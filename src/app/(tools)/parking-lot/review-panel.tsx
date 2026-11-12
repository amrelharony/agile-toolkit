"use client";

import { useId, useRef, useState } from "react";
import { Check, CircleSlash, ListChecks } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { Button } from "@/components/ui/button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  PARKING_ROUTE_MAX_ITEMS,
  PARKING_ROUTE_TEXT_MAX,
  parkingRouteTask,
  type ParkingRouteInput,
} from "@/lib/ai/tasks/parking-lot";
import type { ParkingLotItem } from "@/lib/stores/workspace-types";
import {
  DESTINATION_LABEL,
  matchSuggestions,
  parkedWhen,
  type ParkingDestination,
  type RouteSuggestion,
} from "@/lib/parking-lot/model";
import { shortText } from "./item-row";

/** A suggestion as the review shows it: with the point's words when it was asked. */
export interface ShownSuggestion extends RouteSuggestion {
  text: string;
}

const SEND_DESTINATIONS = ["backlog", "impediment", "action"] as const;

/** What Amr is asked about: the open points, first 30, each cut to what the task takes. */
export function routeInput(open: readonly ParkingLotItem[]): ParkingRouteInput {
  return {
    items: open.slice(0, PARKING_ROUTE_MAX_ITEMS).map((i) => ({
      id: i.id,
      text: i.text.slice(0, PARKING_ROUTE_TEXT_MAX),
      ...(i.meeting ? { meeting: i.meeting.slice(0, 200) } : {}),
    })),
  };
}

/** Focus an element by a data attribute once React has re-rendered, else `fallback`. */
function focusSoon(attr: string, id: string | null, fallback: HTMLElement | null) {
  requestAnimationFrame(() => {
    const el = id
      ? Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
          (e) => e.getAttribute(attr) === id
        )
      : undefined;
    (el ?? fallback)?.focus();
  });
}

/**
 * The end-of-meeting review: the open points one card each, with a decision
 * a tap away (discussed, the backlog, an impediment, a retro action, or
 * drop), and "Ask Amr" for where each could go. Amr's suggestions change
 * nothing until the person accepts one (or all); each decision has Undo.
 */
export function ReviewPanel({
  open,
  now,
  sendBlocked,
  onDiscussed,
  onDecide,
  onDecideAll,
  decidedText,
}: {
  open: readonly ParkingLotItem[];
  now: Date;
  /** Why a point can't be sent (an example point), or null. */
  sendBlocked: (item: ParkingLotItem) => string | null;
  onDiscussed: (item: ParkingLotItem) => void;
  onDecide: (id: string, destination: ParkingDestination) => void;
  onDecideAll: (list: readonly RouteSuggestion[]) => void;
  /** What happened to the points in view, for the "all decided" line. */
  decidedText: string;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [suggestions, setSuggestions] = useState<{
    items: ShownSuggestion[];
    source: AiSource;
  } | null>(null);
  // Said once above the cards, not under each one (the example's points).
  const blockedNote = open.map(sendBlocked).find((b): b is string => Boolean(b)) ?? null;

  /** Decide one card, and move focus to the next card's first button (or the heading). */
  const decide = (item: ParkingLotItem, act: () => void) => {
    const at = open.findIndex((i) => i.id === item.id);
    const next = open[at + 1] ?? open[at - 1];
    act();
    focusSoon("data-review-first", next?.id ?? null, headingRef.current);
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 rounded-sm text-base font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
          End-of-meeting review
        </h2>
        <p className="mt-0.5 text-sm text-sub">
          {open.length === 0
            ? "Nothing open to decide."
            : `${open.length} open ${open.length === 1 ? "point" : "points"} to decide. Mark each one discussed, send it on, or drop it.`}
        </p>
        {blockedNote && <p className="mt-0.5 text-xs text-sub">{blockedNote}</p>}
      </div>

      {open.length > 0 && (
        <AiButton
          task={parkingRouteTask}
          input={() => routeInput(open)}
          onResult={(data, meta) => {
            const texts = new Map(open.map((i) => [i.id, i.text]));
            const items = matchSuggestions(data.routes, open).map((s) => ({
              ...s,
              text: texts.get(s.id) ?? "",
            }));
            setSuggestions({ items, source: meta.source });
          }}
          label="Ask Amr where each goes"
          fallbackLabel="Suggest where each goes"
        />
      )}

      {suggestions &&
        (suggestions.items.length > 0 ? (
          <AiSuggestions
            items={suggestions.items}
            title="Where each point could go"
            acceptLabel="Accept"
            source={suggestions.source}
            render={(s) => ({
              title: `${DESTINATION_LABEL[s.destination]}: ${shortText(s.text, 80)}`,
              detail: s.reason,
            })}
            onAccept={(s) => onDecide(s.id, s.destination)}
            onAcceptAll={(list) => onDecideAll(list)}
            onDismiss={() => {
              setSuggestions(null);
              headingRef.current?.focus();
            }}
          />
        ) : (
          <p role="status" className="text-xs text-sub">
            No suggestion fits the open points. Decide each one below.
          </p>
        ))}

      {open.length === 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-3 text-sm text-text"
        >
          <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          Every point here is decided. {decidedText}
        </p>
      ) : (
        <ol className="space-y-2" aria-label="Open points to decide">
          {open.map((item) => {
            const name = shortText(item.text);
            const blocked = sendBlocked(item);
            const meta = [
              item.meeting,
              item.raisedBy ? `raised by ${item.raisedBy}` : null,
              parkedWhen(item, now),
            ].filter(Boolean);
            return (
              <li key={item.id} className="rounded-lg border border-border bg-card p-3">
                <p className="break-words text-sm font-medium text-text">{item.text}</p>
                {meta.length > 0 && <p className="mt-0.5 text-xs text-sub">{meta.join(" · ")}</p>}
                <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    data-review-first={item.id}
                    aria-label={`Discussed: ${name}`}
                    onClick={() => decide(item, () => onDiscussed(item))}
                  >
                    <Check aria-hidden="true" />
                    Discussed
                  </Button>
                  {SEND_DESTINATIONS.map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(blocked)}
                      title={blocked ?? undefined}
                      aria-label={`${DESTINATION_LABEL[d]}: ${name}`}
                      onClick={() => decide(item, () => onDecide(item.id, d))}
                    >
                      {DESTINATION_LABEL[d]}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    aria-label={`Drop: ${name}`}
                    onClick={() => decide(item, () => onDecide(item.id, "drop"))}
                  >
                    <CircleSlash aria-hidden="true" />
                    Drop
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
