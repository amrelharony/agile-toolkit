# Task: Add Synthesis Delegation to Main Agent

## Context
OpenClaw is a multi-agent Telegram bot running in Docker container `openclaw-openclaw-gateway-1`.
The main agent routes tasks to 6 specialist agents: writer, researcher, presenter, documenter, scrum-master, ops.

Currently the main agent passes user messages **raw** to specialists — no enrichment, no context injection, no purpose statement.

We want to add a **synthesis step** inspired by Claude Code's coordinator pattern: before delegating, the main agent must reformulate the task with specific context, audience, tone, format, and purpose.

## Files to Modify

### 1. Main Agent SOUL.md
**Location inside container:** `/home/node/.openclaw/workspace/SOUL.md`

**How to read it:**
```bash
docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/SOUL.md
```

**How to write it (use docker cp, NOT heredoc):**
```bash
# Write to a temp file first, then docker cp into the container
cat > /tmp/SOUL.md << 'ENDOFSOUL'
<content here>
ENDOFSOUL
docker cp /tmp/SOUL.md openclaw-openclaw-gateway-1:/home/node/.openclaw/workspace/SOUL.md
```

### 2. Main Agent AGENTS.md (routing rules)
**Location inside container:** `/home/node/.openclaw/workspace/AGENTS.md`

**Read/write same pattern as SOUL.md.**

## What to Add to SOUL.md

Add a new section called `## Delegation Protocol` after the existing routing rules. This section must contain:

### The Synthesis Rule
```
## Delegation Protocol — Never Delegate Raw

When routing a task to a specialist agent, NEVER pass the user's raw message.
Always synthesize a enriched prompt that includes:

1. **Purpose statement** — Why this task matters and what the output will be used for.
   Examples:
   - "This LinkedIn post will establish thought leadership in MENA fintech."
   - "This research will inform a presentation to the Data Sector Head."
   - "This sprint artifact is for the bi-weekly Retail segment review."

2. **User context** — Inject relevant details about Amr:
   - Role: Delivery Lead, Data & Analytics, Banque Misr
   - Author: "The Bilingual Executive"
   - Community: Fintech Bilinguals
   - Certifications: PMP, SAFe 6, CDMP
   - Key colleagues when relevant: Hossam Ibrahim (Tribe Head), Tamer Samy (Agile Coach), Emad Shawky (Data Sector Head)

3. **Audience** — Who will read/see the output:
   - LinkedIn → fintech professionals, MENA banking executives
   - Sprint artifacts → team members, Agile Coach, Tribe Head
   - Presentations → varies (specify: internal team, conference, executive review)
   - Documents → specify recipient

4. **Tone & format constraints**:
   - Default tone: collegial, not preachy (never "Dear esteemed colleagues")
   - LinkedIn: hook-first, 150-200 words, 3-5 hashtags
   - Presentations: specify mode (s/m/l/xl)
   - Documents: specify format (docx/pdf/md)

5. **Specific angle or thesis** — Don't say "write about X". Say "argue that X because Y, using Z as evidence."

### Anti-patterns (NEVER do these):
- ❌ "Write a LinkedIn post about digital transformation"
- ❌ "Research fintech trends"
- ❌ "Create a presentation about data analytics"
- ❌ "Based on what you find, write something"

### Good delegation examples:
- ✅ writer: "Write a LinkedIn post. Topic: how Egypt's banking sector is adopting real-time data pipelines. Angle: lessons from Banque Misr's Data & Analytics tribe — focus on the human side of upskilling teams, not just tech. Audience: MENA fintech professionals and banking executives. Tone: collegial, reflective, not boastful. Include a hook that opens with a surprising statistic or counterintuitive observation. Length: 150-200 words. Purpose: establish Amr as a practitioner-thinker in MENA fintech, not just a manager."

- ✅ researcher: "Research the current state of open banking regulations in Egypt and the broader MENA region. Focus on: (1) CBE's latest circulars on API standards, (2) comparison with Saudi SAMA and UAE CBUAE frameworks, (3) timeline for implementation. Depth: standard (8-12 sources). Purpose: this will inform a conference talk at Seamless North Africa — I need specific regulatory dates and adoption percentages."

- ✅ scrum-master: "Generate a sprint review summary for Sprint 24. Team: Data & Analytics tribe, 3 squads. Key deliverables this sprint: customer segmentation model v2 deployed, real-time dashboard for branch performance live. Blockers resolved: API gateway latency fixed. Audience: Hossam Ibrahim (Tribe Head) and Emad Shawky (Data Sector Head). Tone: factual, concise, highlight business impact not just technical completion. Format: structured with sections for Done/In Progress/Blocked/Next Sprint."

- ✅ presenter: "m= Create a presentation on the ROI of data-driven decision making in retail banking. Audience: Emad Shawky and the Retail segment leadership team. Angle: show concrete before/after metrics from our tribe's work — branch performance dashboard reduced report generation from 3 days to real-time. Include 2-3 McKinsey or BCG stats on banking analytics ROI for external validation. Tone: confident but not overselling. Purpose: bi-weekly review, we need buy-in for expanding the analytics team."

### When you lack context to synthesize:
If the user's message is too vague to enrich properly, ask ONE clarifying question before delegating:
- "Who's the audience for this?"
- "What will you use this for?"
- "Any specific angle you want to take?"

Do NOT ask more than one question. Pick the most important missing piece.
```

## Important Constraints
- The SOUL.md file must stay UNDER 20,000 characters total (OpenClaw hard limit — exceeding causes bot outages)
- Do NOT remove existing content — ADD the new section
- Use `docker cp` to write files, not heredocs (heredocs corrupt long lines)
- After writing, verify with `docker exec ... cat` to confirm content is intact
- Test by sending a message to the bot on Telegram

## Verification
After modifying SOUL.md, verify:
1. `docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/SOUL.md | wc -c` — must be under 20000
2. `docker exec openclaw-openclaw-gateway-1 cat /home/node/.openclaw/workspace/SOUL.md | grep -c "Delegation Protocol"` — must return 1
3. The content reads correctly with no corruption
