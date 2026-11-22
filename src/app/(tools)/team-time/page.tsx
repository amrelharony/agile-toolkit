import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { TeamTimeClient } from "./team-time-client";

export const metadata: Metadata = toolMetadata("team-time");

export default function Page() {
  return <TeamTimeClient />;
}
