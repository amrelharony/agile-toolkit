import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { KanbanClient } from "./kanban-client";

export const metadata: Metadata = toolMetadata("kanban");

export default function Page() {
  return <KanbanClient />;
}
