"use client";

/**
 * A tool's entry point for a wall room (Audience Wall): "Open a live wall"
 * asks for a name and consent, then opens the room; no key or channel
 * exists before that, and the open room's own module (./host-wall-room)
 * loads only then. The host puts a prompt up, chooses "Show posts as
 * they arrive" or "Hidden until I reveal them", and runs the wall: Reveal
 * (which also stops new posts: one sent later would show on its own), stop
 * or start taking posts, Hide a post, Merge duplicates, mark a
 * question Answered (`answerable`), lower a raised hand or all of them, New
 * round, End room. `roundOptions` opens every round with brainwriting's
 * "Yes, and…"; a 25/10 round's scoring is the tool's to start and show
 * (`room.setScoring`, in the render prop).
 *
 * While a round is hidden until reveal, this page holds no post text: only
 * the count shows (`useWallRoom`'s view has no posts then). Nothing is kept
 * unless the host presses Save round, and then only the prompt and each
 * post's text and votes go to the tool's `onSave`: no ids, no names.
 *
 *   <WallRoomHost tool="audience-wall" toolName="Audience Wall" onSave={saveWall} />
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { LiveRoomLimits } from "@/components/collab/run-modes";
import { liveOnlyReason } from "@/components/collab/live-room-reasons";
import type { SaveRound } from "@/components/collab/vote-room/save-round";
import { signalGamification } from "@/lib/gamification/signal";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import type { WallMode, WallRoomTool, WallRoundResult } from "@/lib/realtime/wall-room/protocol";
import type { WallRoundOptions } from "@/lib/realtime/wall-room/host";
import type { WallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import { toast } from "@/lib/utils/toast";
import type { WallSession } from "./host-wall-room";

export interface WallRoomHostProps {
  tool: WallRoomTool;
  /** Shown in the consent title and the panel, e.g. "Audience Wall". */
  toolName: string;
  /**
   * Save round: the prompt and each post's text and votes, once per round.
   * Return an undo to get Undo in the kit's toast, or false when nothing was
   * stored (Save round stays).
   */
  onSave: SaveRound<WallRoundResult>;
  /** Shown under the posts, before Save round (the tool's own view of them). */
  renderResults?: (result: WallRoundResult) => ReactNode;
  /** The first round's prompt, prefilled. */
  defaultPrompt?: string;
  defaultMode?: WallMode;
  /** What every round opens with (brainwriting's "Yes, and…"). */
  roundOptions?: WallRoundOptions;
  /** Questions: the host's list offers Answered on each post. */
  answerable?: boolean;
  /** Prompts the host can pick under the Prompt field (a demo item each, a starter). */
  promptSuggestions?: readonly string[];
  /** The start button's words. */
  startLabel?: string;
  /** One line under the start button. */
  description?: ReactNode;
  /**
   * The tool's own host controls while the room is live. `unsaved`: the
   * round holds posts a new round would clear (not saved yet, or hidden
   * until reveal), as New round's question to the host says.
   */
  children?: (room: WallRoom, round: { unsaved: boolean }) => ReactNode;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

/** The open room (./host-wall-room): it loads once the host has agreed to open one. */
const HostWallRoom = dynamic(() => import("./host-wall-room").then((m) => m.HostWallRoom), {
  ssr: false,
  loading: () => <p className="text-sm text-sub">Preparing the wall…</p>,
});

export function WallRoomHost({
  startLabel = "Open a live wall",
  description,
  crypto,
  ...rest
}: WallRoomHostProps) {
  const { tool, toolName } = rest;
  const availability = useVoteRoomsAvailable(crypto);
  const [consentOpen, setConsentOpen] = useState(false);
  const [session, setSession] = useState<WallSession | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (session || !refocus.current) return;
    refocus.current = false;
    startRef.current?.focus();
  }, [session]);

  if (session) {
    return (
      <HostWallRoom
        key={session.code}
        {...rest}
        crypto={crypto}
        session={session}
        onClosed={() => {
          clearVisitorIdentity(session.code);
          refocus.current = true;
          setSession(null);
        }}
      />
    );
  }

  const pending = availability.reason === "auth-pending";
  const reason = liveOnlyReason(availability.reason);
  if (!availability.available && !pending) {
    return reason ? <p className="text-sm text-sub">{reason}</p> : null;
  }

  return (
    <div className="space-y-2">
      {description && <div className="text-sm text-sub">{description}</div>}
      <LiveRoomLimits />
      <Button
        ref={startRef}
        type="button"
        variant="toolkit"
        className="gap-1.5"
        disabled={pending}
        onClick={() => setConsentOpen(true)}
      >
        <MessagesSquare className="h-4 w-4" aria-hidden="true" />
        {startLabel}
      </Button>
      {pending && (
        <p role="status" className="text-xs text-sub">
          Checking whether live rooms work here…
        </p>
      )}
      <VisitorRoomConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        mode="start"
        variant="wall"
        toolName={toolName}
        onConfirm={(name) => {
          const code = newVisitorRoomCode();
          const identity = saveVisitorIdentity(code, name);
          if (!identity) {
            toast.error("Couldn't start the room. Try again.");
            return;
          }
          setConsentOpen(false);
          setSession({ code, identity, startedAt: Date.now() });
          signalGamification("invite-created", { toolId: tool });
        }}
      />
    </div>
  );
}
