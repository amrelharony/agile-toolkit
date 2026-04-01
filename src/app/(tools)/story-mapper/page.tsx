import type { Metadata } from "next";
import { StoryMapperClient } from "./story-mapper-client";

export const metadata: Metadata = { title: "User Story Mapper" };

export default function StoryMapperPage() {
  return <StoryMapperClient />;
}
