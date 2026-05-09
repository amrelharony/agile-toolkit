import { DoraScorecardClient } from "./dora-scorecard-client";

export const metadata = {
  title: "DORA Scorecard — Agile Toolkit",
  description:
    "Track the four DORA keys (deploy frequency, lead time, change failure rate, MTTR) across quarters with Elite/High/Medium/Low banding.",
};

export default function Page() {
  return <DoraScorecardClient />;
}
