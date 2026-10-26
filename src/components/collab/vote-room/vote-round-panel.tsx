"use client";

/**
 * A tool's entry point for an anonymous round (Health Check, Psych Safety,
 * Mood Tracker):
 *
 *   <VoteRoundPanel tool="health-check" toolName="Health Check"
 *     questionnaire={q} minN={MIN_SAMPLE.anonymous} onSave={saveRound} />
 *
 * With live rooms available, "Run a live round" asks for a name and
 * consent, then mounts `HostVoteRoom`: no key or channel exists before
 * that. "Enter counts instead" (and, when live rooms are off, the only
 * option, with a one-line reason) is `FacilitatorTally`: counted hands or
 * paper, same totals, same minN rule, same `onSave`.
 *
 * Live rounds run for every host, the owner included (see
 * `vote-room/protocol.ts`); squad guests count by hand. The panel writes
 * nothing itself: `onSave` gets an aggregates-only `VoteRoundResult` when
 * the host presses Save round.
 */

import { useEffect, useRef, useState } from "react";
import { Calculator, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import type { Questionnaire, VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import { effectiveMinN, type VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  useVoteRoomsAvailable,
  type VoteRoomsAvailability,
} from "@/lib/realtime/vote-room/use-vote-room";
import { toast } from "@/lib/utils/toast";
import { FacilitatorTally } from "./facilitator-tally";
import { HostVoteRoom, type HostVoteSession } from "./host-vote-room";

export interface VoteRoundPanelProps {
  tool: VoteRoomTool;
  /** Shown in the consent title, e.g. "Health Check". */
  toolName: string;
  /** Null while the tool has nothing to ask (e.g. no dimensions yet). */
  questionnaire: Questionnaire | null;
  /** Answers needed to show results: 3 by default, `VOTE_LIMITS.minNPsychSafety` for Psych Safety. */
  minN?: number;
  /** The host pressed Save round: totals only. Called once per round. */
  onSave: (result: VoteRoundResult) => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

/** Why live rounds are off here, in one line. */
export function unavailableReason(reason: VoteRoomsAvailability["reason"]): string | null {
  switch (reason) {
    case "flag-off":
      return "Live rounds are off on this site, so count hands or collect paper answers and enter the totals here.";
    case "no-realtime":
      return "Live rounds need the realtime service, which isn't set up here. Enter the totals instead.";
    case "no-crypto":
      return "This browser can't encrypt answers (it needs HTTPS and a current browser). Enter the totals instead.";
    case "guest":
      return "Guests can't host live rounds. Count hands or collect paper answers and enter the totals here.";
    default:
      return null;
  }
}

export function VoteRoundPanel({
  tool,
  toolName,
  questionnaire,
  minN,
  onSave,
  crypto,
}: VoteRoundPanelProps) {
  const availability = useVoteRoomsAvailable(crypto);
  const [consentOpen, setConsentOpen] = useState(false);
  const [live, setLive] = useState<HostVoteSession | null>(null);
  const [tally, setTally] = useState(false);
  const runRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const need = effectiveMinN(minN);
  // A live room keeps the last questions it had if the tool's go away mid-round.
  const lastQuestionnaire = useRef(questionnaire);
  if (questionnaire) lastQuestionnaire.current = questionnaire;

  // After the room closes, put focus back on "Run a live round".
  useEffect(() => {
    if (live || !refocus.current) return;
    refocus.current = false;
    runRef.current?.focus();
  }, [live]);

  if (live && lastQuestionnaire.current) {
    return (
      <HostVoteRoom
        key={live.code}
        tool={tool}
        toolName={toolName}
        session={live}
        questionnaire={lastQuestionnaire.current}
        minN={need}
        onSave={onSave}
        crypto={crypto}
        onClosed={() => {
          clearVisitorIdentity(live.code);
          refocus.current = true;
          setLive(null);
        }}
      />
    );
  }

  const reason = unavailableReason(availability.reason);
  const pending = availability.reason === "auth-pending";

  if (!questionnaire) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
        Add something to ask first, then run a round.
      </p>
    );
  }

  if (!availability.available && !pending) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-sub">{reason}</p>
        <FacilitatorTally tool={tool} questionnaire={questionnaire} minN={need} onSave={onSave} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-sub">
        People answer on their own phones, anonymously. You see how many have answered, and the
        totals once {need} have.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={runRef}
          type="button"
          variant="toolkit"
          className="gap-1.5"
          disabled={pending}
          onClick={() => setConsentOpen(true)}
        >
          <Radio className="h-4 w-4" aria-hidden="true" />
          Run a live round
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          aria-expanded={tally}
          onClick={() => setTally((t) => !t)}
        >
          <Calculator className="h-4 w-4" aria-hidden="true" />
          {tally ? "Hide count entry" : "Enter counts instead"}
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-xs text-sub">
          Checking whether live rounds work here…
        </p>
      )}
      {tally && (
        <FacilitatorTally tool={tool} questionnaire={questionnaire} minN={need} onSave={onSave} />
      )}
      <VisitorRoomConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        mode="start"
        variant="vote"
        toolName={toolName}
        onConfirm={(name) => {
          const code = newVisitorRoomCode();
          const identity = saveVisitorIdentity(code, name);
          if (!identity) {
            toast.error("Couldn't start the round. Try again.");
            return;
          }
          setConsentOpen(false);
          setTally(false);
          setLive({ code, identity, startedAt: Date.now() });
        }}
      />
    </div>
  );
}
