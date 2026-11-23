import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { EpicRoadmapClient } from "./epic-roadmap-client";

export const metadata: Metadata = toolMetadata("epic-roadmap");

export default function Page() {
  return <EpicRoadmapClient />;
}
