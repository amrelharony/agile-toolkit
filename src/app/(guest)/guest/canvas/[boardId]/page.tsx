import { redirect, notFound } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { GuestCanvasClient } from "./guest-canvas-client";

export const metadata = {
  title: "Canvas — Agile Toolkit",
};

interface Params {
  boardId: string;
}

export default async function GuestCanvasPage({ params }: { params: Params }) {
  const session = await getGuestSession();
  if (!session) {
    // Preserve the originally-requested URL so the join flow can
    // return the guest to the board the owner actually shared with
    // them, not the generic /guest home.
    redirect(`/guest/join?next=${encodeURIComponent(`/guest/canvas/${params.boardId}`)}`);
  }
  const invite = await resolveGuestInvite({
    squadId: session.squadId,
    profileId: session.profileId,
    toolId: "canvas",
    entityId: params.boardId,
  });
  if (!invite) {
    notFound();
  }
  return (
    <GuestCanvasClient
      boardId={params.boardId}
      role={invite.role}
      profile={{
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
      }}
    />
  );
}
