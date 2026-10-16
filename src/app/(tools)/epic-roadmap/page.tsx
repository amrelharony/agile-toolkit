import { EpicRoadmapClient } from "./epic-roadmap-client";

export const metadata = {
  title: "Epic Roadmap",
  description: "Timeline view of epics across quarters with progress bars and milestone markers.",
};

export default function Page() {
  return <EpicRoadmapClient />;
}
