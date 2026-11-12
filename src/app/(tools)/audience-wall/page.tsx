import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { AudienceWallClient } from "./audience-wall-client";

export const metadata: Metadata = toolMetadata("audience-wall");

export default function Page() {
  return <AudienceWallClient />;
}
