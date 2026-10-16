import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { PlanningPokerClient } from "./planning-poker-client";

export const metadata: Metadata = toolMetadata("planning-poker");

export default function PlanningPokerPage() {
  return <PlanningPokerClient />;
}
