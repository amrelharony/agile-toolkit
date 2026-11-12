import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { MeetingAuditClient } from "./meeting-audit-client";

export const metadata: Metadata = toolMetadata("meeting-audit");

export default function Page() {
  return <MeetingAuditClient />;
}
