import { ControlMapClient } from "./control-map-client";

export const metadata = {
  title: "Compliance Control Map — Agile Toolkit",
  description:
    "Map team controls to SOC 2 / ISO 27001 / HIPAA / GDPR with evidence links and per-framework completion dashboard.",
};

export default function Page() {
  return <ControlMapClient />;
}
