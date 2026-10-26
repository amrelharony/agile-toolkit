import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { KudosClient } from "./kudos-client";

export const metadata: Metadata = toolMetadata("kudos");

export default function KudosPage() {
  return <KudosClient />;
}
