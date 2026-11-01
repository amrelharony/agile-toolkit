import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { UserInterviewsClient } from "./user-interviews-client";

export const metadata: Metadata = toolMetadata("user-interviews");

export default function Page() {
  return <UserInterviewsClient />;
}
