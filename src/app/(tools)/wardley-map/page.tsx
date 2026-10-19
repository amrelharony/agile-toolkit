import { WardleyMapClient } from "./wardley-map-client";

export const metadata = {
  title: "Wardley Map Canvas",
  description:
    "Visibility × evolution canvas for components and their dependencies, with quadrant guides.",
};

export default function Page() {
  return <WardleyMapClient />;
}
