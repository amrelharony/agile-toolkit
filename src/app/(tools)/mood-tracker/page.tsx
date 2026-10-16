import { MoodTrackerClient } from "./mood-tracker-client";

export const metadata = {
  title: "Team Mood Tracker",
  description: "Daily team mood check-ins with aggregate heatmap and velocity correlation.",
};

export default function Page() {
  return <MoodTrackerClient />;
}
