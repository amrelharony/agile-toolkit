import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SprintReviewClient } from "./sprint-review-client";

export const metadata: Metadata = toolMetadata("sprint-review");

export default function SprintReviewPage() {
  return <SprintReviewClient />;
}
