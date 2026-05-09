import { DependencyMapClient } from "./dependency-map-client";

export const metadata = {
  title: "Dependency Map — Agile Toolkit",
  description: "Graph of inter-team/inter-story dependencies with critical-path and cycle detection.",
};

export default function Page() {
  return <DependencyMapClient />;
}
