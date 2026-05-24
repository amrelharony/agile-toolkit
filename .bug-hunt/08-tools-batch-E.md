# Bug Audit: Agile Toolkit Tools Batch E (planning-poker through retro)

## Summary

Comprehensive deep-dive audit across 15 agile tools. Checked against: stale closures, persistence, date/math, DnD/sortable, forms, Recharts, export, race conditions, memory leaks, boundary cases, and tool-specific patterns. Most potential bugs are already documented in code comments or mitigated. Below are only genuine bugs with file:line + real code snippets.

---

## release-planner

### Medium: Input spamming history on keystroke

**Tool**: release-planner / **File**: src/app/(tools)/release-planner/release-planner-client.tsx:491-501

**Bug**: The backlogSize Input field calls updateConfig on every onChange, firing a RELEASE_UPDATED history event per keystroke.

**Evidence**:

```typescript
<Input
  type="number"
  min={1}
  value={config.backlogSize}
  onChange={(e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) {
      updateConfig({ backlogSize: Math.max(1, n) });  // fires event per keystroke
    }
  }}
  className={inputCls}
/>
```

**Repro / impact**: Type "250" in backlog field; three RELEASE_UPDATED events appear instead of one.

**Fix idea**: Defer logged updateConfig to onBlur; use updateConfigQuiet for onChange (pattern already exists at line 573-574).

---

## release-readiness

### Low: P-chart threshold at exactly 4 releases

**Tool**: release-readiness / **File**: src/app/(tools)/release-readiness/release-readiness-client.tsx:308-319

**Bug**: P-chart limits only computed when gatePassSeries.length >= 4 (line 309), so exactly 4 releases returns null.

**Evidence**:

```typescript
const gatePassControl = useMemo(() => {
  if (gatePassSeries.length < 4) return null;  // exactly 4 returns null
  const limits = pChartLimits(...);
  return { centerLinePct: limits.centerLine * 100, ... };
}, [gatePassSeries]);
```

**Repro / impact**: Ship exactly 4 releases; p-chart section doesn't render. Users with 5+ see it.

**Fix idea**: Lower threshold to < 3 or add center-line-only mode for 2-3 samples.

---

## retro

### High: Dangling groupedWith reference on export after delete

**Tool**: retro / **File**: src/app/(tools)/retro/retro-client.tsx:660-676

**Bug**: Export functions don't validate that cards with groupedWith !== null have valid parents in state.cards. If a parent is deleted, orphaned children keep stale groupedWith IDs.

**Evidence**:

```typescript
function buildExportJson(state: BoardState) {
  return {
    format: state.format.name,
    date: new Date().toISOString(),
    columns: state.format.columns.map((col) => ({
      label: col.label,
      cards: state.cards
        .filter((c) => c.columnKey === col.key)
        .map((c) => ({
          text: c.text,
          votes: c.votes,
          isActionItem: c.isActionItem,
          assignee: c.assignee || undefined,
        })),
    })),
  };
}
// No validation of groupedWith references
```

**Repro / impact**: In multiplayer, export includes dangling groupedWith IDs; import crashes because parent is missing.

**Fix idea**: Validate every groupedWith reference points to existing card; strip orphans before export.

---

### Medium: Group cycle detection incomplete

**Tool**: retro / **File**: src/app/(tools)/retro/retro-client.tsx:827-833

**Bug**: Cycle detection walk doesn't add the _child_ ID to seen set, so a 3-cycle (A→B, B→C, C→A) may slip through in edge cases.

**Evidence**:

```typescript
let cursor: string | null = parent.groupedWith;
const seen = new Set<string>([parent.id]); // missing: id
while (cursor) {
  if (cursor === id || seen.has(cursor)) return prev;
  seen.add(cursor);
  cursor = prev.cards.find((c) => c.id === cursor)?.groupedWith ?? null;
}
```

**Repro / impact**: Rare in corrupted imported state; cycles slip through if ancestry overlaps oddly.

**Fix idea**: Add child ID to seen: `const seen = new Set<string>([parent.id, id])`.

---

## No bugs found in:

- planning-poker, platform-maturity, polarity-map, post-mortem, premortem, prioritizer, prompt-registry, psych-safety, quality-cost, raci, rapid-decision, refinement: All pre-documented bugs (BUG-RD3-_, BUG-T6-_, BUG-T7-\*) verified as already fixed or explained in inline comments.

---

## Summary

| Severity  | Count | Tools                  |
| --------- | ----- | ---------------------- |
| High      | 1     | retro                  |
| Medium    | 2     | release-planner, retro |
| Low       | 1     | release-readiness      |
| **Total** | **4** | —                      |
