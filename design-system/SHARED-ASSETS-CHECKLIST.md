# Shared Assets Checklist — amrelharony.com Ecosystem

Assets that must be consistent across all three sites: Main Site, Agile Toolkit, Book App.

---

## 1. Fonts (Google Fonts Import)

All three apps MUST load the same font families with the same weights:

```
https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+Arabic:wght@400;600;800&family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&display=swap
```

**Next.js apps** should use `next/font/google` for automatic optimization:
- `Inter` — Primary sans-serif (UI, headings, body)
- `JetBrains Mono` — Monospace (labels, tags, code, timestamps)
- `Source Serif 4` — Serif (long-form article/book content)
- `Noto Sans Arabic` — Arabic text (if applicable)

**Performance:** Always preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`.

---

## 2. Favicon Set

Generate from the same source logo/monogram. Required files:

| File | Size | Purpose |
|------|------|---------|
| `favicon.ico` | 32x32 | Browser tab icon |
| `favicon-16x16.png` | 16x16 | Small contexts |
| `favicon-32x32.png` | 32x32 | Standard contexts |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `android-chrome-192x192.png` | 192x192 | Android home screen |
| `android-chrome-512x512.png` | 512x512 | Android splash |
| `safari-pinned-tab.svg` | vector | Safari pinned tab |
| `site.webmanifest` | JSON | PWA manifest |

**Theme color:** `#06080f` (dark mode background)

---

## 3. Open Graph Image Template

Consistent OG image layout across all sites:

```
┌──────────────────────────────────────┐
│  ◆ AE                                │
│                                       │
│  [Page Title]                         │
│  [Subtitle / Description]             │
│                                       │
│  amrelharony.com | agile. | books.    │
│  ─────────────── gradient bar ─────── │
└──────────────────────────────────────┘
```

- Background: `#06080f`
- Title: Inter 800, white
- Gradient bar: `linear-gradient(90deg, #00e1ff, #6366f1, #a855f7)`
- Monogram: "AE" in gradient text (top-left)
- Subdomain indicator: JetBrains Mono, `#8a95a8`
- Size: 1200x630px

---

## 4. Icon Library

Use **Lucide React** (`lucide-react`) across all apps. Consistent size/stroke:
- Navigation icons: `w-4 h-4` (18px)
- Card icons: `w-5 h-5` (20px)
- Hero/feature icons: `w-6 h-6` (24px)
- Stroke width: default (2px)

Do NOT mix icon libraries. All sites use Lucide exclusively.

---

## 5. Shared CSS Custom Properties

All three sites MUST define the same `:root` CSS custom properties:

```css
:root {
  --bg: #06080f;
  --bg2: #0c1018;
  --bg2-rgb: 12, 16, 24;
  --text: #f0f2f5;
  --sub: #8a95a8;
  --accent: #00e1ff;
  --accent2: #6366f1;
  --accent3: #a855f7;
  --card: rgba(12, 16, 24, 0.65);
  --cardH: rgba(255, 255, 255, 0.07);
  --border: rgba(255, 255, 255, 0.08);
  --glow: rgba(0, 225, 255, 0.15);
  --glowS: rgba(0, 225, 255, 0.4);
}
```

Light mode and sepia mode variables must also match exactly.

---

## 6. Shared Meta Patterns

### HTML `<head>` (all sites):
```html
<meta name="theme-color" content="#06080f" />
<meta name="author" content="Amr El Harony" />
<link rel="canonical" href="https://[subdomain].amrelharony.com" />
```

### JSON-LD (all sites):
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "[App Name]",
  "url": "https://[subdomain].amrelharony.com",
  "author": {
    "@type": "Person",
    "name": "Amr El Harony",
    "url": "https://amrelharony.com"
  }
}
```

---

## 7. Cross-App Navigation Component

The `EcosystemNav` component (see `shared/EcosystemNav.tsx`) must be present on ALL three sites, imported and placed as the first child of `<body>`.

```tsx
// Main site:
<EcosystemNav currentApp="main" />

// Agile Toolkit:
<EcosystemNav currentApp="agile" />

// Book App:
<EcosystemNav currentApp="books" />
```

---

## 8. Common SVG Elements

### Noise Overlay (shared across main + agile):
```
data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E
```

### Gradient Bar (decorative):
```css
.gradient-bar {
  height: 2px;
  background: linear-gradient(90deg, #00e1ff, #6366f1, #a855f7);
  border-radius: 1px;
}
```

---

## 9. Design Token Files

All ecosystem apps should reference the canonical tokens in:
- `design-system/tokens.ts` — TypeScript design tokens
- `design-system/animations.css` — Shared keyframes & utilities
- `design-system/DNA-SPEC.md` — Full specification document

When building a new app in the ecosystem, start by copying:
1. `tailwind.config.ts` from the relevant app template
2. `globals.css` from the relevant app template
3. `EcosystemNav.tsx` from `shared/`

---

## 10. Per-App Atmosphere Intensity

| Layer | Main Site | Agile Toolkit | Book App |
|-------|-----------|---------------|----------|
| Mesh blobs | 3 at 0.06-0.08 | 2 at 0.04 | 1 at 0.03 |
| Mesh blur | 100px | 120px | 140px |
| Noise overlay | Yes (0.02) | Yes (0.02) | No |
| Cursor glow | Yes | No | No |
| Particles | Yes | No | No |
| Fluid sim | Yes | No | No |

**Why these differences:**
- **Agile Toolkit:** Needs visual clarity for charts, tables, and data-heavy UIs. Reduced atmosphere prevents visual noise competing with information density.
- **Book App:** Needs maximum readability for sustained reading. Minimal atmosphere provides just enough "family resemblance" without fatiguing the eyes.
