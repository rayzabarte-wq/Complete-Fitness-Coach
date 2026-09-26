import { Equipment } from "./equipment.js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Exercise {
  id: string;
  name: string;
  category: "COMPOUND" | "ACCESSORY";
  muscleGroup: string;
  repRangeStyle: "STRENGTH" | "HYPERTROPHY";
  equipment: Equipment;
  movementPattern: "PUSH" | "PULL" | "LEGS" | "CORE";
  defaultSets: number;
}

export interface SetInput {
  exerciseId: string;
  weightLb: number;
  bandLevel?: string;
  reps: number;
  targetReps: number;
  rpe?: number;
  setOrder: number;
}

export type MovementPattern = "PUSH" | "PULL" | "LEGS" | "CORE";

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  equipment: Equipment;
  suggestedWeightLb: number;
  bandLevel: string | null;
  suggestedReps: number;
  suggestedSets: number;
  restSeconds: number;
  reasoning: string;
}

export interface WorkoutPlan {
  movementPattern: MovementPattern;
  exercises: PlannedExercise[];
  estimatedMinutes: number;
}

export type ReadinessLevel = "LOW" | "MEDIUM" | "HIGH";

export interface LogSessionInput {
  date?: string;
  notes?: string;
  startedAt?: string;
  endedAt?: string;
  sleepQuality?: ReadinessLevel;
  soreness?: ReadinessLevel;
  energyLevel?: ReadinessLevel;
  sets: SetInput[];
}

export type SessionType =
  | "STRENGTH"
  | "SWIM"
  | "GOLF_RANGE"
  | "GOLF_ROUND"
  | "GOLF_SHORT_GAME"
  | "GOLF_PUTTING"
  | "RUN_RECOVERY"
  | "RUN_TEMPO"
  | "RUN_FARTLEK"
  | "RUN_INTERVALS"
  | "RUN_LONG_RUN"
  | "WALK_WALK"
  | "WALK_HIKE"
  | "CYCLING_EASY"
  | "CYCLING_LONG"
  | "CYCLING_HILLS"
  | "CYCLING_TURBO_EASY"
  | "CYCLING_TURBO_LONG"
  | "CYCLING_TURBO_HILLS"
  | "REST";

export type ActualTimeSource = "MANUAL" | "STRAVA";

export interface PlannedSession {
  id: string;
  date: string;
  type: SessionType;
  movementPattern: MovementPattern | null;
  notes: string | null;
  completed: boolean;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  actualSource: ActualTimeSource | null;
  stravaActivityId: string | null;
}

export interface StravaActivity {
  id: string;
  name: string;
  type: string;
  startDate: string;
  movingMinutes: number;
  distanceMiles: number;
}

export type GolfSessionType = "GOLF_RANGE" | "GOLF_SHORT_GAME" | "GOLF_PUTTING";

export interface GolfDrill {
  name: string;
  detail: string;
  minutes: number;
}

export interface GolfSessionPlan {
  sessionType: GolfSessionType;
  focusSummary: string;
  drills: GolfDrill[];
  totalMinutes: number;
  reasoning: string;
}

export type Sport = "STRENGTH" | "GOLF" | "RUN" | "WALK" | "CYCLING" | "CYCLING_TURBO" | "SWIM";
export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH";
export type TimeOfDay = "MORNING" | "AFTERNOON" | "EVENING";
export type PlanStatus = "DRAFT" | "FRAMEWORK" | "ACTIVE" | "ARCHIVED";
export type ApproachStatus = "PROPOSED" | "APPROVED";

export interface SportPriority {
  id: string;
  sport: Sport;
  priority: PriorityLevel;
  goalNote: string | null;
}

export interface SportApproach {
  id: string;
  sport: Sport;
  approachText: string;
  weeklySessionTarget: number;
  status: ApproachStatus;
}

export interface FrameworkSlot {
  id: string;
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  sport: Sport;
  sessionType: SessionType | null;
  movementPattern: MovementPattern | null;
  label: string | null;
  notes: string | null;
}

export interface ScheduleConstraint {
  id: string;
  rawText: string;
  daysOfWeek: number[];
  blockedTimeOfDay: TimeOfDay[];
  parseExplanation: string | null;
}

// A closed-off past version of the weekly framework, or the current one
// (effectiveTo: null) — created either by the initial framework generation
// or by an amendment (in which case amendmentSummary/amendmentRequest are
// set). Doesn't carry its slots here — only the dashboard needs those, and
// it computes them server-side.
export interface FrameworkVersionSummary {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  amendmentSummary: string | null;
  amendmentRequest: string | null;
}

export interface TrainingPlan {
  id: string;
  startDate: string;
  endDate: string;
  status: PlanStatus;
  overallGoal: string | null;
  priorities: SportPriority[];
  approaches: SportApproach[];
  slots: FrameworkSlot[]; // the CURRENT framework version's slots
  versions: FrameworkVersionSummary[];
  constraints: ScheduleConstraint[];
}

export interface SubTypeReport {
  key: string; // a SessionType code, a MovementPattern code, or "UNSPECIFIED"
  plannedCount: number;
  completedCount: number;
  completedMinutes: number;
}

export interface SportReport {
  sport: Sport;
  plannedCount: number;
  completedCount: number;
  completedMinutes: number;
  consistencyPercent: number | null;
  subTypes: SubTypeReport[];
}

export interface PeriodReport {
  totalPlanned: number;
  totalCompleted: number;
  totalCompletedMinutes: number;
  consistencyPercent: number | null;
  bySport: SportReport[];
}

export interface PeriodDashboard {
  from: string;
  to: string;
  label: string;
  current: PeriodReport;
  original?: PeriodReport;
}

export interface Dashboard {
  hasAmendments: boolean;
  week: PeriodDashboard;
  month: PeriodDashboard;
}

export interface SlotMoveOption {
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  dayLabel: string;
  timeLabel: string;
}

export interface SlotConflict {
  slot: { id: string; dayOfWeek: number; timeOfDay: TimeOfDay; sport: Sport; label: string | null };
  options: SlotMoveOption[];
}

export interface DayForecast {
  date: string;
  condition: string;
  tempMaxC: number;
  tempMinC: number;
  precipProbability: number;
  windMaxMph: number;
  outdoorRecommended: boolean;
}

const TOKEN_KEY = "strength_app_token";

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = auth.getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A 401 on /auth/login with requires2fa is an expected step in the
    // login flow, not an expired session — only clear the stored token for
    // other 401s (an actual expired/invalid session).
    if (res.status === 401 && !body.requires2fa) {
      auth.clearToken();
    }
    const err = new Error(body.error ?? `Request failed: ${res.status}`) as Error & {
      requires2fa?: boolean;
    };
    err.requires2fa = body.requires2fa;
    throw err;
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export interface LoginResponse {
  token: string;
  totpEnabled: boolean;
}

export const api = {
  register: (email: string, password: string) =>
    request<LoginResponse>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string, code?: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password, code }) }),

  setup2fa: () => request<{ secret: string; qrDataUrl: string }>("/auth/2fa/setup", { method: "POST" }),

  verify2fa: (code: string) =>
    request<{ totpEnabled: boolean }>("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ code }) }),

  getExercises: () => request<Exercise[]>("/exercises"),

  createExercise: (data: Omit<Exercise, "id">) =>
    request<Exercise>("/exercises", { method: "POST", body: JSON.stringify(data) }),

  logSession: (data: LogSessionInput) =>
    request<{ id: string }>("/sessions", { method: "POST", body: JSON.stringify(data) }),

  submitFeedback: (sessionId: string, thumbsUp: boolean) =>
    request(`/sessions/${sessionId}/feedback`, { method: "POST", body: JSON.stringify({ thumbsUp }) }),

  getRecentSessions: (limit = 20) => request(`/sessions?limit=${limit}`),

  getExerciseHistory: (exerciseId: string, limit = 10) =>
    request(`/sessions/exercise/${exerciseId}?limit=${limit}`),

  generatePlan: (pattern: MovementPattern) =>
    request<WorkoutPlan>(`/workouts/plan/${pattern}`, { method: "POST" }),

  getOutlookStatus: () => request<{ connected: boolean }>("/integrations/outlook/status"),

  disconnectOutlook: () => request<{ connected: boolean }>("/integrations/outlook/disconnect", { method: "POST" }),

  // Not a fetch — this is a real navigation, since it needs to hand the
  // browser off to Microsoft's consent screen and back. Includes the
  // session token as a query param since a plain navigation can't carry
  // our normal Authorization header — see backend/src/routes/outlook.ts.
  outlookConnectUrl: () => `${API_URL}/integrations/outlook/connect?token=${encodeURIComponent(auth.getToken() ?? "")}`,

  getPlannedSessions: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    return request<PlannedSession[]>(`/calendar${query ? `?${query}` : ""}`);
  },

  createPlannedSession: (data: {
    date: string;
    type: SessionType;
    movementPattern?: MovementPattern;
    notes?: string;
    estimatedMinutes?: number;
  }) => request<PlannedSession>("/calendar", { method: "POST", body: JSON.stringify(data) }),

  updatePlannedSession: (
    id: string,
    data: {
      date?: string;
      type?: SessionType;
      movementPattern?: MovementPattern;
      estimatedMinutes?: number;
      notes?: string;
      completed?: boolean;
      actualMinutes?: number;
    }
  ) => request<PlannedSession>(`/calendar/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deletePlannedSession: (id: string) => request(`/calendar/${id}`, { method: "DELETE" }),

  getForecast: (coords?: { latitude: number; longitude: number }) =>
    request<DayForecast[]>(
      `/calendar/weather${coords ? `?lat=${coords.latitude}&lon=${coords.longitude}` : ""}`
    ),

  exportAccountData: () => request<Record<string, unknown>>("/account/export"),

  deleteAccount: (password: string, code?: string) =>
    request<void>("/account", { method: "DELETE", body: JSON.stringify({ password, code }) }),

  getPreferences: () => request<{ visibleSessionTypes: SessionType[] }>("/account/preferences"),

  updatePreferences: (visibleSessionTypes: SessionType[]) =>
    request<{ visibleSessionTypes: SessionType[] }>("/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({ visibleSessionTypes }),
    }),

  getStravaStatus: () => request<{ connected: boolean }>("/integrations/strava/status"),

  disconnectStrava: () => request<{ connected: boolean }>("/integrations/strava/disconnect", { method: "POST" }),

  // Same pattern as outlookConnectUrl — a real navigation, token passed as
  // a query param since the browser can't attach our Authorization header.
  stravaConnectUrl: () => `${API_URL}/integrations/strava/connect?token=${encodeURIComponent(auth.getToken() ?? "")}`,

  getStravaActivitiesForSession: (sessionId: string) =>
    request<StravaActivity[]>(`/calendar/${sessionId}/strava-activities`),

  linkStravaActivity: (sessionId: string, activityId: string, movingMinutes: number) =>
    request<PlannedSession>(`/calendar/${sessionId}/strava-activity`, {
      method: "POST",
      body: JSON.stringify({ activityId, movingMinutes }),
    }),

  generateGolfPlan: (type: GolfSessionType, estimatedMinutes?: number) =>
    request<GolfSessionPlan>(`/golf/plan/${type}`, {
      method: "POST",
      body: JSON.stringify({ estimatedMinutes }),
    }),

  // --- 3-month training plan (Scheduler) ---------------------------------

  getCurrentPlan: () =>
    request<TrainingPlan>("/plan/current").catch((err: Error & { requires2fa?: boolean }) => {
      // No plan started yet is a normal state, not an error to surface.
      if (err.message.includes("No current training plan")) return null;
      throw err;
    }),

  createPlan: (data: { overallGoal?: string; priorities: { sport: Sport; priority: PriorityLevel; goalNote?: string }[] }) =>
    request<TrainingPlan>("/plan", { method: "POST", body: JSON.stringify(data) }),

  updatePlanPriorities: (
    planId: string,
    data: { overallGoal?: string; priorities: { sport: Sport; priority: PriorityLevel; goalNote?: string }[] }
  ) => request<TrainingPlan>(`/plan/${planId}/priorities`, { method: "PATCH", body: JSON.stringify(data) }),

  generateApproaches: (planId: string) => request<TrainingPlan>(`/plan/${planId}/approaches/generate`, { method: "POST" }),

  updateApproach: (
    planId: string,
    sport: Sport,
    data: { status?: ApproachStatus; approachText?: string; weeklySessionTarget?: number }
  ) => request<TrainingPlan>(`/plan/${planId}/approaches/${sport}`, { method: "PATCH", body: JSON.stringify(data) }),

  generateFramework: (planId: string) => request<TrainingPlan>(`/plan/${planId}/framework/generate`, { method: "POST" }),

  updateFrameworkSlot: (planId: string, slotId: string, data: { dayOfWeek?: number; timeOfDay?: TimeOfDay; label?: string }) =>
    request<TrainingPlan>(`/plan/${planId}/framework/${slotId}`, { method: "PATCH", body: JSON.stringify(data) }),

  activatePlan: (planId: string) => request<TrainingPlan>(`/plan/${planId}/activate`, { method: "POST" }),

  addConstraint: (planId: string, rawText: string) =>
    request<{ constraint: ScheduleConstraint; conflicts: SlotConflict[] }>(`/plan/${planId}/constraints`, {
      method: "POST",
      body: JSON.stringify({ rawText }),
    }),

  getConstraintConflicts: (planId: string, constraintId: string) =>
    request<{ conflicts: SlotConflict[] }>(`/plan/${planId}/constraints/${constraintId}/conflicts`),

  applyConstraintMove: (planId: string, constraintId: string, option: { slotId: string; dayOfWeek: number; timeOfDay: TimeOfDay }) =>
    request<TrainingPlan>(`/plan/${planId}/constraints/${constraintId}/apply`, { method: "POST", body: JSON.stringify(option) }),

  deleteConstraint: (planId: string, constraintId: string) =>
    request<TrainingPlan>(`/plan/${planId}/constraints/${constraintId}`, { method: "DELETE" }),

  amendPlan: (planId: string, requestText: string) =>
    request<TrainingPlan>(`/plan/${planId}/amend`, { method: "POST", body: JSON.stringify({ requestText }) }),

  // todayKey should be a local YYYY-MM-DD (see lib/location.ts's
  // formatLocalDateKey) so the week/month periods line up with the
  // person's own calendar day rather than the server's.
  getDashboard: (planId: string, todayKey: string) => request<Dashboard>(`/plan/${planId}/dashboard?today=${todayKey}`),
};
