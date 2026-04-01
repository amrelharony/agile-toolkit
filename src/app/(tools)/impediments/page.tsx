import type { Metadata } from "next";
import { ImpedimentsClient } from "./impediments-client";

export const metadata: Metadata = {
  title: "Impediment Tracker",
  description:
    "Log, categorize, and resolve team impediments with severity tracking, aging indicators, and resolution metrics.",
};

export default function ImpedimentsPage() {
  return <ImpedimentsClient />;
}
