import { FlakyTestsClient } from "./flaky-tests-client";

export const metadata = {
  title: "Flaky Test Scoreboard",
  description:
    "Manual log of flaky tests with quarantine status, failure rate, owner, and a top-10-flakiest bar chart.",
};

export default function Page() {
  return <FlakyTestsClient />;
}
