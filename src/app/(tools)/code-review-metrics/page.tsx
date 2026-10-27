import { CodeReviewMetricsClient } from "./code-review-metrics-client";

export const metadata = {
  title: "Code Review Metrics",
  description:
    "Time to first review and PR cycle time in the team's working hours, from manual logs or pasted CSV — with medians by PR size, a weekly median line and a size-vs-cycle scatter.",
};

export default function Page() {
  return <CodeReviewMetricsClient />;
}
