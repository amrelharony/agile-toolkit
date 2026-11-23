import { StandupClient } from "@/app/(tools)/standup/standup-client";

/**
 * The async standup is the Standup Tracker's async mode: the same entries,
 * opened on the written-update view. The page keeps its own title so old
 * links and bookmarks land where they did.
 */
export const metadata = {
  title: "Async Standup Digest",
  description:
    "The standup's written mode: classic or Progress/Plans/Problems updates, a DRI per blocker, hand-overs between time zones and a blockers-first daily digest.",
};

export default function Page() {
  return <StandupClient mode="async" />;
}
