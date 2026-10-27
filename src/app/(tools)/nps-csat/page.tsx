import { NpsCsatClient } from "./nps-csat-client";

export const metadata = {
  title: "NPS / CSAT Tracker",
  description:
    "Import or add NPS and CSAT survey answers and read them per week or month, with the response count behind each score, CSAT as % satisfied and theme tags.",
};

export default function Page() {
  return <NpsCsatClient />;
}
