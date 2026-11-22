import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ExampleMappingClient } from "./example-mapping-client";

export const metadata: Metadata = toolMetadata("example-mapping");

export default function Page() {
  return <ExampleMappingClient />;
}
