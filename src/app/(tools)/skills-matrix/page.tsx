import type { Metadata } from "next";
import { SkillsMatrixClient } from "./skills-matrix-client";

export const metadata: Metadata = {
  title: "Team Skills Matrix",
  description:
    "Visualize team skill coverage with a proficiency heat map, bus factor detection, and knowledge gap alerts.",
};

export default function SkillsMatrixPage() {
  return <SkillsMatrixClient />;
}
