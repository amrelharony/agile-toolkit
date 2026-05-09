import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Core palette — maps to CSS custom properties for dark/light mode
        bg: "var(--bg)",
        bg2: "var(--bg2)",
        text: "var(--text)",
        sub: "var(--sub)",
        accent: {
          DEFAULT: "var(--accent)",
          2: "var(--accent2)",
          3: "var(--accent3)",
        },
        card: "var(--card)",
        "card-hover": "var(--cardH)",
        border: "var(--border)",
        glow: "var(--glow)",
        "glow-strong": "var(--glowS)",
        // Semantic
        success: "#22c55e",
        error: "#ef4444",
        warning: "#fbbf24",
        info: "#3b82f6",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        serif: ["Source Serif 4", "Georgia", "serif"],
      },
      fontSize: {
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
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "8px",
        DEFAULT: "10px",
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
  plugins: [],
};

export default config;
