import { FeatureFlagTrackerClient } from "./feature-flag-tracker-client";

export const metadata = {
  title: "Feature Flag Tracker — Agile Toolkit",
  description:
    "Active flags catalog with age, owner, and stale-flag anti-pattern alerts.",
};

export default function Page() {
  return <FeatureFlagTrackerClient />;
}
