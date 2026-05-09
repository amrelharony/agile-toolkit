# Task: Scratchpad Manifest (#20)

## Problem
The scratchpad directory exists and agents know about it, but there's no coordination. If the researcher writes `research-open-banking.md` and the writer needs to find it, the writer has to `ls scratchpad/` and guess which file is relevant. Claude Code's team memory has synchronized awareness of who wrote what.

## What to Build

This is a tiny change — one auto-maintained file.

### 1. Add MANIFEST.md auto-update to SOUL.md

Add to ALL agent SOUL.md files (inside the existing Shared Scratchpad section):

```markdown
### Manifest
After writing ANY file to scratchpad/, update scratchpad/MANIFEST.md:

```
# Scratchpad Manifest
_Last updated: 2026-04-01T10:30:00_

| File | Agent | Purpose | Created |
|------|-------|---------|---------|
| research-open-banking-egypt-2026-04-01.md | researcher | CBE regulations, IPN stats, regional comparison | 2026-04-01 09:45 |
| draft-linkedin-data-literacy.md | writer | First draft, needs review | 2026-04-01 10:15 |
```

Keep the manifest sorted by creation date (newest first). Remove entries for files you delete.
When reading from scratchpad, check MANIFEST.md first to find the right file.
```

### 2. Update the main agent's delegation protocol

In the existing "Using the Scratchpad for Multi-Step Tasks" section, add:

```markdown
When delegating tasks that use the scratchpad:
- Tell the worker: "After writing, update scratchpad/MANIFEST.md with: filename, your agent name, purpose, and timestamp"
- When referencing scratchpad files in delegation prompts, include the purpose from the manifest so the next agent knows what to expect
```

### 3. Update the cleanup cron

Update `/root/openclaw/data/scratchpad-cleanup.sh` to also clean MANIFEST.md entries for deleted files:

```bash
# After deleting old files, rebuild MANIFEST.md from remaining files
if [ -f "$SCRATCHPAD/MANIFEST.md" ]; then
    # Remove entries for files that no longer exist
    python3 -c "
import os
manifest = '$SCRATCHPAD/MANIFEST.md'
if os.path.exists(manifest):
    lines = open(manifest).readlines()
    kept = []
    for line in lines:
        if '|' in line and '.md' in line:
            fname = line.split('|')[1].strip()
            if os.path.exists(os.path.join('$SCRATCHPAD', fname)):
                kept.append(line)
            # else: file deleted, skip entry
        else:
            kept.append(line)
    open(manifest, 'w').writelines(kept)
" 2>/dev/null
fi
```

### Implementation

For ALL 10 workspaces, read the current SOUL.md, find the "## Shared Scratchpad" section, and insert the Manifest subsection. Use docker cp pattern.

```bash
docker exec openclaw-openclaw-gateway-1 sh -c 'for ws in /home/node/.openclaw/workspace*/SOUL.md; do echo "=== $ws ===" && grep -c "Manifest" "$ws" 2>/dev/null || echo "NEEDS UPDATE"; done'
```

### Verification

1. All SOUL.md files contain "### Manifest" under the Shared Scratchpad section
2. Send a compound task to the bot that uses scratchpad
3. Check that `scratchpad/MANIFEST.md` was created with proper format
4. Cleanup cron handles missing files gracefully
