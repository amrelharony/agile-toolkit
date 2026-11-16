import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { QuickVoteClient } from "./quick-vote-client";

export const metadata: Metadata = toolMetadata("quick-vote");

export default function Page() {
  return <QuickVoteClient />;
}
