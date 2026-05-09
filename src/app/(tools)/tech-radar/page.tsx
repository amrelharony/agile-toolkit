import { TechRadarClient } from "./tech-radar-client";

export const metadata = {
  title: "Tech Radar — Agile Toolkit",
  description:
    "Thoughtworks-style adopt/trial/assess/hold quadrants for languages, frameworks, and tools.",
};

export default function Page() {
  return <TechRadarClient />;
}
