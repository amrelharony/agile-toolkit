import { ThreatModelClient } from "./threat-model-client";

export const metadata = {
  title: "Threat Model Registry — Agile Toolkit",
  description:
    "STRIDE-based per-service threat catalog with severity, mitigation status, and STRIDE coverage matrix.",
};

export default function Page() {
  return <ThreatModelClient />;
}
