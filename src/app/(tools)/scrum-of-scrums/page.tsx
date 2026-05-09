import { ScrumOfScrumsClient } from "./scrum-of-scrums-client";

export const metadata = {
  title: "Scrum of Scrums Tracker — Agile Toolkit",
  description: "Coordinate across teams with cross-team blockers, dependencies, and decisions.",
};

export default function Page() {
  return <ScrumOfScrumsClient />;
}
