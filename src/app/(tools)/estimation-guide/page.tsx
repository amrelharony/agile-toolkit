import type { Metadata } from "next";
import { EstimationGuideClient } from "./estimation-guide-client";

export const metadata: Metadata = { title: "Estimation Reference Guide" };

export default function EstimationGuidePage() {
  return <EstimationGuideClient />;
}
