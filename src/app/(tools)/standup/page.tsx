import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { StandupClient } from "./standup-client";

export const metadata: Metadata = toolMetadata("standup");

export default function StandupPage() {
  return <StandupClient />;
}
