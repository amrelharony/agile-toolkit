import { StandupClient } from "@/app/(tools)/standup/standup-client";

/**
 * The async standup is the Standup Tracker's async mode: the same entries,
 * opened on the written-update view. The page keeps its own title so old
 * links and bookmarks land where they did.
 */
export const metadata = {
  title: "Async Standup Digest",
  description:
    "Async-first standup with auto-generated daily digest, blocker rollup, and a 14-day calendar.",
};

export default function Page() {
  return <StandupClient mode="async" />;
}
