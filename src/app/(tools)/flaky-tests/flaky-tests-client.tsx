"use client";

import { useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertOctagon, ArrowUpDown } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateFlakyPrompts } from "@/lib/ai-prompts/flaky-tests";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { FLAKY_TEST_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

/* ── Types ──────────────────────────────────────────────────────────────── */

type Status = "active" | "quarantined" | "fixed";

interface FlakyTest {
  id: string;
  name: string;
  suite?: string;
  owner?: string;
  failureRate: number; // 0-1
  status: Status;
  firstSeenAt: string;
  fixedAt?: string;
  description?: string;
}

interface FlakyState {
  tests: FlakyTest[];
}

const DEFAULT_STATE: FlakyState = { tests: [] };

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "quarantined", label: "Quarantined" },
  { value: "fixed", label: "Fixed" },
];

type SortField = "failureRate" | "name" | "status" | "firstSeenAt";

/* ── Main client ────────────────────────────────────────────────────────── */

export function FlakyTestsClient() {
  const [state, setState] = usePersisted<FlakyState>(
    "agile-toolkit:flaky-tests",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("flaky-tests");
  const chartRef = useRef<HTMLDivElement>(null);

  // Add-form draft state.
  const [name, setName] = useState("");
  const [suite, setSuite] = useState("");
  const [owner, setOwner] = useState("");
  const [failureRateDraft, setFailureRateDraft] = useState("");
  const [description, setDescription] = useState("");

  // Sorting.
  const [sortField, setSortField] = useState<SortField>("failureRate");
  const [sortDesc, setSortDesc] = useState(true);

  const addTest = () => {
    if (!name.trim()) return;
    const pct = Number(failureRateDraft);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
    const t: FlakyTest = {
      id: crypto.randomUUID(),
      name: name.trim(),
      suite: suite.trim() || undefined,
      owner: owner.trim() || undefined,
      failureRate: pct / 100,
      status: "active",
      firstSeenAt: todayLocalISO(),
      description: description.trim() || undefined,
    };
    setState((s) => ({ tests: [t, ...s.tests] }));
    log(FLAKY_TEST_ACTIONS.TEST_ADDED, {
      testId: t.id,
      name: t.name,
      suite: t.suite,
      owner: t.owner,
      failureRate: t.failureRate,
      description: t.description,
    });
    setName("");
    setSuite("");
    setOwner("");
    setFailureRateDraft("");
    setDescription("");
  };

  const setStatus = (id: string, status: Status) => {
    const prev = state.tests.find((t) => t.id === id);
    setState((s) => ({
      tests: s.tests.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              fixedAt:
                status === "fixed" ? t.fixedAt ?? todayLocalISO() : undefined,
            }
          : t
      ),
    }));
    if (status === "quarantined") {
      log(FLAKY_TEST_ACTIONS.TEST_QUARANTINED, {
        testId: id,
        name: prev?.name,
      });
    } else if (status === "fixed") {
      log(FLAKY_TEST_ACTIONS.TEST_FIXED, { testId: id, name: prev?.name });
    } else {
      log(FLAKY_TEST_ACTIONS.TEST_UPDATED, { testId: id, fields: ["status"] });
    }
  };

  const remove = (id: string) => {
    const t = state.tests.find((x) => x.id === id);
    setState((s) => ({ tests: s.tests.filter((x) => x.id !== id) }));
    log(FLAKY_TEST_ACTIONS.TEST_REMOVED, { testId: id, name: t?.name });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const active = state.tests.filter((t) => t.status === "active").length;
  const quarantined = state.tests.filter((t) => t.status === "quarantined").length;

  const fixedThisQuarter = useMemo(() => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1).getTime();
    return state.tests.filter((t) => {
      if (t.status !== "fixed" || !t.fixedAt) return false;
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.fixedAt);
      if (!m) return false;
      const fixedAt = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3])
      ).getTime();
      return fixedAt >= start;
    }).length;
  }, [state.tests]);

  const avgFailureRate = useMemo(() => {
    const considered = state.tests.filter((t) => t.status !== "fixed");
    if (considered.length === 0) return 0;
    return (
      considered.reduce((acc, t) => acc + t.failureRate, 0) / considered.length
    );
  }, [state.tests]);

  const sortedTests = useMemo(() => {
    const copy = [...state.tests];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "failureRate":
          cmp = a.failureRate - b.failureRate;
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "firstSeenAt":
          cmp = a.firstSeenAt.localeCompare(b.firstSeenAt);
          break;
      }
      return sortDesc ? -cmp : cmp;
    });
    return copy;
  }, [state.tests, sortField, sortDesc]);

  const topTen = useMemo(() => {
    return [...state.tests]
      .filter((t) => t.status !== "fixed")
      .sort((a, b) => b.failureRate - a.failureRate)
      .slice(0, 10)
      .map((t) => ({
        name: t.name.length > 30 ? `${t.name.slice(0, 27)}…` : t.name,
        failureRatePct: Number((t.failureRate * 100).toFixed(0)),
        flagged: t.failureRate > 0.2,
      }));
  }, [state.tests]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Flaky Test Scoreboard",
      prompts: generateFlakyPrompts({
        tests: state.tests.map((t) => ({
          name: t.name,
          suite: t.suite,
          owner: t.owner,
          failureRate: t.failureRate,
          status: t.status,
          description: t.description,
        })),
        active,
        quarantined,
        fixedThisQuarter,
        avgFailureRate,
      }),
    }),
    [state.tests, active, quarantined, fixedThisQuarter, avgFailureRate]
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((d) => !d);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  return (
    <ToolPageWrapper
      toolId="flaky-tests"
      title="Flaky Test Scoreboard"
      description="Log and triage flaky tests by failure rate, suite, owner, and quarantine status."
      category="Quality Engineering"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="flaky-tests"
          csvData={{
            headers: [
              "Name",
              "Suite",
              "Owner",
              "Failure %",
              "Status",
              "First Seen",
              "Fixed",
              "Description",
            ],
            rows: state.tests.map((t) => [
              t.name,
              t.suite ?? "",
              t.owner ?? "",
              (t.failureRate * 100).toFixed(1),
              t.status,
              t.firstSeenAt,
              t.fixedAt ?? "",
              t.description ?? "",
            ]),
          }}
          jsonData={state}
          targetRef={chartRef}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={AlertOctagon}
          label="Active"
          value={active}
          tone={active > 0 ? "warning" : "default"}
          valueClassName="text-accent"
        />
        <StatCard variant="compact" label="Quarantined" value={quarantined} />
        <StatCard
          variant="compact"
          label="Fixed this quarter"
          value={fixedThisQuarter}
          tone={fixedThisQuarter > 0 ? "success" : "default"}
        />
        <StatCard
          variant="compact"
          label="Avg failure rate"
          value={`${(avgFailureRate * 100).toFixed(0)}%`}
          tone={avgFailureRate > 0.2 ? "danger" : "default"}
        />
      </KpiGrid>

      <SectionCard
        title="Log a flaky test"
        icon={AlertOctagon}
        className="mb-6 bg-surface border-border"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-sub">Test name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="UserService > should sign in user"
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Suite (optional)</Label>
            <Input
              value={suite}
              onChange={(e) => setSuite(e.target.value)}
              placeholder="auth.spec.ts"
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Owner (optional)</Label>
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="@platform"
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Failure rate (%)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={failureRateDraft}
              onChange={(e) => setFailureRateDraft(e.target.value)}
              onBlur={() => {
                const n = Number(failureRateDraft);
                if (!Number.isFinite(n)) {
                  setFailureRateDraft("");
                } else {
                  const clamped = Math.min(100, Math.max(0, n));
                  setFailureRateDraft(String(clamped));
                }
              }}
              placeholder="e.g. 12.5"
              className="bg-bg border-border font-data"
            />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-2">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What seems to trigger it, links to runs..."
              className="bg-bg border-border text-sm"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={addTest}
              disabled={!name.trim() || !failureRateDraft.trim()}
              className="gap-2 w-full bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Add test
            </Button>
          </div>
        </div>
      </SectionCard>

      {topTen.length > 0 && (
        <ChartCard
          title="Top 10 flakiest tests"
          icon={AlertOctagon}
          height={300}
          chartContainerRef={chartRef}
          className="mb-6"
        >
          <BarChart data={topTen} margin={{ top: 10, right: 16, left: 0, bottom: 60 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartTheme.gridColor}
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
              angle={-30}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              unit="%"
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Bar dataKey="failureRatePct" name="Failure rate" radius={[4, 4, 0, 0]}>
              {topTen.map((d, i) => (
                <Cell
                  key={`cell-${i}`}
                  fill={d.flagged ? "#ef4444" : "#00f0ff"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
      )}

      <SectionCard
        title="All flaky tests"
        icon={AlertOctagon}
        className="mb-2 bg-surface border-border"
        actions={
          <div className="flex items-center gap-1.5 text-xs text-sub">
            <ArrowUpDown className="w-3 h-3" />
            <span>Sort:</span>
            <Select
              value={sortField}
              onValueChange={(v) => toggleSort(v as SortField)}
            >
              <SelectTrigger className="h-7 w-32 bg-bg border-border text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="failureRate">Failure rate</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="firstSeenAt">First seen</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortDesc((d) => !d)}
              className="h-7 px-2 text-xs"
            >
              {sortDesc ? "Desc" : "Asc"}
            </Button>
          </div>
        }
      >
        {sortedTests.length === 0 ? (
          <EmptyState icon={AlertOctagon}>
            No flaky tests logged yet. Add one above to start the triage queue.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {sortedTests.map((t) => {
              const pct = Math.round(t.failureRate * 100);
              const high = t.failureRate > 0.2;
              return (
                <Card key={t.id} className="bg-bg border-border">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text font-medium text-sm flex-1 min-w-0 truncate">
                        {t.name}
                      </span>
                      {t.suite && (
                        <Badge variant="outline" className="text-[10px] font-data">
                          {t.suite}
                        </Badge>
                      )}
                      {t.owner && (
                        <span className="text-xs text-sub">{t.owner}</span>
                      )}
                      <Select
                        value={t.status}
                        onValueChange={(v) => setStatus(t.id, v as Status)}
                      >
                        <SelectTrigger
                          className="h-8 w-32 bg-surface border-border text-xs capitalize"
                          aria-label={`Status for ${t.name}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(t.id)}
                        className="text-sub hover:text-danger"
                        aria-label={`Remove ${t.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-surface rounded relative overflow-hidden">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${pct}%`,
                            background: high ? "#ef4444" : "#00f0ff",
                          }}
                          aria-label={`Failure rate ${pct}%`}
                        />
                      </div>
                      <span
                        className={
                          "text-xs font-data " +
                          (high ? "text-danger" : "text-sub")
                        }
                      >
                        {pct}%
                      </span>
                    </div>
                    {t.description && (
                      <div className="text-xs text-sub whitespace-pre-wrap break-words">
                        {t.description}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </SectionCard>
    </ToolPageWrapper>
  );
}
