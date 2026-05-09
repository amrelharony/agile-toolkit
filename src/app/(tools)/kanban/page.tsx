import { KanbanClient } from "./kanban-client";

export const metadata = {
  title: "Kanban Board — Agile Toolkit",
  description: "WIP-limited Kanban board with throughput forecasting and cycle-time analysis.",
};

export default function Page() {
  return <KanbanClient />;
}
