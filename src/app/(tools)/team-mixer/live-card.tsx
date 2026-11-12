"use client";

import { useState } from "react";
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

/** The buttons inside a live room: put the newest round, or the café round, on everyone's phone. */
function LiveControls({ room, mode, round, cafe }: LiveCardProps & { room: ShowRoom }) {
  const number = round?.number ?? 0;
  const announce = useAnnounce();
  const [status, setStatus] = useState<string | null>(null);
  const say = (text: string) => {
    setStatus(text);
    announce(text);
  };

  const showRound = () => {
    if (!round) return;
    const frame = groupsFrame({
      title: round.title,
      round: number,
      unit: round.mode === "pairs" ? "pair" : "group",
      groups: round.groups,
      sitOut: round.sitOut,
    });
    const ok = frame !== null && room.show(TEAM_MIXER_FRAME_KINDS.groups, frame);
    say(ok ? `Round ${number} is on everyone's screen.` : TOO_BIG);
  };

  const showCafe = () => {
    if (!cafe) return;
    const frame = cafeFrame({
      title: cafe.title,
      round: cafe.current + 1,
      rounds: cafe.rounds.length,
      tables: cafe.rounds[cafe.current],
    });
    const ok = frame !== null && room.show(TEAM_MIXER_FRAME_KINDS.cafe, frame);
    say(ok ? `Café round ${cafe.current + 1} is on everyone's screen.` : TOO_BIG);
  };

  const live = room.status === "live";
  const cafeMode = mode === "cafe";
  const nothing = cafeMode ? !cafe : !round;
  return (
    <div className="space-y-2">
      {cafeMode ? (
        <Button type="button" variant="toolkit" disabled={!cafe || !live} onClick={showCafe}>
          {cafe ? `Show café round ${cafe.current + 1}` : "Show the café"}
        </Button>
      ) : (
        <Button type="button" variant="toolkit" disabled={!round || !live} onClick={showRound}>
          {round ? `Show round ${number}` : "Show the groups"}
        </Button>
      )}
      {nothing && (
        <p className="text-sm text-sub">
          {cafeMode ? "Plan the café first, above." : "Mix a round first, above."}
        </p>
      )}
      {/* Said through the app's live region too (useAnnounce), which a
          screen reader hears even though this line appears with its text. */}
      {status && <p className="text-sm text-text">{status}</p>}
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
