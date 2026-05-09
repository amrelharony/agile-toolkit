import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // ── Breakpoint system ──
    // Default Tailwind breakpoints + two additions:
    //   xs   → 375px  iPhone SE / small Android — gives us a safety net
    //                 between 320px (default base) and 640px (sm).
    //   3xl  → 1920px FullHD-and-above for larger info-density layouts.
    // All min-width (mobile-first), evaluated bottom-up.
    screens: {
      xs: "375px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },
    container: {
      center: true,
      // Padding scales mobile-first: 12 → 16 → 24 → 32 → 40px.
      padding: {
        DEFAULT: "0.75rem", // 12px (mobile)
        xs: "1rem",         // 16px
        sm: "1.5rem",       // 24px
        lg: "2rem",         // 32px
        xl: "2.5rem",       // 40px
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1440px",   // cap the container before the 1536/1920 breakpoints
      },
    },
    extend: {
      colors: {
        // ── Design system core palette (CSS custom properties) ──
        bg: {
          DEFAULT: "var(--bg)",
          primary: "var(--bg)",
          secondary: "var(--bg2)",
          card: "var(--card)",
          hover: "var(--cardH)",
        },
        bg2: "var(--bg2)",
        text: {
          DEFAULT: "var(--text)",
          primary: "var(--text)",
          secondary: "var(--sub)",
          muted: "var(--sub)",
        },
        sub: "var(--sub)",
        accent: {
          DEFAULT: "var(--accent)",
          2: "var(--accent2)",
          3: "var(--accent3)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        "card-hover": "var(--cardH)",
        surface: {
          DEFAULT: "var(--surface)",
          deep: "var(--surface-deep)",
          hover: "var(--surface-hover)",
        },
        glow: "var(--glow)",
        "glow-strong": "var(--glowS)",

        // ── Semantic colors ──
        success: "#22c55e",
        error: "#ef4444",
        warning: "#fbbf24",
        info: "#3b82f6",

        // ── shadcn/ui standard keys ──
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },

        // ── Backward-compatible aliases (existing tool pages use these) ──
        "accent-cyan": "var(--accent)",
        "accent-magenta": "#ff00aa",
        "accent-green": "#00ff88",
        "accent-amber": "#ffaa00",
        "status-green": "#22c55e",
        "status-yellow": "#eab308",
        "status-red": "#ef4444",
      },
      fontFamily: {
        // Design system fonts
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
        serif: ["var(--font-serif)", "Source Serif 4", "Georgia", "serif"],
        // Backward-compatible aliases
        display: ["var(--font-mono)", "monospace"],
        body: ["var(--font-inter)", "sans-serif"],
        data: ["var(--font-mono)", "monospace"],
      },
      fontSize: {
        // ── Static design-system scale (existing usage; do not break) ──
        display: ["72px", { lineHeight: "1", letterSpacing: "-0.5px" }],
        h1: ["56px", { lineHeight: "1.1" }],
        h2: ["40px", { lineHeight: "1.1" }],
        h3: ["32px", { lineHeight: "1.2" }],
        h4: ["28px", { lineHeight: "1.2", letterSpacing: "-0.5px" }],
        h5: ["20px", { lineHeight: "1.4" }],
        body: ["14px", { lineHeight: "1.6" }],
        label: ["11px", { lineHeight: "1", letterSpacing: "2px" }],
        caption: ["12px", { lineHeight: "1.4" }],
        tiny: ["10px", { lineHeight: "1.4" }],
        micro: ["9px", { lineHeight: "1" }],
        nano: ["8px", { lineHeight: "1", letterSpacing: "1.5px" }],

        // ── Fluid scale (mobile-first, no-media-query) ──
        // Uses clamp(min, viewport-relative, max). Use these for any text
        // that should scale smoothly between 320px and ~1440px viewports.
        // The "ideal" middle term is sized so the text reaches its max
        // around the 1024px breakpoint and stays static beyond.
        "fluid-display": ["clamp(2.5rem, 1.6rem + 4.5vw, 4.5rem)", { lineHeight: "1.05", letterSpacing: "-0.5px" }],
        "fluid-h1":      ["clamp(1.75rem, 1.25rem + 2.5vw, 3rem)",  { lineHeight: "1.15" }],
        "fluid-h2":      ["clamp(1.5rem, 1.15rem + 1.75vw, 2.25rem)", { lineHeight: "1.2" }],
        "fluid-h3":      ["clamp(1.25rem, 1rem + 1.25vw, 1.75rem)",   { lineHeight: "1.25" }],
        "fluid-h4":      ["clamp(1.125rem, 0.95rem + 0.85vw, 1.5rem)", { lineHeight: "1.3" }],
        "fluid-body":    ["clamp(0.875rem, 0.83rem + 0.2vw, 1rem)",   { lineHeight: "1.55" }],
      },
      spacing: {
        // ── WCAG 2.2 minimum touch target ──
        // Use as `min-w-touch min-h-touch` (or `size-touch`) on any
        // tap-target. 44px = 11 in Tailwind's 4px scale.
        touch: "2.75rem",        // 44px
        "touch-sm": "2.25rem",   // 36px — for desktop-only secondary controls
        // Common content widths
        "screen-90": "90vw",
        "screen-80": "80vw",
      },
      maxWidth: {
        // Reading-width helpers, in addition to Tailwind defaults.
        prose: "65ch",
        "tool-content": "80rem",  // 1280px
        "tool-narrow": "48rem",   // 768px
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        DEFAULT: "var(--radius)",
        lg: "12px",
        xl: "14px",
        "2xl": "16px",
        "3xl": "20px",
        pill: "100px",
      },
      boxShadow: {
        sm: "0 2px 8px rgba(0, 0, 0, 0.3)",
        md: "0 8px 24px rgba(0, 0, 0, 0.2)",
        lg: "0 8px 32px rgba(0, 0, 0, 0.3)",
        glow: "0 8px 32px rgba(0, 225, 255, 0.1)",
        "glow-strong": "0 8px 32px rgba(0, 225, 255, 0.25)",
        "glow-active": "0 6px 28px rgba(0, 225, 255, 0.22)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        card: "0 8px 32px -8px var(--glow)",
        modal:
          "0 32px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 80px rgba(0, 225, 255, 0.04)",
        // Backward-compatible neon aliases
        "neon-cyan": "0 0 20px rgba(0, 225, 255, 0.3)",
        "neon-magenta": "0 0 20px rgba(255, 0, 170, 0.3)",
        "neon-green": "0 0 20px rgba(0, 255, 136, 0.3)",
        "neon-amber": "0 0 20px rgba(255, 170, 0, 0.3)",
      },
      backgroundImage: {
        "gradient-accent": "linear-gradient(90deg, #00e1ff, #6366f1)",
        "gradient-spectrum":
          "linear-gradient(90deg, #00e1ff, #6366f1, #a855f7)",
        "gradient-diagonal": "linear-gradient(135deg, #00e1ff, #6366f1)",
        "gradient-shimmer":
          "linear-gradient(105deg, transparent 40%, var(--glow) 50%, transparent 60%)",
      },
      keyframes: {
        // Design system animations
        "mesh-float-1": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(5vw, 8vh) scale(1.1)" },
          "66%": { transform: "translate(-3vw, -5vh) scale(0.95)" },
        },
        "mesh-float-2": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(-8vw, -4vh) scale(1.15)" },
          "66%": { transform: "translate(4vw, 6vh) scale(0.9)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(0, 225, 255, 0)",
          },
          "50%": {
            boxShadow: "0 0 12px 2px rgba(0, 225, 255, 0.12)",
          },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        // Radix UI keyframes
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "mesh-1": "mesh-float-1 20s ease-in-out infinite",
        "mesh-2": "mesh-float-2 25s ease-in-out infinite",
        "fade-in": "fade-in 0.4s ease-out forwards",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        shimmer: "shimmer 0.8s ease forwards",
        skeleton: "skeleton-shimmer 1.5s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        "gradient-text": "gradient-shift 6s ease-in-out infinite",
        float: "float 3s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
        elastic: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      },
      transitionDuration: {
        fast: "200ms",
        default: "300ms",
        medium: "400ms",
        slow: "550ms",
      },
      zIndex: {
        behind: "-1",
        base: "0",
        content: "1",
        card: "2",
        component: "10",
        nav: "50",
        header: "100",
        modal: "1000",
        overlay: "9999",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Container-query support: enables `@container` on a parent element
    // and per-card breakpoint variants like `@sm:grid-cols-2`. Used in
    // /insights so each card scales based on its own width — important
    // when the sidebar collapse changes available content width without
    // crossing a viewport breakpoint.
    require("@tailwindcss/container-queries"),
  ],
};
export default config;
