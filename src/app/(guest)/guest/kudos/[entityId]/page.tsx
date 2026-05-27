import { redirect, notFound } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { isValidGuestPathSegment } from "@/lib/squads/validate";
import { GuestKudosClient } from "./guest-kudos-client";

export const metadata = {
  title: "Kudos — Agile Toolkit",
};

interface Params {
  entityId: string;
}

export default async function GuestKudosPage({ params }: { params: Params }) {
  if (!isValidGuestPathSegment(params.entityId)) {
    notFound();
  }
  const session = await getGuestSession();
  if (!session) {
    redirect(`/guest/join?next=${encodeURIComponent(`/guest/kudos/${params.entityId}`)}`);
  }
  const invite = await resolveGuestInvite({
    squadId: session.squadId,
    profileId: session.profileId,
    toolId: "kudos",
    entityId: params.entityId,
  });
  if (!invite) {
    notFound();
  }
  return (
    <GuestKudosClient
      entityId={params.entityId}
      role={invite.role}
      profile={{
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
        squadId: session.squadId,
      }}
    />
  );
}
