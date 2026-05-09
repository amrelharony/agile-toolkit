import { LiberatingStructuresClient } from "./liberating-structures-client";

export const metadata = {
  title: "Liberating Structures Picker — Agile Toolkit",
  description:
    "Filterable catalog of Liberating Structures with timing and group-size matchmaker.",
};

export default function Page() {
  return <LiberatingStructuresClient />;
}
