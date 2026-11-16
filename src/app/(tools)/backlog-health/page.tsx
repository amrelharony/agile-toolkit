import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { BacklogHealthClient } from "./backlog-health-client";

export const metadata: Metadata = toolMetadata("backlog-health");

export default function Page() {
  return <BacklogHealthClient />;
}
