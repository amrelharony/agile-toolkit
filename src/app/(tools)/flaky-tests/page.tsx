import { FlakyTestsClient } from "./flaky-tests-client";

export const metadata = {
  title: "Flaky Test Scoreboard",
  description:
    "Log flaky tests with failed runs out of runs, owner and quarantine status — a failure rate weighted by runs, an alert for long quarantines, and the worst offenders.",
};

export default function Page() {
  return <FlakyTestsClient />;
}
