import { redirect, notFound } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { GuestPokerClient } from "./guest-poker-client";

export const metadata = {
  title: "Planning Poker — Agile Toolkit",
};

interface Params {
  roomCode: string;
}

export default async function GuestPokerPage({ params }: { params: Params }) {
  const session = await getGuestSession();
  if (!session) {
    redirect(`/guest/join?next=${encodeURIComponent(`/guest/planning-poker/${params.roomCode}`)}`);
  }
  const invite = await resolveGuestInvite({
    squadId: session.squadId,
    profileId: session.profileId,
    toolId: "planning-poker",
    entityId: params.roomCode,
  });
  if (!invite) {
    notFound();
  }
  return (
    <GuestPokerClient
      roomCode={params.roomCode}
      role={invite.role}
      profile={{
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
      }}
    />
  );
}
