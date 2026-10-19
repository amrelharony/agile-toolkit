import { OncallRosterClient } from "./oncall-roster-client";

export const metadata = {
  title: "On-Call Roster & Burnout",
  description: "Rotation schedule with paging-frequency tracking and burnout heatmap.",
};

export default function Page() {
  return <OncallRosterClient />;
}
