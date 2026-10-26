/**
 * Full Phase 6 (Team & people) documents: every new field filled in, so a
 * test can tell when a store path or a CRUD schema drops one.
 */

import {
  ADKAR_DOC_ID,
  DOD_DOC_ID,
  HEALTH_CHECK_ID,
  MOOD_TRACKER_ID,
  PSYCH_SAFETY_ID,
  RACI_ID,
  WORKING_AGREEMENT_ID,
  type AdkarDoc,
  type DefinitionOfDone,
  type HealthCheck,
  type HealthDimensionScore,
  type MaturityAssessment,
  type MoodEntry,
  type MoodPulse,
  type MoodTrackerDoc,
  type PsychSafetyCounts,
  type PsychSafetyLog,
  type RaciMatrix,
  type SkillsMatrix,
  type Story,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";

const SENT = [
  { route: "retro-topic" as const, targetId: "card-1", at: "2026-10-04T09:00:00.000Z" },
];

export const DOD: DefinitionOfDone = {
  id: DOD_DOC_ID,
  items: [
    {
      id: "dod-1",
      label: "Code reviewed",
      description: "By one peer",
      category: "code",
      required: true,
    },
    { id: "dod-2", label: "Docs updated", category: "docs", required: false, done: true },
  ],
  history: [
    { sprintName: "Sprint 1", totalRequired: 1, completed: 1, ts: "2026-10-01T10:00:00.000Z" },
  ],
};

export const RACI: RaciMatrix = {
  id: RACI_ID,
  roles: [
    { id: "r1", name: "Ana", memberId: "member_ana" },
    { id: "r2", name: "Dev Team", description: "Everyone who builds it" },
  ],
  activities: [{ id: "a1", name: "Release", description: "Ship to production" }],
  cells: { a1: { r1: ["A", "R"], r2: ["C"] } },
};

export const ADKAR: AdkarDoc = {
  id: ADKAR_DOC_ID,
  initiatives: [
    {
      id: "i1",
      name: "Trunk-based development",
      owner: "Ana",
      startDate: "2026-09-01",
      description: "Short-lived branches",
      currentStage: "desire",
      stagesCompleted: ["awareness"],
      stageHistory: [
        { stage: "awareness", enteredAt: "2026-09-01" },
        { stage: "desire", enteredAt: "2026-09-20" },
      ],
      groups: [
        {
          id: "g1",
          name: "Backend",
          scores: { awareness: 4, desire: 2 },
          assessedAt: "2026-10-01",
          note: "Not sure why yet",
        },
      ],
    },
  ],
};

export const MOOD_DOC: MoodTrackerDoc = {
  id: MOOD_TRACKER_ID,
  mode: "anonymous",
  streaks: [{ start: "2026-10-01", end: "2026-10-03", sentTo: SENT }],
};

export const PULSE: MoodPulse = {
  id: "moodPulse_abc12345",
  date: "2026-10-02",
  counts: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 1 },
  source: "room",
  createdAt: "2026-10-02T09:30:00.000Z",
};

export const MOOD_ENTRY: MoodEntry = {
  id: "mood_1",
  memberId: "member_ana",
  date: "2026-10-01",
  score: 4,
  note: "Good pairing day",
  loggedAt: "2026-10-03T08:00:00.000Z",
};

export const STORY: Story = {
  id: "story_1",
  title: "Pay by card",
  status: "done",
  points: 3,
  dodChecks: { checked: ["dod-1"], updatedAt: "2026-10-05T12:00:00.000Z" },
};

export const AGREEMENT: WorkingAgreement = {
  id: WORKING_AGREEMENT_ID,
  rules: [
    {
      id: "rule-1",
      category: "meetings",
      text: "Cameras optional",
      agreedBy: ["Ana"],
      description: "For every meeting",
      stillWorking: true,
      consent: [
        { name: "Ana", vote: "consent", at: "2026-10-01T10:00:00.000Z" },
        { name: "Bo", vote: "concern", note: "Hard to read the room", at: "2026-10-01T10:05:00Z" },
      ],
    },
  ],
  meta: { teamName: "Falcons", version: 2, publishedAt: "2026-10-02", description: "Our rules" },
  checkIns: [
    {
      id: "checkin-1",
      date: "2026-10-10",
      sprintId: "sprint_1",
      version: 2,
      results: { "rule-1": "not_working" },
      ruleTexts: { "rule-1": "Cameras optional" },
      note: "Revisit",
    },
  ],
  versions: [
    {
      version: 2,
      publishedAt: "2026-10-02",
      teamName: "Falcons",
      description: "Our rules",
      rules: [{ id: "rule-1", category: "meetings", text: "Cameras optional" }],
    },
  ],
};

const counts = (...c: PsychSafetyCounts): PsychSafetyCounts => c;

export const PSYCH: PsychSafetyLog = {
  id: PSYCH_SAFETY_ID,
  responses: [],
  rounds: [
    {
      id: "psRound_abc12345",
      name: "October",
      date: "2026-10-08",
      sprintId: "sprint_1",
      source: "room",
      responses: 5,
      counts: {
        q1: counts(1, 1, 1, 1, 1),
        q2: counts(0, 0, 1, 2, 2),
        q3: counts(2, 2, 1, 0, 0),
        q4: counts(0, 1, 1, 1, 2),
        q5: counts(3, 1, 1, 0, 0),
        q6: counts(0, 0, 0, 2, 3),
        q7: counts(0, 0, 2, 2, 1),
      },
      createdAt: "2026-10-08T15:00:00.000Z",
      sentTo: SENT,
    },
  ],
};

const light = (over: Partial<HealthDimensionScore> = {}): HealthDimensionScore => ({
  light: "green",
  trend: "same",
  ...over,
});

const builtIns = (over: Partial<HealthDimensionScore> = {}) => ({
  "Delivering Value": light(over),
  "Easy to Release": light(),
  Fun: light(),
  "Health of Codebase": light(),
  Learning: light(),
  Mission: light(),
  Speed: light(),
  Teamwork: light(),
});

export const HEALTH: HealthCheck = {
  id: HEALTH_CHECK_ID,
  current: {
    sprintName: "Sprint 2",
    scores: builtIns({
      light: "red",
      trend: "down",
      votes: { green: 1, yellow: 1, red: 4 },
      note: "Releases keep slipping",
      sentTo: SENT,
    }),
    sprintId: "sprint_2",
    date: "2026-10-20",
    rated: ["Delivering Value", "custom-ab12cd34"],
    customScores: { "custom-ab12cd34": light({ light: "yellow" }) },
    source: "room",
    responses: 6,
  },
  history: [
    {
      id: "check-1",
      sprintName: "Sprint 1",
      date: "2026-10-06",
      scores: builtIns(),
      sprintId: "sprint_1",
      customScores: { "custom-ab12cd34": light() },
      source: "facilitator",
      responses: 5,
    },
  ],
  customDimensions: [
    { id: "custom-ab12cd34", name: "Support load", description: "Interrupts", archived: false },
  ],
};

export const SKILLS: SkillsMatrix = {
  id: "skillsMatrix:current",
  members: [{ id: "legacy-1", name: "Cy" }],
  skills: [{ id: "s1", name: "Terraform", description: "Infra", targetPeople: 2, targetLevel: 3 }],
  grid: { s1: { member_ana: 3, "legacy-1": 0 } },
  version: 2,
  training: [
    {
      id: "pair-1",
      skillId: "s1",
      learnerId: "legacy-1",
      mentorId: "member_ana",
      toLevel: 2,
      createdAt: "2026-10-01T10:00:00.000Z",
      due: "2026-11-01",
      doneAt: "2026-10-25",
    },
  ],
};

export const MATURITY: MaturityAssessment = {
  id: "maturity:current",
  scores: { "team-autonomy": 3 },
  targetLevel: 4,
  history: [
    {
      id: "assessment-1",
      assessedAt: "2026-09-30",
      scores: { "team-autonomy": 2, "technical-excellence": 3 },
      targetLevel: 4,
      note: "First one",
    },
  ],
};
