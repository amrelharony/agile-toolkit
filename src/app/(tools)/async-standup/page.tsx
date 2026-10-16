import { AsyncStandupClient } from "./async-standup-client";

export const metadata = {
  title: "Async Standup Digest",
  description:
    "Async-first standup with auto-generated daily digest, blocker rollup, and a 14-day calendar.",
};

export default function Page() {
  return <AsyncStandupClient />;
}
