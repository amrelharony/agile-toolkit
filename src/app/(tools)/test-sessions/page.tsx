import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { TestSessionsClient } from "./test-sessions-client";

export const metadata: Metadata = toolMetadata("test-sessions");

export default function Page() {
  return <TestSessionsClient />;
}
