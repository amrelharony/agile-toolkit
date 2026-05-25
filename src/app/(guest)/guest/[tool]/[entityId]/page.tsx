import { redirect, notFound } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { resolveGuestInvite } from "@/lib/squads/invites";
import { GuestToolPlaceholder } from "./guest-tool-placeholder";

export const metadata = {
  title: "Session — Agile Toolkit",
};

interface Params {
  tool: string;
  entityId: string;
}

export default async function GuestToolPage({ params }: { params: Params }) {
  const session = await getGuestSession();
  if (!session) {
    redirect(`/guest/join?next=${encodeURIComponent(`/guest/${params.tool}/${params.entityId}`)}`);
  }
  const invite = await resolveGuestInvite({
    squadId: session.squadId,
    profileId: session.profileId,
    toolId: params.tool,
    entityId: params.entityId,
  });
  if (!invite) {
    // No active invite — either the owner revoked, the entity id is
    // wrong, or this guest's squad was never invited. notFound() renders
    // the 404 page rather than leaking the existence/absence of the
    // entity to an unauthorised guest.
    notFound();
  }
  return (
    <GuestToolPlaceholder
      toolId={params.tool}
      entityId={params.entityId}
      role={invite.role}
      profile={{
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
      }}
    />
  );
}
