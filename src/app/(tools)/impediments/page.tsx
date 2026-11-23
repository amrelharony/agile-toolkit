import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ImpedimentsClient } from "./impediments-client";

export const metadata: Metadata = toolMetadata("impediments");

export default function ImpedimentsPage() {
  return <ImpedimentsClient />;
}
