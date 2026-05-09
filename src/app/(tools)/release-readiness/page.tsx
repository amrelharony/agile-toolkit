import { ReleaseReadinessClient } from "./release-readiness-client";

export const metadata = {
  title: "Release Readiness — Agile Toolkit",
  description:
    "Pre-release gates across a11y, perf, observability, and rollback with per-release pass rate.",
};

export default function Page() {
  return <ReleaseReadinessClient />;
}
