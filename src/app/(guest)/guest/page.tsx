import { redirect } from "next/navigation";
import { getGuestSession } from "@/lib/auth/guest-session";
import { GuestHomeClient } from "./guest-home-client";

export const metadata = {
  title: "Guest — Agile Toolkit",
  description: "Your invited collaborative sessions.",
};

export default async function GuestHomePage() {
  const session = await getGuestSession();
  if (!session) {
    redirect("/guest/join");
  }
  return (
    <GuestHomeClient
      profile={{
        id: session.profileId,
        displayName: session.displayName,
        color: session.color,
        squadId: session.squadId,
      }}
    />
  );
}
