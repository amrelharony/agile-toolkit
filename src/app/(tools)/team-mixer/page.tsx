import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { TeamMixerClient } from "./team-mixer-client";

export const metadata: Metadata = toolMetadata("team-mixer");

export default function Page() {
  return <TeamMixerClient />;
}
