import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { StoryMapperClient } from "./story-mapper-client";

export const metadata: Metadata = toolMetadata("story-mapper");

export default function StoryMapperPage() {
  return <StoryMapperClient />;
}
