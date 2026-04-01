import type { Metadata } from "next";
import { SprintReviewClient } from "./sprint-review-client";

export const metadata: Metadata = {
  title: "Sprint Review Kit",
  description:
    "Generate demo scripts, capture stakeholder feedback, run showcase checklists, and view velocity summaries for your sprint review.",
};

export default function SprintReviewPage() {
  return <SprintReviewClient />;
}
