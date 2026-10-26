import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { MoodTrackerClient } from "./mood-tracker-client";

export const metadata: Metadata = toolMetadata("mood-tracker");

export default function Page() {
  return <MoodTrackerClient />;
}
