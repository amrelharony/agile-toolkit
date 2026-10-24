import type { Metadata } from "next";
import { SprintReviewClient } from "./sprint-review-client";

export const metadata: Metadata = {
  title: "Sprint Review Kit",
  description:
    "Build each sprint's review from its goal and done stories: a demo script, stakeholder feedback that becomes backlog stories, a showcase checklist and the sprint's numbers.",
};

export default function SprintReviewPage() {
  return <SprintReviewClient />;
}
