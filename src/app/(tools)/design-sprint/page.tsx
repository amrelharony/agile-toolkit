import { DesignSprintClient } from "./design-sprint-client";

export const metadata = {
  title: "Design Sprint Tracker",
  description:
    "5-day GV design-sprint timeline with daily artifacts, decision points, and per-day task tracking.",
};

export default function Page() {
  return <DesignSprintClient />;
}
