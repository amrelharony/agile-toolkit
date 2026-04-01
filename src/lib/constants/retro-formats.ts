export interface RetroColumn {
  key: string;
  label: string;
  color: string;
  icon: string;
}

export interface RetroFormat {
  id: string;
  name: string;
  description: string;
  columns: RetroColumn[];
}

export const retroFormats: RetroFormat[] = [
  {
    id: "start-stop-continue",
    name: "Start / Stop / Continue",
    description:
      "Classic 3-column format. Identify new practices to adopt, habits to drop, and things working well to keep.",
    columns: [
      { key: "start", label: "Start", color: "#00ff88", icon: "▶" },
      { key: "stop", label: "Stop", color: "#ef4444", icon: "■" },
      { key: "continue", label: "Continue", color: "#00f0ff", icon: "↻" },
    ],
  },
  {
    id: "4ls",
    name: "4Ls",
    description:
      "Liked, Learned, Lacked, Longed For — a deep-dive retrospective that uncovers both positives and gaps.",
    columns: [
      { key: "liked", label: "Liked", color: "#00ff88", icon: "♥" },
      { key: "learned", label: "Learned", color: "#00f0ff", icon: "✦" },
      { key: "lacked", label: "Lacked", color: "#f59e0b", icon: "△" },
      { key: "longed-for", label: "Longed For", color: "#a855f7", icon: "★" },
    ],
  },
  {
    id: "sailboat",
    name: "Sailboat",
    description:
      "A metaphorical format. Anchors hold you back, Wind propels you forward, Rocks are risks ahead, Island is your goal.",
    columns: [
      { key: "anchor", label: "Anchor", color: "#ef4444", icon: "⚓" },
      { key: "wind", label: "Wind", color: "#00ff88", icon: "💨" },
      { key: "rocks", label: "Rocks", color: "#f59e0b", icon: "🪨" },
      { key: "island", label: "Island", color: "#00f0ff", icon: "🏝" },
    ],
  },
  {
    id: "mad-sad-glad",
    name: "Mad / Sad / Glad",
    description:
      "Emotion-focused format. Surface frustrations, disappointments, and wins to drive team morale insights.",
    columns: [
      { key: "mad", label: "Mad", color: "#ef4444", icon: "😠" },
      { key: "sad", label: "Sad", color: "#60a5fa", icon: "😢" },
      { key: "glad", label: "Glad", color: "#00ff88", icon: "😄" },
    ],
  },
  {
    id: "daki",
    name: "DAKI",
    description:
      "Drop, Add, Keep, Improve — a structured format for process improvement focused on concrete changes.",
    columns: [
      { key: "drop", label: "Drop", color: "#ef4444", icon: "✕" },
      { key: "add", label: "Add", color: "#00ff88", icon: "+" },
      { key: "keep", label: "Keep", color: "#00f0ff", icon: "✓" },
      { key: "improve", label: "Improve", color: "#f59e0b", icon: "↑" },
    ],
  },
  {
    id: "starfish",
    name: "Starfish",
    description:
      "Five-point retrospective: Stop, Less Of, Keep, More Of, Start — perfect for nuanced team calibration.",
    columns: [
      { key: "stop", label: "Stop", color: "#ef4444", icon: "✕" },
      { key: "less-of", label: "Less Of", color: "#f97316", icon: "↓" },
      { key: "keep", label: "Keep", color: "#00f0ff", icon: "✓" },
      { key: "more-of", label: "More Of", color: "#a855f7", icon: "↑" },
      { key: "start", label: "Start", color: "#00ff88", icon: "▶" },
    ],
  },
  {
    id: "lean-coffee",
    name: "Lean Coffee",
    description:
      "Agenda-less meeting format. Team members propose topics, vote on priority, then discuss in order.",
    columns: [
      { key: "to-discuss", label: "To Discuss", color: "#00f0ff", icon: "💬" },
      { key: "discussing", label: "Discussing", color: "#f59e0b", icon: "▶" },
      { key: "done", label: "Done", color: "#00ff88", icon: "✓" },
    ],
  },
  {
    id: "timeline",
    name: "Timeline",
    description:
      "Quarter-by-quarter review of the year. Reflect on what happened in Q1–Q4 to spot seasonal patterns.",
    columns: [
      { key: "q1", label: "Q1 (Jan–Mar)", color: "#00f0ff", icon: "①" },
      { key: "q2", label: "Q2 (Apr–Jun)", color: "#00ff88", icon: "②" },
      { key: "q3", label: "Q3 (Jul–Sep)", color: "#f59e0b", icon: "③" },
      { key: "q4", label: "Q4 (Oct–Dec)", color: "#a855f7", icon: "④" },
    ],
  },
];
