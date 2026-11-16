"use client";

import { useEffect, useMemo, useState } from "react";
import { Cast } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ShowRoomHost } from "@/components/collab/show-room";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  TEAM_MIXER_FRAME_KINDS,
  cafeFrame,
  groupsFrame,
} from "@/lib/realtime/show-room/frames/team-mixer";
import type { ShowRoom } from "@/lib/realtime/show-room/use-show-room";
import type { MixerCafe, MixerRound } from "@/lib/team-mixer/state";

export interface LiveCardProps {
  mode: "groups" | "pairs" | "cafe";
  round: MixerRound | null;
  cafe: MixerCafe | null;
}

const TOO_BIG = "This mix is too big to show at once. Show fewer people, or shorter names.";

/**
 * The buttons inside a live room: put the newest round, or the café round, on
 * everyone's phone. After a move or new names, the room still shows the
 * round as it was, so the line says so and the button offers the changes.
 */
function LiveControls({ room, mode, round, cafe }: LiveCardProps & { room: ShowRoom }) {
  const number = round?.number ?? 0;
  const announce = useAnnounce();
  const [status, setStatus] = useState<string | null>(null);
  // What the room got last: which round (or café round), and the frame itself.
  const [shown, setShown] = useState<{ id: string; frame: string } | null>(null);
  const say = (text: string) => {
    setStatus(text);
    announce(text);
  };

  const cafeMode = mode === "cafe";
  const roundFrame = useMemo(
    () =>
      round
        ? groupsFrame({
            title: round.title,
            round: round.number,
            unit: round.mode === "pairs" ? "pair" : "group",
            groups: round.groups,
            sitOut: round.sitOut,
          })
        : null,
    [round]
  );
  const cafeRoundFrame = useMemo(
    () =>
      cafe
        ? cafeFrame({
            title: cafe.title,
            round: cafe.current + 1,
            rounds: cafe.rounds.length,
            tables: cafe.rounds[cafe.current],
          })
        : null,
    [cafe]
  );
  const currentId = cafeMode ? (cafe ? `${cafe.id}:${cafe.current}` : null) : (round?.id ?? null);
  const currentFrame = cafeMode ? cafeRoundFrame : roundFrame;
  // The same round as the room's, changed since it was shown.
  const stale =
    shown !== null &&
    currentId === shown.id &&
    currentFrame !== null &&
    JSON.stringify(currentFrame) !== shown.frame;
  const staleText = cafeMode
    ? `The room shows café round ${(cafe?.current ?? 0) + 1} as it was before your changes.`
    : `The room shows round ${number} as it was before your changes.`;
  useEffect(() => {
    if (stale) announce(staleText);
  }, [stale, staleText, announce]);

  const show = () => {
    if (!currentId) return;
    const kind = cafeMode ? TEAM_MIXER_FRAME_KINDS.cafe : TEAM_MIXER_FRAME_KINDS.groups;
    const ok = currentFrame !== null && room.show(kind, currentFrame);
    if (ok) setShown({ id: currentId, frame: JSON.stringify(currentFrame) });
    say(
      !ok
        ? TOO_BIG
        : cafeMode
          ? `Café round ${(cafe?.current ?? 0) + 1} is on everyone's screen.`
          : `Round ${number} is on everyone's screen.`
    );
  };

  const live = room.status === "live";
  const nothing = cafeMode ? !cafe : !round;
  const label = stale
    ? "Show the changes"
    : cafeMode
      ? cafe
        ? `Show café round ${cafe.current + 1}`
        : "Show the café"
      : round
        ? `Show round ${number}`
        : "Show the groups";
  return (
    <div className="space-y-2">
      <Button type="button" variant="toolkit" disabled={nothing || !live} onClick={show}>
        {label}
      </Button>
      {nothing && (
        <p className="text-sm text-sub">
          {cafeMode ? "Plan the café first, above." : "Mix a round first, above."}
        </p>
      )}
      {/* Said through the app's live region too (useAnnounce), which a
          screen reader hears even though this line appears with its text. */}
      {(stale || status) && <p className="text-sm text-text">{stale ? staleText : status}</p>}
    </div>
  );
}

/**
 * Show the groups on everyone's phone: a show room the host opens (with
 * consent), then "Show round N" puts the newest round (or the café round on
 * screen) up, and each person finds their own name there. Only what the
 * host shows is sent; nothing comes back but "I'm here".
 */
export function LiveCard(props: LiveCardProps) {
  return (
    <SectionCard title="Show on everyone's phones" icon={Cast}>
      <ShowRoomHost
        tool="team-mixer"
        toolName="Team Mixer"
        description="Everyone in the room sees the groups on their phone and can find their own name there."
      >
        {(room) => <LiveControls room={room} {...props} />}
      </ShowRoomHost>
    </SectionCard>
  );
}
