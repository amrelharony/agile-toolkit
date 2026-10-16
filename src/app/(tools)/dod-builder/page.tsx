import { DodBuilderClient } from "./dod-builder-client";

export const metadata = {
  title: "Definition of Done Builder",
  description: "Build your team's Definition of Done and track per-sprint adherence.",
};

export default function Page() {
  return <DodBuilderClient />;
}
