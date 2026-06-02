/**
 * Wearable hat meshes — ported from the vanilla mascot's setHat (3721-3745).
 * topHat (cylinder), partyHat (cone), crown (torus). The caller positions the
 * mesh above the model top and adds it (named "mascotHat").
 */

import * as THREE from "three";
import type { HatId } from "@/lib/agent/mascot/store";

export function createHatMesh(id: HatId): THREE.Mesh {
  switch (id) {
    case "topHat":
      return new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8),
        new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3 })
      );
    case "partyHat":
      return new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.15, 8),
        new THREE.MeshStandardMaterial({ color: 0xff6b9d, roughness: 0.5 })
      );
    case "crown": {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.015, 4, 6),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 })
      );
      m.rotation.x = Math.PI / 2;
      return m;
    }
  }
}

/** Local-space Y offset above the model top for each hat (source). */
export function hatYOffset(id: HatId): number {
  if (id === "topHat") return 0.06;
  if (id === "partyHat") return 0.08;
  return 0.02; // crown
}
