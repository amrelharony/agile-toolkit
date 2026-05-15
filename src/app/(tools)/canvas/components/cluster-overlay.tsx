"use client";

import { memo } from "react";
import type { Camera } from "@/lib/geometry/bbox";
import type { ClusterResult } from "@/lib/whiteboard/cluster-bridge";

const CLUSTER_COLORS = ["#00f0ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa"];

interface ClusterOverlayProps {
  clusters: readonly ClusterResult[];
  camera: Camera;
}

/**
 * Dashed cluster outlines + label drawn over the canvas while the AI
 * insights panel is open. Each cluster's color comes from a stable
 * 6-color palette indexed by cluster id so labels stay legible against
 * the cyberpunk background.
 */
function ClusterOverlayImpl({ clusters, camera }: ClusterOverlayProps) {
  if (clusters.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9996,
      }}
    >
      {clusters.map((c) => {
        const color = CLUSTER_COLORS[c.id % CLUSTER_COLORS.length];
        const x = (c.bbox.x - camera.x) * camera.zoom;
        const y = (c.bbox.y - camera.y) * camera.zoom;
        const w = c.bbox.w * camera.zoom;
        const h = c.bbox.h * camera.zoom;
        const labelX = x + 8;
        const labelY = y - 6;
        return (
          <g key={c.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.7}
              rx={8}
            />
            <rect
              x={labelX - 4}
              y={labelY - 12}
              width={(`Cluster ${c.id + 1} · ${c.objectIds.length}`).length * 6 + 8}
              height={16}
              fill="#0b0f17"
              opacity={0.9}
              rx={2}
            />
            <text x={labelX} y={labelY} fontSize={11} fill={color} fontFamily="ui-monospace, monospace">
              Cluster {c.id + 1} · {c.objectIds.length}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const ClusterOverlay = memo(ClusterOverlayImpl);
