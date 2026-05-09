import { PremortemClient } from "./premortem-client";

export const metadata = {
  title: "Premortem Facilitator — Agile Toolkit",
  description: "Run a pre-mortem workshop to anticipate failure modes and build preventive actions.",
};

export default function Page() {
  return <PremortemClient />;
}
