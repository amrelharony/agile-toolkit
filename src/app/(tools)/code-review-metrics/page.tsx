import { CodeReviewMetricsClient } from "./code-review-metrics-client";

export const metadata = {
  title: "Code Review Metrics",
  description:
    "PR cycle time, review depth, and PR size from manual logs or pasted CSV — with size-vs-cycle scatter and reviewer leaderboard.",
};

export default function Page() {
  return <CodeReviewMetricsClient />;
}
