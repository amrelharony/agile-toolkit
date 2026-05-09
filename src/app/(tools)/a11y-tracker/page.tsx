import { A11yTrackerClient } from "./a11y-tracker-client";

export const metadata = {
  title: "Accessibility Audit Tracker — Agile Toolkit",
  description:
    "WCAG issues by severity with fix burn-down line chart, per-component coverage list, and CSV export.",
};

export default function Page() {
  return <A11yTrackerClient />;
}
