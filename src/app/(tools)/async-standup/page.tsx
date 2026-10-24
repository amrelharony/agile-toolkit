import { StandupClient } from "@/app/(tools)/standup/standup-client";

/**
 * The async standup is the Standup Tracker's async mode: the same entries,
 * opened on the written-update view. The page keeps its own title so old
 * links and bookmarks land where they did.
 */
export const metadata = {
  title: "Async Standup Digest",
  description:
    "The standup's written mode: who hasn't posted, one update per person per day, a blockers-first daily digest and a 14-day history.",
};

export default function Page() {
  return <StandupClient mode="async" />;
}
