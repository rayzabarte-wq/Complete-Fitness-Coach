import { Accessory, Equipment, GymsResponse } from "./equipment.js";

// Tolerates the common ways VITE_API_URL gets pasted in: a bare domain
// without https:// (how Railway displays generated domains, which would
// otherwise be fetched as a path on the frontend's own site), surrounding
// whitespace, or a trailing slash. A leading "/" (e.g. "/api" in
// Codespaces) is kept as a same-origin path.
function normalizeApiUrl(raw: string | undefined): string {
  let url = (raw ?? "").trim().replace(/\/+$/, "");
  if (!url) return "http://localhost:3001";
  if (!url.startsWith("/") && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL);

export interface Exercise {
  id: string;
  name: string;
  category: "COMPOUND" | "ACCESSORY";
  muscleGroup: string;
  repRangeStyle: "STRENGTH" | "HYPERTROPHY";
  equipment: Equipment;
  movementPattern: "PUSH" | "PULL" | "LEGS" | "CORE";
  defaultSets: number;
  primaryMuscle: Muscle | null;
  secondaryMuscles: Muscle[];
  variationTag: string | null;
  /** Set for the user's own exercises; null for the shared catalog. */
  userId?: string | null;
  requires?: Accessory[];
  customEquipmentId?: string | null;
  archivedAt?: string | null;
}

/** What the add-your-own-exercise form sends. */
export interface CustomExerciseInput {
  name: string;
  category: "COMPOUND" | "ACCESSORY";
  muscleGroup: string;
  repRangeStyle: "STRENGTH" | "HYPERTROPHY";
  equipment: Equipment;
  movementPattern: "PUSH" | "PULL" | "LEGS" | "CORE";
  primaryMuscle?: Muscle;
  requires?: Accessory[];
  customEquipmentId?: string | null;
}

export interface GymUpdate {
  name?: string;
  accessories?: Accessory[];
  customEquipmentIds?: string[];
  items?: EquipmentInput[];
}

export type Muscle = "CHEST" | "SHOULDERS" | "TRICEPS" | "BACK" | "BICEPS" | "QUADS" | "HAMSTRINGS" | "GLUTES" | "CORE";

export interface EquipmentInput {
  equipment: Equipment;
  enabled: boolean;
  minLb?: number;
  maxLb?: number;
  stepLb?: number;
  customWeightsLb?: number[];
  bandLevels?: string[];
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

// PUSH/PULL/LEGS/CORE are exercise patterns; UPPER/LOWER/FULL_BODY are
// session focuses used by the upper/lower and full-body splits.
export type MovementPattern = "PUSH" | "PULL" | "LEGS" | "CORE" | "UPPER" | "LOWER" | "FULL_BODY";

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
  selectionNote: string;
  isCoreFinisher: boolean;
}

export interface BlockInfo {
  startedAt: string;
  endsAt: string;
  week: number;
  totalWeeks: number;
  isNew: boolean;
  swaps: { at: string; out: string; in: string; why: string }[];
}

export interface WorkoutPlan {
  movementPattern: MovementPattern;
  exercises: PlannedExercise[];
  estimatedMinutes: number;
  block: BlockInfo;
  recoveringMuscles: string[];
  /** The gym profile the workout was built for. */
  gymId: string;
  gymName: string;
  /** Identifies this generated workout on the server (it changes each time
   * a new one is built), so progress saves go to the right workout. */
  workoutId: string;
  plannedSessionId: string | null;
}

/** What's been entered so far in the workout in progress — saved to the
 * server so it follows the person across devices. */
export interface WorkoutProgress {
  rows: Record<string, { weightLb: number; bandLevel: string; reps: string; rpe: number | null; logged: boolean }[]>;
  startedAt: string | null;
  sleepQuality: ReadinessLevel | null;
  soreness: ReadinessLevel | null;
  energyLevel: ReadinessLevel | null;
}

/** The workout built for one day — saved on the server, so any device can
 * open it without calling the AI again. */
export type SavedWorkoutStatus = "TODAY" | "DONE" | "MISSED" | "SCHEDULED" | "MOVED";

/** One entry in the saved-workouts list: a workout built for some day. */
export interface SavedWorkout {
  id: string;
  workoutId: string;
  date: string;
  status: SavedWorkoutStatus;
  movementPattern: MovementPattern;
  exerciseCount: number;
  estimatedMinutes: number;
  setsLogged: number;
  /** For MOVED: the day it was reused on. */
  reusedOnDate: string | null;
  createdAt: string;
}

export interface DailyWorkout extends WorkoutPlan {
  date: string;
  progress: WorkoutProgress | null;
  /** Set once the workout has been saved as a logged session. */
  savedSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReadinessLevel = "LOW" | "MEDIUM" | "HIGH";

export interface LogSessionInput {
  /** The generated daily workout this was logged from, if any. */
  workoutId?: string;
  date?: string;
  notes?: string;
  startedAt?: string;
  endedAt?: string;
  sleepQuality?: ReadinessLevel;
  soreness?: ReadinessLevel;
  energyLevel?: ReadinessLevel;
  sets: SetInput[];
  focus?: MovementPattern;
  plannedSessionId?: string;
  gymId?: string;
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
  autoPlanned: boolean;
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
  weeklyMinutesAvailable: number | null;
}

export interface Milestone {
  phase: string;
  target: string;
}

export interface SportApproach {
  id: string;
  sport: Sport;
  approachText: string;
  weeklySessionTarget: number;
  sessionMinutes: number;
  milestones: Milestone[] | null;
  status: ApproachStatus;
}

export interface FrameworkSlot {
  id: string;
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  sport: Sport;
  sessionType: SessionType | null;
  movementPattern: MovementPattern | null;
  estimatedMinutes: number | null;
  label: string | null;
  notes: string | null;
}

// A single session card in the schedule builder before it's been saved —
// no id yet, and day/time start unset until the person picks them.
export interface DraftFrameworkSlot {
  sport: Sport;
  dayOfWeek: number | null;
  timeOfDay: TimeOfDay | null;
  sessionType?: SessionType;
  movementPattern?: MovementPattern;
  estimatedMinutes: number;
  label?: string;
}

export interface SlotsNeeded {
  sport: Sport;
  weeklySessionTarget: number;
  sessionMinutes: number;
  alreadyPlaced: number;
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

// --- Strength-first additions: profile, consent, body, goals, steps, ------
// --- progress, day summaries ----------------------------------------------

export interface Split {
  key: string;
  label: string;
  rotation: MovementPattern[];
  explanation: string;
}

export interface Profile {
  email: string;
  birthYear: number | null;
  age: number | null;
  sex: "MALE" | "FEMALE" | null;
  heightCm: number | null;
  trainingDaysPerWeek: number;
  split: Split;
  splitOptions: { days: number; split: Split }[];
  dailyStepGoal: number | null;
  consentReviewed: boolean;
  hasIngestToken: boolean;
}

export type ConsentPurpose = "PROFILE" | "BODY_DATA" | "BENCHMARKING" | "PRODUCT_ANALYTICS";

export interface ConsentInfo {
  textVersion: string;
  reviewed: boolean;
  purposes: {
    purpose: ConsentPurpose;
    title: string;
    description: string;
    withdrawEffect: string;
    granted: boolean | null;
    updatedAt: string | null;
  }[];
  history: { purpose: ConsentPurpose; granted: boolean; textVersion: string; at: string }[];
}

export type BodyMetric = "BODY_FAT_PCT" | "MUSCLE_MASS_KG" | "BODY_WEIGHT_KG";
export type RevisionReason = "INJURY_OR_ILLNESS" | "LIFE_EVENT" | "TOO_AMBITIOUS" | "TOO_EASY" | "CHANGED_PRIORITIES" | "OTHER";

export interface BodyMeasurement {
  id: string;
  measuredAt: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  source: "MANUAL" | "RENPHO" | "APPLE_HEALTH";
}

export interface GoalTargetVersion {
  anchorDate: string;
  anchorValue: number;
  targetValue: number;
  targetDate: string;
  reason: RevisionReason | null;
  note: string | null;
  createdAt: string;
  revisionDirection: "EASIER" | "HARDER" | "SIMILAR" | null;
}

export interface BodyGoal {
  id: string;
  metric: BodyMetric;
  status: "ACTIVE" | "ACHIEVED" | "CLOSED";
  startValue: number;
  startDate: string;
  closedAt: string | null;
  direction: 1 | -1;
  targets: GoalTargetVersion[];
  readings: { date: string; value: number }[];
  pace: {
    state: "AHEAD" | "ON_TRACK" | "BEHIND" | "REACHED" | "NO_DATA";
    label: string;
    gap: number | null;
    latest: { date: string; value: number } | null;
    projectedAtTarget: number | null;
  };
}

export interface QuarterReview {
  quarter: string;
  goalsSet: number;
  goalsAchieved: number;
  revisions: {
    goalId: string;
    metric: BodyMetric;
    at: string;
    direction: "EASIER" | "HARDER" | "SIMILAR";
    reason: RevisionReason | null;
    targetChange: string;
    dateChangeDays: number;
  }[];
  summary: string[];
}

export interface Benchmarks {
  available: boolean;
  reason: string | null;
  benchmarks: { metric: string; value: number; category: string; rangeText: string; source: string }[];
}

export type BodySummary = Record<BodyMetric, { count: number; first: number | null; last: number | null; average: number | null }>;

export interface StepsResponse {
  goal: number | null;
  days: { date: string; steps: number; source: string; hitGoal: boolean | null }[];
  daysWithData: number;
  average: number | null;
  daysHitGoal: number | null;
}

export interface NutritionFigures {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface NutritionResponse {
  days: ({ date: string; source: string } & NutritionFigures)[];
  daysWithData: number;
  /** Average over the days that have each figure. */
  average: NutritionFigures;
}

export interface MuscleRecovery {
  muscle: Muscle;
  status: "READY" | "RECOVERING" | "UNTRAINED";
  lastTrainedAt: string | null;
  readyAt: string | null;
  percentRecovered: number;
  hoursUntilReady: number;
}

export interface TodaySuggestion {
  split: Split;
  nextFocus: MovementPattern;
  suggestedFocus: MovementPattern | null;
  reason: string;
  recovery: MuscleRecovery[];
}

export interface Balance {
  days: number;
  recovery: MuscleRecovery[];
  coverage: { muscle: Muscle; sets: number; weeklySets: number; variations: { tag: string; label: string; sets: number }[] }[];
}

export interface StrengthSeries {
  id: string;
  name: string;
  pattern: string;
  unit: "e1RM lb" | "reps";
  points: { date: string; value: number; bestSet: string }[];
}

export interface StrengthSummary {
  sessions: number;
  sets: number;
  volumeLb: number;
  averageRpe: number | null;
  hitTargetPercent: number | null;
  setsByMuscle: Partial<Record<Muscle, number>>;
  bestLifts: Record<string, { name: string; value: number }>;
}

export interface DaySummary {
  date: string;
  steps: number | null;
  stepGoal: number | null;
  hitStepGoal: boolean | null;
  workouts: { id: string; focus: MovementPattern | null; setCount: number; minutes: number | null; exercises: { name: string; sets: string[] }[] }[];
  scan: { weightKg: number | null; bodyFatPct: number | null; muscleMassKg: number | null; source: string } | null;
}

export interface AutofillResult {
  strengthAdded: number;
  restAdded: number;
  splitLabel: string;
  notes: string[];
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const TOKEN_KEY = "strength_app_token";

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};

// Validation failures come back as zod's flattened error object
// ({ formErrors, fieldErrors }) rather than a string — turn those into a
// readable sentence instead of "[object Object]".
function errorMessage(error: unknown, status: number): string {
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const { formErrors = [], fieldErrors = {} } = error as {
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
    const messages = [...formErrors, ...Object.values(fieldErrors).flatMap((m) => m ?? [])];
    if (messages.length > 0) return messages.join(" ");
  }
  return `Request failed: ${status}`;
}

export interface GolfRound {
  id: string;
  date: string; // YYYY-MM-DD
  course: string;
  holes: 9 | 18;
  score: number | null;
  notes: string | null;
  /** "strava" when it came from (or was matched to) a Strava Golf activity. */
  source: "manual" | "strava";
}
export type GolfRoundInput = Omit<GolfRound, "id" | "source">;
export interface GolfRoundsResponse {
  quarter: string;
  target: number | null;
  count: number;
  remaining: number | null;
  daysLeft: number;
  neededPerWeek: number | null;
  status: "done" | "missed" | "on_track" | "behind" | null;
  averageScore18: number | null;
  bestScore18: number | null;
  rounds: GolfRound[];
  courses: string[];
  stravaConnected: boolean;
  /** Set when the automatic Strava check failed. */
  syncError: string | null;
  /** New rounds this check brought in from Strava. */
  imported: number;
}

export interface AdminUsage {
  totalUsers: number;
  optedInUsers: number;
  features: { name: string; events30: number; users30: number; users7: number }[];
}

// --- Feature-use tracking ----------------------------------------------------
// Reports that a feature was used (a name from the server's allowed list,
// never anything the person entered). The server records it only for people
// who gave the analytics consent; if it says it didn't, sending pauses for a
// while. Never throws and never blocks anything.
export type UsageEventName =
  | "page_calendar" | "page_day" | "page_log" | "page_progress" | "page_settings" | "page_plan"
  | "log_steps_tab" | "log_nutrition_tab" | "log_other_sport_tab"
  | "workout_generated" | "workout_saved" | "gym_switched" | "gym_preset_applied"
  | "custom_equipment_added" | "custom_exercise_created" | "steps_saved" | "nutrition_saved"
  | "body_scan_added" | "goal_created" | "message_dismissed" | "golf_round_logged" | "golf_goal_set";

let trackingPausedUntil = 0;
const lastSent = new Map<string, number>();

export function track(name: UsageEventName): void {
  const now = Date.now();
  if (!auth.getToken() || now < trackingPausedUntil) return;
  // The same screen opened twice in quick succession counts once.
  if (now - (lastSent.get(name) ?? 0) < 10_000) return;
  lastSent.set(name, now);
  request<{ recorded: boolean }>("/usage", { method: "POST", body: JSON.stringify({ name }) })
    .then((r) => {
      if (!r.recorded) trackingPausedUntil = Date.now() + 10 * 60 * 1000;
    })
    .catch(() => {});
}

// Runs an action and reports its use once it has succeeded.
function tracked<T>(name: UsageEventName, p: Promise<T>): Promise<T> {
  return p.then((r) => {
    track(name);
    return r;
  });
}

export interface AppMessage {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}
export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastSeenAt: string | null;
  totpEnabled: boolean;
  suspendedAt: string | null;
  isAdmin: boolean;
  sessionCount: number;
  lastSessionAt: string | null;
}
export interface AdminUsersResponse {
  summary: { total: number; newLast7Days: number; activeLast7Days: number; suspended: number };
  users: AdminUser[];
}
export interface AdminMessage {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  expiresAt: string | null;
  targetEmail: string | null;
  everyone: boolean;
  dismissedBy: number;
}
export interface AdminLogEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
}

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
    const err = new Error(errorMessage(body.error, res.status)) as Error & {
      requires2fa?: boolean;
      status?: number;
      body?: any;
    };
    err.requires2fa = body.requires2fa;
    err.status = res.status;
    err.body = body;
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
  /** Present after a 2FA code was accepted: lets this device skip the code
   * for trustHours (see lib/twoFactorTrust.ts). */
  trustToken?: string;
  trustHours?: number;
}

export const api = {
  register: (email: string, password: string) =>
    request<LoginResponse>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string, code?: string, trustToken?: string) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password, code, trustToken }) }),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  checkResetToken: (token: string) =>
    request<{ valid: boolean; secondsLeft: number }>("/auth/reset-password/check", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
  setup2fa: () => request<{ secret: string; qrDataUrl: string }>("/auth/2fa/setup", { method: "POST" }),

  verify2fa: (code: string) =>
    request<{ totpEnabled: boolean; trustToken?: string; trustHours?: number }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  getExercises: () => request<Exercise[]>("/exercises"),

  getGyms: () => request<GymsResponse>("/gyms"),
  saveGym: (id: string, data: GymUpdate) =>
    request<GymsResponse>(`/gyms/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  /** Applies a preset to a gym (or, with no presetId, resets it to the preset it follows). */
  applyGymPreset: (id: string, presetId?: string) =>
    tracked("gym_preset_applied", request<GymsResponse>(`/gyms/${id}/preset`, { method: "POST", body: JSON.stringify({ presetId }) })),
  /** Remembers which gym the workout page starts on. */
  setActiveGym: (gymId: string) =>
    tracked("gym_switched", request<GymsResponse>("/gyms/active", { method: "PUT", body: JSON.stringify({ gymId }) })),
  addCustomEquipment: (name: string) =>
    tracked("custom_equipment_added", request<GymsResponse>("/gyms/custom-equipment", { method: "POST", body: JSON.stringify({ name }) })),
  removeCustomEquipment: (id: string) => request<GymsResponse>(`/gyms/custom-equipment/${id}`, { method: "DELETE" }),

  createExercise: (data: CustomExerciseInput) =>
    tracked("custom_exercise_created", request<Exercise>("/exercises", { method: "POST", body: JSON.stringify(data) })),
  archiveExercise: (id: string) => request<void>(`/exercises/${id}`, { method: "DELETE" }),

  logSession: (data: LogSessionInput) =>
    tracked("workout_saved", request<{ id: string }>("/sessions", { method: "POST", body: JSON.stringify(data) })),

  submitFeedback: (sessionId: string, thumbsUp: boolean) =>
    request(`/sessions/${sessionId}/feedback`, { method: "POST", body: JSON.stringify({ thumbsUp }) }),

  getRecentSessions: (limit = 20) => request(`/sessions?limit=${limit}`),

  getExerciseHistory: (exerciseId: string, limit = 10) =>
    request(`/sessions/exercise/${exerciseId}?limit=${limit}`),

  /** Builds (or rebuilds) the day's workout with the AI. */
  generatePlan: (
    pattern: MovementPattern,
    date: string,
    plannedSessionId?: string | null,
    replaceWorkoutId?: string | null,
    gymId?: string
  ) =>
    tracked(
      "workout_generated",
      request<DailyWorkout>(`/workouts/plan/${pattern}`, {
        method: "POST",
        // replaceWorkoutId is the workout the person agreed to replace; without
        // it the server refuses (409) to build over an existing workout.
        body: JSON.stringify({ date, plannedSessionId: plannedSessionId ?? null, replaceWorkoutId: replaceWorkoutId ?? null, gymId }),
      })
    ),
  /** Workouts built in the last 30 days (and any scheduled ahead). No AI call. */
  getSavedWorkouts: (today: string) => request<SavedWorkout[]>(`/workouts/saved?today=${today}`),
  /** Uses a saved workout on another day by copying it. No AI call. */
  reuseWorkout: (sourceId: string, date: string, replaceWorkoutId?: string | null) =>
    request<DailyWorkout>("/workouts/reuse", {
      method: "POST",
      body: JSON.stringify({ sourceId, date, replaceWorkoutId: replaceWorkoutId ?? null }),
    }),
  /** The workout already built for that day, if any. No AI call. */
  getDailyWorkout: (date: string) => request<DailyWorkout | null>(`/workouts/day/${date}`),
  saveWorkoutProgress: (date: string, workoutId: string, progress: WorkoutProgress) => {
    const body = JSON.stringify({ workoutId, progress });
    return request<{ updatedAt: string }>(`/workouts/day/${date}/progress`, {
      method: "PUT",
      body,
      // Lets a save started just as the app is backgrounded (switching to a
      // video, another app) still complete. Limited to small bodies.
      keepalive: body.length < 60000,
    });
  },

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

  createPlan: (data: {
    overallGoal?: string;
    priorities: { sport: Sport; priority: PriorityLevel; goalNote?: string; weeklyMinutesAvailable?: number }[];
  }) => request<TrainingPlan>("/plan", { method: "POST", body: JSON.stringify(data) }),

  updatePlanPriorities: (
    planId: string,
    data: {
      overallGoal?: string;
      priorities: { sport: Sport; priority: PriorityLevel; goalNote?: string; weeklyMinutesAvailable?: number }[];
    }
  ) => request<TrainingPlan>(`/plan/${planId}/priorities`, { method: "PATCH", body: JSON.stringify(data) }),

  generateApproaches: (planId: string) => request<TrainingPlan>(`/plan/${planId}/approaches/generate`, { method: "POST" }),

  updateApproach: (
    planId: string,
    sport: Sport,
    data: {
      status?: ApproachStatus;
      approachText?: string;
      weeklySessionTarget?: number;
      sessionMinutes?: number;
      milestones?: Milestone[];
    }
  ) => request<TrainingPlan>(`/plan/${planId}/approaches/${sport}`, { method: "PATCH", body: JSON.stringify(data) }),

  // How many session cards the schedule builder needs to show per sport,
  // and how many are already placed in the current framework version.
  getSlotsNeeded: (planId: string) => request<SlotsNeeded[]>(`/plan/${planId}/framework/slots-needed`),

  // Saves the schedule the person built themselves — a full replace of the
  // current framework version's slots. No AI proposes placement; see
  // api.ts's DraftFrameworkSlot and pages/ScheduleBuilder.tsx.
  saveFramework: (planId: string, slots: DraftFrameworkSlot[], note?: string) =>
    request<TrainingPlan>(`/plan/${planId}/framework`, { method: "PUT", body: JSON.stringify({ slots, note }) }),

  updateFrameworkSlot: (
    planId: string,
    slotId: string,
    data: { dayOfWeek?: number; timeOfDay?: TimeOfDay; sessionType?: SessionType; movementPattern?: MovementPattern; estimatedMinutes?: number; label?: string }
  ) => request<TrainingPlan>(`/plan/${planId}/framework/${slotId}`, { method: "PATCH", body: JSON.stringify(data) }),

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

  // Updates approach content only (weekly session count, session length,
  // approach text) — never the schedule. changeSummary is a one-line
  // description of what the AI changed, for the caller to show once.
  amendPlan: (planId: string, requestText: string) =>
    request<TrainingPlan & { changeSummary: string }>(`/plan/${planId}/amend`, { method: "POST", body: JSON.stringify({ requestText }) }),

  // todayKey should be a local YYYY-MM-DD (see lib/location.ts's
  // formatLocalDateKey) so the week/month periods line up with the
  // person's own calendar day rather than the server's.
  getDashboard: (planId: string, todayKey: string) => request<Dashboard>(`/plan/${planId}/dashboard?today=${todayKey}`),

  // --- Profile, consent ----------------------------------------------------
  getProfile: () => request<Profile>("/profile"),
  updateProfile: (data: Partial<Pick<Profile, "birthYear" | "sex" | "heightCm" | "trainingDaysPerWeek" | "dailyStepGoal">>) =>
    request<void>("/profile", { method: "PATCH", body: JSON.stringify(data) }),
  createIngestToken: () => request<{ token: string }>("/profile/ingest-token", { method: "POST" }),
  revokeIngestToken: () => request<void>("/profile/ingest-token", { method: "DELETE" }),
  getConsent: () => request<ConsentInfo>("/consent"),
  saveConsent: (choices: Partial<Record<ConsentPurpose, boolean>>) =>
    request<{ state: Record<ConsentPurpose, boolean | null> }>("/consent", { method: "POST", body: JSON.stringify({ choices }) }),
  // The backend URL, for the Apple Health / Renpho setup instructions.
  apiUrl: API_URL,

  // --- Body data & goals ----------------------------------------------------
  getMeasurements: (from?: string, to?: string) => request<BodyMeasurement[]>(`/body/measurements${qs({ from, to })}`),
  addMeasurement: (data: { measuredAt?: string; weightKg?: number; bodyFatPct?: number; muscleMassKg?: number }) =>
    tracked("body_scan_added", request("/body/measurements", { method: "POST", body: JSON.stringify(data) })),
  deleteMeasurement: (id: string) => request<void>(`/body/measurements/${id}`, { method: "DELETE" }),
  getBodySummary: (from: string, to: string) => request<BodySummary>(`/body/summary${qs({ from, to })}`),
  getGoals: () => request<BodyGoal[]>("/body/goals"),
  createGoal: (data: { metric: BodyMetric; targetValue: number; targetDate: string; startValue?: number }) =>
    tracked("goal_created", request<{ id: string }>("/body/goals", { method: "POST", body: JSON.stringify(data) })),
  reviseGoal: (id: string, data: { targetValue?: number; targetDate?: string; reason: RevisionReason; note?: string }) =>
    request(`/body/goals/${id}/revise`, { method: "POST", body: JSON.stringify(data) }),
  setGoalStatus: (id: string, status: "ACTIVE" | "ACHIEVED" | "CLOSED") =>
    request<void>(`/body/goals/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  getQuarterReview: (quarter?: string) => request<QuarterReview>(`/body/review${qs({ quarter })}`),
  getBenchmarks: () => request<Benchmarks>("/body/benchmarks"),

  // --- Messages from the app's owner, and the admin area ---------------------
  getMessages: () => request<AppMessage[]>("/messages"),
  dismissMessage: (id: string) => tracked("message_dismissed", request<void>(`/messages/${id}/dismiss`, { method: "POST" })),
  adminMe: () => request<{ isAdmin: boolean; totpEnabled: boolean }>("/admin/me"),
  adminUsers: () => request<AdminUsersResponse>("/admin/users"),
  adminSuspend: (id: string) => request<{ ok: true }>(`/admin/users/${id}/suspend`, { method: "POST" }),
  adminReinstate: (id: string) => request<{ ok: true }>(`/admin/users/${id}/reinstate`, { method: "POST" }),
  adminDeleteUser: (id: string, confirmEmail: string) =>
    request<void>(`/admin/users/${id}`, { method: "DELETE", body: JSON.stringify({ confirmEmail }) }),
  adminMessages: () => request<AdminMessage[]>("/admin/messages"),
  adminSendMessage: (data: { title: string; body: string; targetUserId?: string; expiresInDays?: number }) =>
    request<{ id: string }>("/admin/messages", { method: "POST", body: JSON.stringify(data) }),
  adminWithdrawMessage: (id: string) => request<void>(`/admin/messages/${id}`, { method: "DELETE" }),
  adminUsage: () => request<AdminUsage>("/admin/usage"),
  adminLog: () => request<AdminLogEntry[]>("/admin/log"),

  // --- Golf rounds and the quarterly rounds goal -------------------------------
  getGolfRounds: (quarter?: string) => request<GolfRoundsResponse>(`/golf-rounds${qs({ quarter })}`),
  syncGolfRounds: (quarter: string) => request<GolfRoundsResponse>(`/golf-rounds/sync${qs({ quarter })}`, { method: "POST" }),
  addGolfRound: (data: GolfRoundInput) =>
    tracked("golf_round_logged", request<GolfRound>("/golf-rounds", { method: "POST", body: JSON.stringify(data) })),
  updateGolfRound: (id: string, data: GolfRoundInput) =>
    request<GolfRound>(`/golf-rounds/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGolfRound: (id: string) => request<void>(`/golf-rounds/${id}`, { method: "DELETE" }),
  setGolfRoundGoal: (quarter: string, target: number) =>
    tracked("golf_goal_set", request<void>("/golf-rounds/goal/set", { method: "PUT", body: JSON.stringify({ quarter, target }) })),
  clearGolfRoundGoal: (quarter: string) => request<void>(`/golf-rounds/goal/${quarter}`, { method: "DELETE" }),

  // --- Nutrition ------------------------------------------------------------
  getNutrition: (from: string, to: string) => request<NutritionResponse>(`/nutrition${qs({ from, to })}`),
  setNutrition: (date: string, data: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number }) =>
    tracked("nutrition_saved", request<void>(`/nutrition/${date}`, { method: "PUT", body: JSON.stringify(data) })),

  // --- Steps ----------------------------------------------------------------
  getSteps: (from: string, to: string) => request<StepsResponse>(`/steps${qs({ from, to })}`),
  setSteps: (date: string, steps: number) =>
    tracked("steps_saved", request<void>(`/steps/${date}`, { method: "PUT", body: JSON.stringify({ steps }) })),

  // --- Strength progress ----------------------------------------------------
  getToday: () => request<TodaySuggestion>("/progress/today"),
  getBalance: (days = 28) => request<Balance>(`/progress/balance?days=${days}`),
  getStrengthSeries: (from?: string, to?: string) => request<StrengthSeries[]>(`/progress/strength${qs({ from, to })}`),
  getStrengthSummary: (from: string, to: string) => request<StrengthSummary>(`/progress/strength/summary${qs({ from, to })}`),

  // --- Calendar day view + auto-fill -----------------------------------------
  getDaySummaries: (from: string, to: string) =>
    request<DaySummary[]>(`/calendar/days${qs({ from, to, tzOffset: new Date().getTimezoneOffset() })}`),
  autofillWeek: (start: string, today: string) =>
    request<AutofillResult>("/calendar/autofill", { method: "POST", body: JSON.stringify({ start, today }) }),
};
