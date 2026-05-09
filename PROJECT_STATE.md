# Agile Toolkit — Project State
> Last updated: 2026-04-21 | 42 tools across 9 categories, compiling clean, production build green.

## Summary
Full-stack Agile toolkit at agile.amrelharony.com — **42 tools** built with Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, Recharts, Zustand + persist. Three cross-cutting systems: **Workspace** (shared data spine), **Analytics Engine** (forecasting + anti-patterns), **Realtime Layer** (Supabase).

---

## Tool Inventory — 42 Total

### Sprint Planning & Estimation (7)
| Code | Route | Tool |
|------|-------|------|
| A1 | /planning-poker | Planning Poker |
| A2 | /capacity-planner | Sprint Capacity Planner |
| A3 | /story-mapper | User Story Mapper |
| A4 | /prioritizer | Backlog Prioritizer |
| A5 | /estimation-guide | Estimation Reference Guide |
| A6 | /sprint-goal | Sprint Goal Builder |
| A7 | /release-planner | Release Planner (Monte Carlo) |

### Metrics & Dashboards (7)
| Code | Route | Tool |
|------|-------|------|
| B1 | /burndown | Burndown Generator |
| B2 | /burnup | Burnup Generator |
| B3 | /velocity | Velocity Tracker |
| B4 | /cumulative-flow | Cumulative Flow Diagram |
| B5 | /cycle-time | Cycle Time Analyzer |
| B6 | /sprint-compare | Sprint Comparison |
| B7 | /health-dashboard | Agile Health Dashboard (Insights hub) |

### Ceremonies (6)
| Code | Route | Tool |
|------|-------|------|
| C1 | /retro | Retro Board |
| C2 | /standup | Standup Tracker |
| C3 | /sprint-review | Sprint Review Kit |
| C4 | /ceremony-timer | Ceremony Timer |
| C5 | /refinement | Refinement Checklist |
| C6 | /icebreaker | Ice Breaker Generator |

### Team Health & Maturity (5)
| Code | Route | Tool |
|------|-------|------|
| D1 | /health-check | Squad Health Check |
| D2 | /maturity | Agile Maturity Assessment |
| D3 | /raci | RACI Matrix Builder |
| D4 | /skills-matrix | Team Skills Matrix |
| D5 | /impediments | Impediment Tracker |

### Portfolio & Scaling (3) — NEW
| Code | Route | Tool |
|------|-------|------|
| A8 | /pi-planning | PI Planning Board (SAFe) |
| A9 | /epic-roadmap | Epic Roadmap |
| C7 | /scrum-of-scrums | Scrum of Scrums Tracker |

### Product Discovery (3) — NEW
| Code | Route | Tool |
|------|-------|------|
| A10 | /hypothesis-tracker | Hypothesis Tracker |
| A11 | /user-interviews | User Interview Log |
| A12 | /opportunity-tree | Opportunity Solution Tree |

### Risk & Governance (5) — NEW
| Code | Route | Tool |
|------|-------|------|
| D6 | /risk-register | Risk Register (5×5 matrix) |
| D7 | /tech-debt | Technical Debt Tracker |
| D12 | /decision-log | Decision Log (ADR) |
| C8 | /premortem | Premortem Facilitator |
| C9 | /dod-builder | Definition of Done Builder |

### Flow & Delivery (3) — NEW
| Code | Route | Tool |
|------|-------|------|
| B8 | /kanban | Kanban Board (WIP-limited) |
| B9 | /value-stream | Value Stream Map |
| D8 | /dependency-map | Dependency Map |

### Outcomes & Pulse (3) — NEW
| Code | Route | Tool |
|------|-------|------|
| D9 | /okrs | OKR Tracker |
| D10 | /nps-csat | NPS / CSAT Tracker |
| D11 | /mood-tracker | Team Mood Tracker |

---

## Cross-Cutting Systems

### 1. Workspace (Cross-Tool Intelligence)
- `src/lib/stores/workspace-store.ts` — central Zustand store, persisted as `agile-toolkit:workspace`
- Canonical entities: team members, sprints, stories, impediments, risks, OKRs, decisions, tech debt
- `WorkspaceSyncButton` component for any tool to push/import data

### 2. Analytics Engine (Client-Only, Pure Math)
- `src/lib/analytics/monte-carlo.ts` — generalized simulations (release planning, capacity, PI)
- `src/lib/analytics/forecasting.ts` — linear regression, Holt's smoothing, confidence bands
- `src/lib/analytics/survival.ts` — Kaplan-Meier for impediment/risk/debt aging
- `src/lib/analytics/anomaly.ts` — z-score + IQR outlier detection, trend direction
- `src/lib/analytics/anti-patterns.ts` — rule engine: stale impediments, commitment erosion, velocity decline, bus-factor risk, risk stacking, tech-debt acceleration
- `src/lib/analytics/insights.ts` — combines the above into `Insight[]`
- `src/components/shared/insights-engine.tsx` — renders top signals at the top of every tool page (auto-injected via ToolPageWrapper)
- `src/components/charts/forecast-band.tsx` — Recharts chart with 80/95% confidence bands

### 3. Realtime Layer (Supabase-Ready)
- `src/lib/realtime/supabase-client.ts` — lazy-init, no-op if env unset
- `src/lib/realtime/use-room.ts` — `useRoom(toolId, roomId)` hook (presence + broadcast + state sync)
- `src/lib/realtime/use-presence.ts` — simplified presence hook
- `src/components/shared/multiplayer-chip.tsx` — avatar stack for rooms
- `src/components/shared/invite-dialog.tsx` — generate/share room URLs
- `supabase/migrations/0001_init.sql` — rooms + room_state schema with RLS
- Graceful fallback: all realtime-capable tools work local-only when env unset
- Realtime tools: planning-poker, retro, story-mapper, standup, impediments, pi-planning, scrum-of-scrums, risk-register, premortem, kanban, dependency-map, okrs, mood-tracker, decision-log, health-check

---

## AI Prompt Generator (prompts-only, no LLM API)
- Every tool mounts `<AiPromptGenerator config={promptConfig} />` (right-side sheet)
- Per-tool generator at `src/lib/ai-prompts/{tool-id}.ts`
- Shared helpers in `src/lib/ai-prompts/prompt-utils.ts`: `buildPreamble`, `formatTable`, `truncateData`, `formatDate`
- Cross-tool context helper: `src/lib/ai-prompts/cross-tool-context.ts` (`buildWorkspaceContext`, `maturityAdvice`)

## Architecture
- **Framework:** Next.js 14 App Router, TypeScript strict
- **Styling:** Tailwind CSS v3, cyberpunk dark theme
- **UI:** shadcn/ui (new-york style)
- **State:** Zustand + persist, keys `agile-toolkit:{tool-id}`
- **Charts:** Recharts (ComposedChart, BarChart, AreaChart, LineChart, RadarChart)
- **Animation:** framer-motion
- **Drag & drop:** @dnd-kit/core + @dnd-kit/sortable
- **Realtime:** @supabase/supabase-js (lazy-init, env-gated)

## Key Files
- `src/lib/constants/tools.ts` — Tool registry (all 42 tools, 9 categories, analyticsFeatures flags)
- `src/components/layout/tool-page-wrapper.tsx` — Auto-injects InsightsEngine via `toolId` prop
- `src/components/shared/export-button.tsx` — Export (PNG/CSV/JSON/clipboard)
- `src/components/shared/insights-engine.tsx` — Top-of-page anti-pattern signals
- `src/components/shared/workspace-sync-button.tsx` — Pull/push workspace entities
- `src/components/charts/forecast-band.tsx` — Forecast chart with 80/95% bands
- `src/app/page.tsx` — Home with All/Smart/Live/New filter chips + insights banner
- `src/app/(tools)/health-dashboard/health-dashboard-client.tsx` — Insights hub

## Pending Work
1. Supabase project provisioning + env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`); run migration `supabase/migrations/0001_init.sql`
2. Vercel deployment — `npx vercel` then point agile.amrelharony.com DNS
3. SEO — OG images, sitemap.xml, JSON-LD
4. PWA — next-pwa service worker
5. Analytics — Vercel Analytics or PostHog
6. Deeper per-tool workspace push/pull wiring for existing 25 tools (infrastructure is in place; each tool currently opt-in by adding a `<WorkspaceSyncButton>` and calling `useWorkspaceStore`)

## Dev Commands
```bash
cd "D:/Claude Desktop/Agile Toolkit"
npx next dev --port 3000      # Start dev server
npx next build                # Production build (42 static routes)
npx vercel                    # Deploy to Vercel
```
