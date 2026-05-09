/**
 * Design DNA Tokens — amrelharony.com Ecosystem
 * Extracted from the main portfolio site's CSS custom properties and style patterns.
 * Use these tokens to maintain visual consistency across all ecosystem apps.
 */

// ─── Colors ────────────────────────────────────────────────────────────────────

export const colors = {
  dark: {
    bg: "#06080f",
    bg2: "#0c1018",
    bg2Rgb: "12, 16, 24",
    text: "#f0f2f5",
    sub: "#8a95a8",
    accent: "#00e1ff",
    accent2: "#6366f1",
    accent3: "#a855f7",
    card: "rgba(12, 16, 24, 0.65)",
    cardHover: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.08)",
    glow: "rgba(0, 225, 255, 0.15)",
    glowStrong: "rgba(0, 225, 255, 0.4)",
  },
  light: {
    bg: "#f4f6fb",
    bg2: "#ffffff",
    bg2Rgb: "255, 255, 255",
    text: "#0a0f1a",
    sub: "#5a6578",
    accent: "#0066ff",
    accent2: "#4f46e5",
    accent3: "#9333ea",
    card: "rgba(255, 255, 255, 0.7)",
    cardHover: "rgba(255, 255, 255, 0.95)",
    border: "rgba(0, 0, 0, 0.06)",
    glow: "rgba(0, 102, 255, 0.08)",
    glowStrong: "rgba(0, 102, 255, 0.2)",
  },
  sepia: {
    bg: "#f5f0e8",
    bg2: "#ebe5d9",
    text: "#3d3929",
    sub: "#7a7260",
    accent: "#8b6914",
    border: "rgba(0, 0, 0, 0.08)",
  },
  semantic: {
    success: "#22c55e",
    error: "#ef4444",
    warning: "#fbbf24",
    info: "#3b82f6",
    orange: "#f97316",
    cyan: "#06b6d4",
    purple: "#7c3aed",
    gold: "#ca8a04",
  },
} as const;

// ─── Gradients ─────────────────────────────────────────────────────────────────

export const gradients = {
  /** Primary accent gradient — headings, CTAs, progress bars */
  accent: "linear-gradient(90deg, #00e1ff, #6366f1)",
  /** Full spectrum — hero text, special elements */
  spectrum: "linear-gradient(90deg, #00e1ff, #6366f1, #a855f7)",
  /** Diagonal accent — badges, decorative */
  diagonal: "linear-gradient(135deg, #00e1ff, #6366f1)",
  /** Vertical — tall decorative elements */
  vertical: "linear-gradient(180deg, #a855f7, #6366f1, #00e1ff)",
  /** Radial glow — background atmosphere */
  radialGlow: "radial-gradient(circle, var(--glow) 0%, transparent 70%)",
  /** Shimmer sweep — card hover effect */
  shimmer: "linear-gradient(105deg, transparent 40%, var(--glow) 50%, transparent 60%)",
  /** Light mode variants */
  accentLight: "linear-gradient(90deg, #0066ff, #4f46e5)",
  spectrumLight: "linear-gradient(90deg, #0066ff, #4f46e5, #9333ea)",
} as const;

// ─── Typography ────────────────────────────────────────────────────────────────

export const fonts = {
  sans: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
  serif: "'Source Serif 4', Georgia, serif",
  arabic: "'Noto Sans Arabic', 'Inter', sans-serif",
  /** Google Fonts import URL */
  googleImport:
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+Arabic:wght@400;600;800&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap",
} as const;

export const fontSize = {
  /** 72px — Hero heading */
  display: "72px",
  /** 56px — Large section heading */
  h1: "56px",
  /** 40px — Medium section heading */
  h2: "40px",
  /** 32px — Subsection heading */
  h3: "32px",
  /** 28px — Article title */
  h4: "28px",
  /** 20px — Subheading */
  h5: "20px",
  /** 18px — Large body / medium heading */
  h6: "18px",
  /** 16px — Default body text */
  base: "16px",
  /** 14px — Card title / subtitle */
  sm: "14px",
  /** 13px — Secondary text */
  xs: "13px",
  /** 12px — Label / medium caption */
  caption: "12px",
  /** 11px — Small label */
  label: "11px",
  /** 10px — Body caption / code comment */
  tiny: "10px",
  /** 9px — Annotation */
  micro: "9px",
  /** 8px — Tag / extra small */
  nano: "8px",
  /** 7px — Badge / minimal */
  min: "7px",
} as const;

export const fontWeight = {
  light: "300",
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} as const;

export const letterSpacing = {
  tighter: "-0.5px",
  tight: "0.3px",
  normal: "0.5px",
  wide: "1px",
  wider: "1.5px",
  widest: "2px",
  hero: "2.5px",
  display: "3px",
} as const;

export const lineHeight = {
  none: "1",
  tight: "1.1",
  snug: "1.2",
  normal: "1.4",
  relaxed: "1.6",
  loose: "1.7",
  reading: "1.8",
} as const;

// ─── Spacing ───────────────────────────────────────────────────────────────────

export const spacing = {
  "0.5": "2px",
  "1": "4px",
  "1.5": "6px",
  "2": "8px",
  "2.5": "10px",
  "3": "12px",
  "3.5": "14px",
  "4": "16px",
  "5": "20px",
  "6": "24px",
  "7": "28px",
  "8": "32px",
  "9": "36px",
  "10": "40px",
  "12": "48px",
} as const;

// ─── Border Radius ─────────────────────────────────────────────────────────────

export const borderRadius = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  DEFAULT: "10px",
  lg: "12px",
  xl: "14px",
  "2xl": "16px",
  "3xl": "20px",
  pill: "100px",
  full: "50%",
} as const;

// ─── Shadows ───────────────────────────────────────────────────────────────────

export const shadows = {
  /** Subtle elevation */
  sm: "0 2px 8px rgba(0, 0, 0, 0.3)",
  /** Medium elevation */
  md: "0 8px 24px rgba(0, 0, 0, 0.2)",
  /** Large elevation */
  lg: "0 8px 32px rgba(0, 0, 0, 0.3)",
  /** Cyan glow (dark mode) */
  glow: "0 8px 32px rgba(0, 225, 255, 0.1)",
  /** Strong cyan glow (dark mode hover) */
  glowStrong: "0 8px 32px rgba(0, 225, 255, 0.25)",
  /** Active state glow */
  glowActive: "0 6px 28px rgba(0, 225, 255, 0.22)",
  /** Blue glow (light mode) */
  glowLight: "0 8px 32px rgba(0, 102, 255, 0.08)",
  /** Top edge light on glassmorphic cards */
  inset: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  /** Stronger inset highlight */
  insetStrong: "inset 0 1px 0 rgba(255, 255, 255, 0.1)",
  /** Complex card shadow stack */
  card: "0 8px 32px -8px var(--glow)",
  /** Modal shadow */
  modal:
    "0 32px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 80px rgba(0, 225, 255, 0.04)",
} as const;

// ─── Text Shadows ──────────────────────────────────────────────────────────────

export const textShadows = {
  glow: "0 0 8px rgba(0, 225, 255, 0.3)",
  glowStrong: "0 0 24px rgba(0, 225, 255, 0.35)",
  glowSubtle: "0 0 8px rgba(0, 225, 255, 0.2)",
  success: "0 0 8px rgba(63, 185, 80, 0.2)",
  error: "0 0 8px rgba(239, 68, 68, 0.4)",
} as const;

// ─── Z-Index ───────────────────────────────────────────────────────────────────

export const zIndex = {
  behind: -1,
  base: 0,
  content: 1,
  card: 2,
  component: 10,
  nav: 50,
  header: 100,
  modal: 1000,
  overlay: 9999,
  preloader: 10000,
  top: 99999,
} as const;

// ─── Transitions ───────────────────────────────────────────────────────────────

export const transitions = {
  /** 0.2s ease — quick icon/toggle changes */
  fast: "all 0.2s ease",
  /** 0.3s custom spring — standard micro-interactions */
  default: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
  /** 0.4s custom spring — medium-paced reveals */
  medium: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
  /** 0.55s custom spring — modal/overlay entrances */
  slow: "all 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
  /** 0.8s elastic — flip/bounce animations */
  elastic: "all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  /** 0.6s — theme/background transitions */
  theme: "background 0.6s, color 0.6s",
} as const;

export const easing = {
  /** iOS-style spring — primary interactive easing */
  spring: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Elastic overshoot — flip cards, pop-ins */
  elastic: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  /** Material Design standard */
  material: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** Standard ease-out */
  out: "ease-out",
  /** Standard ease-in-out */
  inOut: "ease-in-out",
} as const;

// ─── Backdrop Filters ──────────────────────────────────────────────────────────

export const backdrop = {
  light: "blur(8px) saturate(1.1)",
  medium: "blur(20px) saturate(1.4)",
  heavy: "blur(32px) saturate(1.6)",
  max: "blur(40px) saturate(1.6)",
} as const;

// ─── Breakpoints ───────────────────────────────────────────────────────────────

export const breakpoints = {
  /** Extra small devices */
  xs: "380px",
  /** Mobile/tablet — primary responsive breakpoint */
  sm: "600px",
  /** Tablet landscape */
  md: "768px",
  /** Desktop */
  lg: "1024px",
  /** Large desktop */
  xl: "1280px",
} as const;

// ─── Atmosphere Presets (per-app intensity) ─────────────────────────────────────

export const atmosphere = {
  /** Main portfolio site — full intensity */
  main: {
    meshBlobs: 3,
    meshOpacity: 0.06,
    meshBlur: "100px",
    particles: true,
    cursorGlow: true,
    noiseOverlay: true,
  },
  /** Agile Toolkit — reduced for data UIs */
  agile: {
    meshBlobs: 2,
    meshOpacity: 0.04,
    meshBlur: "120px",
    particles: false,
    cursorGlow: false,
    noiseOverlay: true,
  },
  /** Book App — minimal for readability */
  books: {
    meshBlobs: 1,
    meshOpacity: 0.03,
    meshBlur: "140px",
    particles: false,
    cursorGlow: false,
    noiseOverlay: false,
  },
} as const;

// ─── Haptic Feedback Patterns ──────────────────────────────────────────────────

export const haptics = {
  tap: [3],
  toggle: [3, 20, 3],
  menuOpen: [3, 15, 5],
  cardPress: [4],
  cardFlip: [3, 25, 5],
  success: [6, 30, 6, 30, 10],
  warning: [15, 30, 25],
  levelUp: [8, 30, 8, 30, 8, 30, 12, 50, 15],
} as const;
