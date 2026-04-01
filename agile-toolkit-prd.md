# 🚀 Agile Toolkit PRD — agile.amrelharony.com

## Product Vision

**A free, open, ultra-advanced suite of 25+ interactive Agile tools** — serving as both a daily-use toolkit for Scrum Masters and a public showcase of Amr El Harony's Agile expertise. Think "Swiss Army knife for Agile practitioners" with a cyberpunk-meets-professional aesthetic.

---

## 1. Stack Recommendation

### Why Next.js 14 + Supabase + Vercel (All Free Tier)

| Layer | Technology | Why | Free Tier Limits |
|-------|-----------|-----|-----------------|
| **Framework** | Next.js 14 (App Router) | SSR for SEO (public showcase), API routes built-in, React ecosystem | Unlimited |
| **Hosting** | Vercel | Zero-config deploy, edge functions, automatic HTTPS | 100GB bandwidth/mo |
| **Database** | Supabase PostgreSQL | Auth, Realtime (for multiplayer tools), Row-Level Security | 500MB DB, 50K MAU |
| **Auth** | Supabase Auth | Social login, magic link, anonymous sessions for guests | 50K MAU |
| **Styling** | Tailwind CSS + shadcn/ui | Rapid, consistent, accessible components | Open source |
| **Charts** | Recharts + D3.js | React-native charting + advanced visualizations | Open source |
| **Animation** | Framer Motion | Smooth transitions between tools | Open source |
| **State** | Zustand | Lightweight global state (simpler than Redux) | Open source |
| **Real-time** | Supabase Realtime | WebSocket channels for Planning Poker, Retro boards | 200 concurrent |
| **Domain** | Cloudflare DNS | Subdomain agile.amrelharony.com → Vercel | Free |
| **Analytics** | Plausible (self-hosted) or Vercel Analytics | Privacy-respecting usage tracking | Free tier |

### Architecture Pattern: Hybrid Client-Server

```
┌─────────────────────────────────────────────────────┐
│                    NEXT.JS APP                       │
├──────────────┬──────────────┬───────────────────────┤
│  SSR Pages   │  Client Tools │  API Routes          │
│  (SEO/Landing│  (Calculators,│  (/api/export,       │
│   Tool Index)│   Generators) │   /api/share)        │
├──────────────┴──────────────┴───────────────────────┤
│              SUPABASE (when needed)                  │
│  Auth │ PostgreSQL │ Realtime │ Storage              │
└─────────────────────────────────────────────────────┘
```

**Key insight:** Most tools work 100% client-side (no backend needed). Only multiplayer/persistent tools (Planning Poker, Retro Board, Sprint Tracking) hit Supabase. This keeps it fast, free, and scalable.

---

## 2. Complete Tool Inventory (25 Tools)

### Category A: Sprint Planning & Estimation (7 tools)

| # | Tool | Complexity | Backend? | Description |
|---|------|-----------|----------|-------------|
| A1 | **Planning Poker** | High | ✅ Realtime | Real-time multiplayer estimation. Create room → share link → vote → reveal → converge. Fibonacci, T-shirt, custom scales. |
| A2 | **Sprint Capacity Planner** | Medium | ❌ Client | Input team members, availability %, holidays, ceremony overhead → calculate actual sprint capacity in hours/points. Export to clipboard/CSV. |
| A3 | **User Story Mapper** | High | ✅ DB | Drag-and-drop story mapping board. Horizontal: user journey steps. Vertical: priority slices. Supports backbone → walking skeleton → MVP grouping. |
| A4 | **Backlog Prioritizer** | Medium | ❌ Client | Multi-framework prioritization: MoSCoW, WSJF (Weighted Shortest Job First), RICE (Reach, Impact, Confidence, Effort), Value vs. Effort matrix. Auto-rank and export. |
| A5 | **Estimation Reference Guide** | Low | ❌ Client | Interactive story point reference chart. Define your team's baseline (what's a 1, 3, 5, 8, 13?) with examples. Shareable team calibration document. |
| A6 | **Sprint Goal Builder** | Low | ❌ Client | Guided wizard: Business objective → Sprint Goal → Acceptance Criteria → Key Results. Outputs formatted sprint goal with SMART validation. |
| A7 | **Release Planner** | Medium | ❌ Client | Input velocity, backlog size, team capacity → Monte Carlo simulation for release date forecasting with confidence intervals (50%, 85%, 95%). |

### Category B: Metrics & Dashboards (7 tools)

| # | Tool | Complexity | Backend? | Description |
|---|------|-----------|----------|-------------|
| B1 | **Burndown Generator** | Medium | ❌ Client | Input sprint data (total points, daily remaining) → interactive burndown chart with ideal line, actual line, scope change markers. Export as PNG/SVG. |
| B2 | **Burnup Generator** | Medium | ❌ Client | Shows total scope vs. completed work over time. Highlights scope creep visually. Supports multi-sprint overlay. |
| B3 | **Velocity Tracker** | Medium | ❌ Client | Input committed vs. completed points per sprint → velocity chart with rolling average, trend line, and predictability score (% of commitment met). |
| B4 | **Cumulative Flow Diagram** | Medium | ❌ Client | Input WIP data by status per day → stacked area chart showing flow efficiency, bottleneck detection, WIP limit violations. |
| B5 | **Cycle Time Analyzer** | Medium | ❌ Client | Input item start/end dates → histogram, scatter plot, percentile analysis (50th, 85th, 95th). SLE (Service Level Expectation) calculator. |
| B6 | **Sprint Comparison** | Medium | ❌ Client | Side-by-side radar chart comparing sprints across 6 dimensions: velocity, quality (bugs), scope stability, team happiness, goal achievement, predictability. |
| B7 | **Agile Health Dashboard** | High | ✅ DB | Aggregate dashboard pulling data from other tools. Team-level KPIs with traffic-light status. Trend arrows. Executive summary auto-generator. |

### Category C: Ceremonies (6 tools)

| # | Tool | Complexity | Backend? | Description |
|---|------|-----------|----------|-------------|
| C1 | **Retro Board** | High | ✅ Realtime | Real-time collaborative retrospective. 8 formats: Start/Stop/Continue, 4Ls, Sailboat, Mad/Sad/Glad, DAKI, Starfish, Lean Coffee, Timeline. Vote, group, action items. |
| C2 | **Standup Tracker** | Medium | ✅ DB | Daily standup log: Yesterday/Today/Blockers per person. Tracks parking lot items, blocker aging, and standup duration. Weekly digest export. |
| C3 | **Sprint Review Kit** | Low | ❌ Client | Template generator for Sprint Review: demo script builder, stakeholder feedback form, increment showcase checklist, velocity summary card. |
| C4 | **Ceremony Timer** | Low | ❌ Client | Smart timeboxing timer with presets (15min standup, 1hr planning, 1.5hr retro, etc.). Visual countdown with sound alerts. Supports per-person rotation timing. |
| C5 | **Refinement Checklist** | Low | ❌ Client | Interactive Definition of Ready checklist. Customizable criteria. Tracks refinement pass rate over time. |
| C6 | **Ice Breaker Generator** | Low | ❌ Client | Random Agile-themed icebreaker/energizer picker for ceremony openers. 50+ activities categorized by time, team size, and energy level. |

### Category D: Team Health & Maturity (5 tools)

| # | Tool | Complexity | Backend? | Description |
|---|------|-----------|----------|-------------|
| D1 | **Squad Health Check** | Medium | ✅ DB | Spotify-model health check. Team rates dimensions (Delivering Value, Speed, Mission, Fun, Learning, etc.) with traffic lights. Historical trend tracking. |
| D2 | **Agile Maturity Assessment** | Medium | ❌ Client | Comprehensive assessment across 5 levels (Initial → Optimizing) covering 8 dimensions. Radar chart output with improvement roadmap. |
| D3 | **RACI Matrix Builder** | Low | ❌ Client | Interactive RACI generator. Input roles + activities → drag-and-drop R/A/C/I assignment. Validation (exactly one A per row). Export to CSV/clipboard. |
| D4 | **Team Skills Matrix** | Medium | ❌ Client | Visual skills/competency matrix. Team members × skills grid with proficiency levels. Identifies single points of failure and cross-training opportunities. |
| D5 | **Impediment Tracker** | Medium | ✅ DB | Log, categorize, and track impediments. Aging indicators, escalation status, resolution time metrics. Categories: Technical, Organizational, External, Process. |

---

## 3. Data Model (Supabase PostgreSQL)

```sql
-- Only needed for persistent/realtime tools
-- Most tools are 100% client-side with localStorage + export

-- Users (extends Supabase Auth)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user', -- 'admin' | 'user' | 'guest'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Workspaces (group tools data by team)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES profiles(id),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Planning Poker Sessions
CREATE TABLE poker_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  title TEXT NOT NULL,
  scale TEXT DEFAULT 'fibonacci', -- 'fibonacci' | 'tshirt' | 'custom'
  custom_scale JSONB,
  status TEXT DEFAULT 'voting', -- 'voting' | 'revealed' | 'closed'
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE poker_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES poker_sessions(id) ON DELETE CASCADE,
  story_title TEXT,
  voter_id UUID REFERENCES profiles(id),
  vote TEXT,
  revealed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Retro Boards
CREATE TABLE retro_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  format TEXT DEFAULT 'start_stop_continue',
  title TEXT,
  status TEXT DEFAULT 'open', -- 'open' | 'voting' | 'discussing' | 'closed'
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE retro_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES retro_sessions(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL, -- 'start' | 'stop' | 'continue' | etc.
  content TEXT NOT NULL,
  author_id UUID REFERENCES profiles(id),
  votes INT DEFAULT 0,
  group_id UUID, -- for clustering related cards
  action_item BOOLEAN DEFAULT false,
  action_assignee TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Squad Health Checks
CREATE TABLE health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  sprint_name TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE health_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_check_id UUID REFERENCES health_checks(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL, -- 'delivering_value' | 'speed' | 'fun' | etc.
  rating TEXT NOT NULL, -- 'green' | 'yellow' | 'red'
  trend TEXT, -- 'up' | 'same' | 'down'
  respondent_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Standup Logs
CREATE TABLE standup_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  date DATE DEFAULT CURRENT_DATE,
  member_name TEXT NOT NULL,
  yesterday TEXT,
  today TEXT,
  blockers TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Impediments
CREATE TABLE impediments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT, -- 'technical' | 'organizational' | 'external' | 'process'
  severity TEXT DEFAULT 'medium', -- 'low' | 'medium' | 'high' | 'critical'
  status TEXT DEFAULT 'open', -- 'open' | 'escalated' | 'resolved'
  raised_by TEXT,
  assigned_to TEXT,
  raised_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Row Level Security Policies
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE poker_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE retro_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
-- (policies omitted for brevity — workspace members can CRUD their workspace data)
```

---

## 4. Project Structure

```
agile.amrelharony.com/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with nav + theme
│   │   ├── page.tsx                # Landing/dashboard
│   │   ├── (tools)/
│   │   │   ├── planning-poker/     # A1
│   │   │   ├── capacity-planner/   # A2
│   │   │   ├── story-mapper/       # A3
│   │   │   ├── prioritizer/        # A4
│   │   │   ├── estimation-guide/   # A5
│   │   │   ├── sprint-goal/        # A6
│   │   │   ├── release-planner/    # A7
│   │   │   ├── burndown/           # B1
│   │   │   ├── burnup/             # B2
│   │   │   ├── velocity/           # B3
│   │   │   ├── cumulative-flow/    # B4
│   │   │   ├── cycle-time/         # B5
│   │   │   ├── sprint-compare/     # B6
│   │   │   ├── health-dashboard/   # B7
│   │   │   ├── retro/              # C1
│   │   │   ├── standup/            # C2
│   │   │   ├── sprint-review/      # C3
│   │   │   ├── ceremony-timer/     # C4
│   │   │   ├── refinement/         # C5
│   │   │   ├── icebreaker/         # C6
│   │   │   ├── health-check/       # D1
│   │   │   ├── maturity/           # D2
│   │   │   ├── raci/               # D3
│   │   │   ├── skills-matrix/      # D4
│   │   │   └── impediments/        # D5
│   │   └── api/
│   │       ├── export/             # CSV/PNG export endpoints
│   │       └── share/              # Shareable link generation
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components
│   │   ├── layout/                 # Sidebar, Header, ToolCard
│   │   ├── charts/                 # Reusable chart components
│   │   └── shared/                 # DataTable, ExportButton, Timer
│   ├── lib/
│   │   ├── supabase/               # Client + server clients
│   │   ├── stores/                 # Zustand stores
│   │   ├── utils/                  # Calculations, formatters
│   │   └── constants/              # Scales, templates, presets
│   └── styles/
│       └── globals.css             # Tailwind + CSS variables
├── public/
│   ├── og/                         # Open Graph images per tool
│   └── icons/                      # Tool icons (SVG)
├── supabase/
│   └── migrations/                 # SQL migrations
├── next.config.js
├── tailwind.config.ts
├── package.json
└── vercel.json
```

---

## 5. UI/UX Design Direction

### Aesthetic: "Cyber Professional"
A fusion of Amr's cyberpunk preference with clean professional tooling — dark mode default with neon accents, but readable and functional above all.

**Color System:**
```css
:root {
  /* Base */
  --bg-primary: #0a0e1a;
  --bg-secondary: #111827;
  --bg-card: #1a1f36;
  --bg-hover: #242b45;
  
  /* Accents */
  --accent-cyan: #00f0ff;
  --accent-magenta: #ff00aa;
  --accent-green: #00ff88;
  --accent-amber: #ffaa00;
  
  /* Text */
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  
  /* Status (Agile traffic lights) */
  --status-green: #22c55e;
  --status-yellow: #eab308;
  --status-red: #ef4444;
}
```

**Typography:**
- Display: **JetBrains Mono** (tech/cyberpunk headers)
- Body: **Outfit** (modern, readable sans-serif)
- Data: **IBM Plex Mono** (charts, metrics, numbers)

**Navigation:**
- Collapsible sidebar with 4 category groups
- Each tool has an icon + name + "beta" / "new" badges
- Quick search (⌘K) to jump between tools
- Breadcrumb: Category → Tool Name

---

## 6. Phased Build Plan

### Phase 1: Foundation + Quick Wins (Week 1-2)
**Goal:** Ship 6 client-side tools + landing page

| Task | Tools |
|------|-------|
| Next.js project setup, Tailwind, shadcn/ui | — |
| Landing page with tool directory | — |
| Sidebar navigation + layout | — |
| Sprint Capacity Planner | A2 |
| Sprint Goal Builder | A6 |
| Ceremony Timer | C4 |
| RACI Matrix Builder | D3 |
| Estimation Reference Guide | A5 |
| Ice Breaker Generator | C6 |
| Deploy to Vercel + Cloudflare subdomain | — |

### Phase 2: Charts & Metrics (Week 3-4)
**Goal:** Ship 6 metrics tools with interactive charts

| Task | Tools |
|------|-------|
| Reusable chart component library (Recharts) | — |
| Burndown Generator | B1 |
| Burnup Generator | B2 |
| Velocity Tracker | B3 |
| Cumulative Flow Diagram | B4 |
| Cycle Time Analyzer | B5 |
| Sprint Comparison | B6 |
| CSV import + PNG/SVG export | — |

### Phase 3: Supabase + Multiplayer (Week 5-7)
**Goal:** Ship 4 real-time/persistent tools

| Task | Tools |
|------|-------|
| Supabase setup (auth, DB, realtime) | — |
| Planning Poker (real-time) | A1 |
| Retro Board (real-time, 8 formats) | C1 |
| Squad Health Check (persistent) | D1 |
| Standup Tracker (persistent) | C2 |
| Shareable room links + anonymous guests | — |

### Phase 4: Advanced Tools (Week 8-10)
**Goal:** Ship remaining 7 tools

| Task | Tools |
|------|-------|
| User Story Mapper (drag-and-drop) | A3 |
| Backlog Prioritizer | A4 |
| Release Planner (Monte Carlo) | A7 |
| Agile Maturity Assessment | D2 |
| Team Skills Matrix | D4 |
| Impediment Tracker | D5 |
| Sprint Review Kit | C3 |
| Refinement Checklist | C5 |

### Phase 5: Polish + Brand (Week 11-12)
**Goal:** Production-ready showcase

| Task | Tools |
|------|-------|
| Agile Health Dashboard (aggregate) | B7 |
| SEO optimization (meta, OG images per tool) | — |
| PWA support (offline capable) | — |
| Workspace management UI | — |
| Documentation / how-to guides | — |
| Analytics integration | — |
| Personal brand integration (link to amrelharony.com) | — |

---

## 7. Key Technical Decisions

### Client-Side First Strategy
- **17 of 25 tools** need zero backend — they run entirely in the browser
- Data stored in `localStorage` with JSON export/import
- This means: instant load, no cold starts, works offline, zero Supabase cost
- Only 8 tools use Supabase (the collaborative/persistent ones)

### Shareable Results
- Every tool output can be exported as: **PNG** (html2canvas), **CSV**, **JSON**, **Clipboard**
- Client-side tools support URL-encoded state (share chart config via link)
- Realtime tools use short UUIDs for room codes

### Guest Access
- No login required for client-side tools
- Anonymous sessions (Supabase anon) for multiplayer tools
- Full accounts optional for saving workspaces

### Mobile Responsive
- All tools must work on tablet (team ceremonies)
- Critical tools (Timer, Standup, Planning Poker voting) must work on phone
- Charts use responsive containers with touch support

---

## 8. Competitive Differentiation

| Feature | Miro/Mural | Jira | Parabol | **agile.amrelharony.com** |
|---------|-----------|------|---------|--------------------------|
| Free | Limited | Limited | 2 teams | ✅ Unlimited |
| No signup for basic tools | ❌ | ❌ | ❌ | ✅ |
| All-in-one (25 tools) | ❌ | ❌ | ❌ | ✅ |
| Monte Carlo forecasting | ❌ | ✅ (plugin) | ❌ | ✅ Built-in |
| Real-time retro | ✅ | ❌ | ✅ | ✅ |
| Offline capable | ❌ | ❌ | ❌ | ✅ PWA |
| Open source | ❌ | ❌ | ✅ | ✅ (planned) |
| Cyberpunk UI | 😂 No | 😂 No | 😂 No | ✅ 💀 |

---

## 9. Monetization Opportunities (Future)

While the core toolkit is free, potential revenue streams:
1. **Premium Workspaces** — Unlimited history, team management, SSO
2. **White-label licensing** — Companies deploy their own instance
3. **Consulting upsell** — "Need help implementing Agile? Book Amr"
4. **Template marketplace** — Custom retro formats, maturity models
5. **API access** — Integrate with Jira, Azure DevOps, etc.

---

## 10. Immediate Next Step

**Ready to start Phase 1.** The first deliverable would be:
1. Initialize Next.js 14 project with Tailwind + shadcn/ui
2. Build the landing page / tool directory dashboard
3. Ship the first tool: **Sprint Capacity Planner** (most immediately useful for your squads)

All 6 Phase 1 tools are client-side only — zero backend complexity to start.
