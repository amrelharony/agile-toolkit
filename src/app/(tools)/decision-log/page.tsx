import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { DecisionLogClient } from "./decision-log-client";

export const metadata: Metadata = toolMetadata("decision-log");

export default function Page() {
  return <DecisionLogClient template="adr" />;
}
