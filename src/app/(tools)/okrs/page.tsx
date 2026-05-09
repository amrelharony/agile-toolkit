import { OkrsClient } from "./okrs-client";

export const metadata = {
  title: "OKR Tracker — Agile Toolkit",
  description: "Track quarterly Objectives and Key Results with confidence, check-ins, and trajectory forecasting.",
};

export default function Page() {
  return <OkrsClient />;
}
