import { NpsCsatClient } from "./nps-csat-client";

export const metadata = {
  title: "NPS / CSAT Tracker",
  description:
    "Collect and track Net Promoter Score and Customer Satisfaction with trend analysis.",
};

export default function Page() {
  return <NpsCsatClient />;
}
