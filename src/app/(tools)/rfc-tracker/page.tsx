import { RfcTrackerClient } from "./rfc-tracker-client";

export const metadata = {
  title: "RFC Tracker — Agile Toolkit",
  description:
    "Pre-decision RFC pipeline (draft → review → decided) that feeds the decision-log.",
};

export default function Page() {
  return <RfcTrackerClient />;
}
