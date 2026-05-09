import { IncidentCommanderClient } from "./incident-commander-client";

export const metadata = {
  title: "Incident Commander — Agile Toolkit",
  description:
    "Live-incident scaffolding with severity matrix, comms templates, role assignments, and timeline log.",
};

export default function Page() {
  return <IncidentCommanderClient />;
}
