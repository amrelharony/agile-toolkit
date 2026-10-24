import { KanbanClient } from "./kanban-client";

export const metadata = {
  title: "Kanban Board",
  description:
    "Run the sprint on a board of its stories, or keep a WIP-limited flow board with cycle time and throughput.",
};

export default function Page() {
  return <KanbanClient />;
}
