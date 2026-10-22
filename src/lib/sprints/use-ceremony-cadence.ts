"use client";

import { useCallback, useMemo } from "react";
import { useCloudPersisted } from "@/lib/sync/use-cloud-persisted";
import { DEFAULT_CADENCE, normalizeCadence, type CeremonyCadence } from "./cadence";

/**
 * The stored ceremony cadence. Kept in this browser like other preferences
 * and synced for the owner; not a workspace entity, so agents don't see it
 * yet (the next step once the shape has settled).
 */
export const CADENCE_KEY = "agile-toolkit:ceremony-cadence:v1";

export function useCeremonyCadence(): [CeremonyCadence, (patch: Partial<CeremonyCadence>) => void] {
  const [raw, setRaw] = useCloudPersisted<CeremonyCadence>(CADENCE_KEY, DEFAULT_CADENCE);
  const cadence = useMemo(() => normalizeCadence(raw), [raw]);
  const update = useCallback(
    (patch: Partial<CeremonyCadence>) => {
      setRaw((prev) => normalizeCadence({ ...normalizeCadence(prev), ...patch }));
    },
    [setRaw]
  );
  return [cadence, update];
}
