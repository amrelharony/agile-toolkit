import type { Metadata } from "next";
import { WsjfClient } from "./wsjf-client";

export const metadata: Metadata = {
  title: "WSJF Calculator — Agile Toolkit",
  description:
    "SAFe's Weighted Shortest Job First: (Business Value + Time Criticality + RR/OE) ÷ Job Size.",
};

export default function Page() {
  return <WsjfClient />;
}
