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
        "reading": ["18px", { lineHeight: "1.8" }],
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
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
        card: "0 8px 32px -8px var(--glow)",
        "book-cover": "0 4px 12px rgba(0, 0, 0, 0.3)",
      },
      backgroundImage: {
        "gradient-accent": "linear-gradient(90deg, #00e1ff, #6366f1)",
        "gradient-spectrum": "linear-gradient(90deg, #00e1ff, #6366f1, #a855f7)",
        "gradient-diagonal": "linear-gradient(135deg, #00e1ff, #6366f1)",
      },
      keyframes: {
        "mesh-float-1": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(5vw, 8vh) scale(1.1)" },
          "66%": { transform: "translate(-3vw, -5vh) scale(0.95)" },
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
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "mesh-1": "mesh-float-1 20s ease-in-out infinite",
        "fade-in": "fade-in 0.4s ease-out forwards",
        "slide-up": "slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "scale-in": "scale-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        shimmer: "shimmer 0.8s ease forwards",
        "gradient-text": "gradient-shift 6s ease-in-out infinite",
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
      maxWidth: {
        reading: "680px",
      },
    },
  },
  plugins: [],
};

export default config;
