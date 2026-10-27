import { OkrsClient } from "./okrs-client";

export const metadata = {
  title: "OKR Tracker",
  description:
    "Track quarterly Objectives and Key Results from baseline to target, with dated check-ins, a confidence trend and the sprint goals that move them.",
};

export default function Page() {
  return <OkrsClient />;
}
