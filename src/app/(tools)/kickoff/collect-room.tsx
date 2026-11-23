"use client";

/**
 * "Collect from the room": an Audience Wall room for the kickoff's people,
 * who post answers from their phones without names. Kickoff hosts no room of
 * its own: this is the Audience Wall's room kind and channel
 * (`tool="audience-wall"`), loaded only when asked for, as Sprint Review's
 * feedback room is.
 *
 * Only list sections with no owner column can take the answers: a line
 * with an owner would name its poster. Nothing reaches the kickoff until the
 * host picks the section (there is no default) and presses Save round; each
 * post then becomes a line, most upvoted first, with the duplicates merged
 * into it as "(also: …)", cut to the item cap, and only as many as the
 * section has room for (the page says how many didn't fit). The kit's Undo
 * takes the whole round back out.
 *
 * While it is live it registers with Amr's live-wall registry (counts
 * only), so his Audience Wall room verbs reach it, and tells the page
 * (`onLiveChange`), which asks before showing another kickoff would end it.
 */

import { useEffect, useId, useRef, useState } from "react";
import { WallRoomHost } from "@/components/collab/wall-room/wall-room-host";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { registerLiveWall } from "@/lib/audience-wall/live";
import { KICKOFF_ACTIONS } from "@/lib/history/event-actions";
import type { KickoffFormatDef, KickoffSectionDef } from "@/lib/kickoff/formats";
import {
  cutLine,
  formatOf,
  itemsOf,
  newKickoffItemId,
  withSectionItems,
} from "@/lib/kickoff/model";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import type { WallRoundResult } from "@/lib/realtime/wall-room/protocol";
import type { WallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import { lineKey, roomLeft } from "@/lib/sectioned/model";
import { KICKOFF_ITEM_MAX, type KickoffItem } from "@/lib/stores/workspace-types";
import type { KickoffHandle } from "./kickoff-handle";

/** The room's kind of wall, as Amr's room_status reports it. */
export const KICKOFF_ROOM_KIND = "kickoff";

/** The sections a room's answers may go in: lists with no owner column. */
export function roomTargets(format: KickoffFormatDef): KickoffSectionDef[] {
  return format.sections.filter((d) => d.kind === "list" && !d.owner);
}

/** A room post as a kickoff line: its text, then the duplicates merged into it. */
export function lineFromPost(p: WallRoundResult["posts"][number]): string {
  const also = p.merged.length > 0 ? ` (also: ${p.merged.join("; ")})` : "";
  return cutLine(`${p.text}${also}`, KICKOFF_ITEM_MAX);
}

/**
 * The round's posts as lines for a section, most upvoted first (the kit's
 * order), leaving out lines it already holds and repeats, cut to its room.
 * `left` counts the ones that didn't fit.
 */
export function linesFromRound(
  result: WallRoundResult,
  def: KickoffSectionDef,
  current: readonly KickoffItem[],
  newId: () => string = newKickoffItemId
): { items: KickoffItem[]; left: number } {
  const seen = new Set(current.map((i) => lineKey(i.text)));
  const texts: string[] = [];
  for (const p of result.posts) {
    const text = lineFromPost(p);
    const key = lineKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    texts.push(text);
  }
  const room = roomLeft(def, current);
  return {
    items: texts.slice(0, room).map((text) => ({ id: newId(), text })),
    left: Math.max(0, texts.length - room),
  };
}

export function CollectRoom({
  handle,
  crypto: cryptoImpl,
  onLiveChange,
}: {
  handle: KickoffHandle;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
  /**
   * The room is live, with whether its round holds answers a new round (or
   * the room ending) would lose; null once it ends. The page asks before
   * anything else would end it.
   */
  onLiveChange?: (room: { unsaved: boolean } | null) => void;
}) {
  const { kickoff: k, read, write, log } = handle;
  const announce = useAnnounce();
  const format = formatOf(k);
  const targets = roomTargets(format);
  const [target, setTarget] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pickId = useId();

  const save = (result: WallRoundResult) => {
    const def = targets.find((d) => d.id === target);
    if (!def) {
      setProblem("Pick the section these answers go in, then save the round.");
      document.getElementById(pickId)?.focus();
      return false;
    }
    const cur = read();
    if (!cur) return false;
    const { items, left } = linesFromRound(result, def, itemsOf(cur, def.id));
    if (items.length === 0) {
      setProblem(
        roomLeft(def, itemsOf(cur, def.id)) === 0
          ? `“${def.label}” is full. Delete a line there, or pick another section.`
          : "No new answers to add from this round."
      );
      return false;
    }
    const w = write((c, now) =>
      withSectionItems(c, def.id, [...itemsOf(c, def.id), ...items], now)
    );
    if (!w.ok) {
      setProblem(w.message ?? "The answers couldn't be added.");
      return false;
    }
    const ids = new Set(items.map((i) => i.id));
    log(KICKOFF_ACTIONS.ITEMS_COLLECTED, { kickoffId: k.id, section: def.id, count: items.length });
    setProblem(null);
    setNote(
      left > 0
        ? `${left} ${left === 1 ? "answer" : "answers"} didn't fit: “${def.label}” holds ${def.max}.`
        : null
    );
    announce(
      `Added ${items.length} ${items.length === 1 ? "answer" : "answers"} from the room to “${def.label}”.`
    );
    return () => {
      write((c, now) =>
        withSectionItems(
          c,
          def.id,
          itemsOf(c, def.id).filter((i) => !ids.has(i.id)),
          now
        )
      );
    };
  };

  const chosen = targets.find((d) => d.id === target);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={pickId} className="text-sm font-medium text-text">
          Put the answers in
        </label>
        <select
          id={pickId}
          className={SELECT_CLASS}
          value={target}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${pickId}-problem` : `${pickId}-hint`}
          onChange={(e) => {
            setTarget(e.target.value);
            setProblem(null);
          }}
        >
          <option value="">Pick a section</option>
          {targets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        {problem ? (
          <p id={`${pickId}-problem`} role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : (
          <p id={`${pickId}-hint`} className="text-xs text-sub">
            Sections with an owner aren&apos;t offered: an answer there would name its poster.
          </p>
        )}
      </div>
      <WallRoomHost
        tool="audience-wall"
        toolName="Audience Wall"
        startLabel="Open the room"
        description="People post answers from their phones, without names. Nothing reaches the kickoff until you pick a section and press Save round."
        defaultPrompt={(chosen ?? targets[0])?.prompt}
        promptSuggestions={targets.map((d) => d.prompt)}
        defaultMode="hidden"
        crypto={cryptoImpl}
        onSave={save}
      >
        {(room, { unsaved }) => (
          <LiveRoom room={room} unsaved={unsaved} onLiveChange={onLiveChange} />
        )}
      </WallRoomHost>
      {note && (
        <p role="status" className="text-sm text-sub">
          {note}
        </p>
      )}
    </div>
  );
}

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Mounted only while the room is live: registers it for Amr (counts only),
 * and tells the page it is live (and whether its round holds unsaved
 * answers) until it ends.
 */
function LiveRoom({
  room,
  unsaved,
  onLiveChange,
}: {
  room: WallRoom;
  unsaved: boolean;
  onLiveChange?: (room: { unsaved: boolean } | null) => void;
}) {
  const roomRef = useRef(room);
  roomRef.current = room;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const liveRef = useRef(onLiveChange);
  liveRef.current = onLiveChange;

  useEffect(() => {
    liveRef.current?.({ unsaved });
  }, [unsaved]);
  useEffect(() => () => liveRef.current?.(null), []);

  useEffect(
    () =>
      registerLiveWall({
        status: () => {
          const r = roomRef.current;
          return {
            prompt: r.round?.prompt ?? null,
            open: r.round?.open ?? false,
            mode: r.round?.mode ?? "hidden",
            posts: r.round?.count ?? 0,
            shown: Boolean(r.round && r.round.posts !== null),
            hands: r.hands.length,
            people: r.members.length,
            scoring: r.round?.scoring ?? null,
            kind: KICKOFF_ROOM_KIND,
            unsaved: unsavedRef.current,
          };
        },
        openRound: (prompt, mode) => roomRef.current.openRound(prompt, mode),
        setOpen: (open) => roomRef.current.setOpen(open),
        reveal: () => roomRef.current.reveal(),
        lowerAllHands: () => roomRef.current.lowerAllHands(),
      }),
    []
  );

  return null;
}
