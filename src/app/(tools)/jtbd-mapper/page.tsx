import { JtbdMapperClient } from "./jtbd-mapper-client";

export const metadata = {
  title: "Job Story Mapper",
  description:
    'Capture "When ___ I want to ___ so I can ___" job stories, link them to parent jobs, and surface decomposition gaps.',
};

export default function Page() {
  return <JtbdMapperClient />;
}
