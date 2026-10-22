import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SprintCockpitClient } from "./sprint-cockpit-client";

export const metadata: Metadata = toolMetadata("sprint");

export default function SprintCockpitPage() {
  return <SprintCockpitClient />;
}
