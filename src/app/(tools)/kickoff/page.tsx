import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { KickoffClient } from "./kickoff-client";

export const metadata: Metadata = toolMetadata("kickoff");

export default function Page() {
  return <KickoffClient />;
}
