import { SloBuilderClient } from "./slo-builder-client";

export const metadata = {
  title: "SLO & Error Budget Builder",
  description: "Define SLI/SLO targets and track error-budget burn rate over a rolling window.",
};

export default function Page() {
  return <SloBuilderClient />;
}
