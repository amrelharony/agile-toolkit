import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { IceScoreClient } from "./ice-score-client";

export const metadata: Metadata = toolMetadata("ice-score");

export default function Page() {
  return <IceScoreClient />;
}
