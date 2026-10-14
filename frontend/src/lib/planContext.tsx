import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, DailyWorkout, WorkoutProgress } from "./api.js";
import { formatLocalDateKey } from "./location.js";

// Today's strength workout. It's built by the AI once (or when explicitly
// regenerated) and saved on the server per day, so every device — and every
// refresh — opens the same workout without calling the AI again. This
// context loads it when the app opens and re-checks whenever the app comes
// back to the foreground, picking up a workout built, regenerated, updated
// or saved on another device in the meantime.
//
// Two rules keep a workout from ever being lost by accident:
// - A failed load is never treated as "no workout today". It retries, and
//   if it still fails the app says so (loadFailed) instead of offering to
//   build a new workout.
// - Which workout is *open* (the set-by-set log showing, rather than the
//   build page) is remembered on the device, and a workout with sets logged
//   reopens by itself, so a browser reloading or restoring the tab drops
//   you straight back into it.

interface PlanContextValue {
  /** Today's workout, if one has been built (saved or not). */
  today: DailyWorkout | null;
  /** The workout shown in the log screen: today's, when open and not yet saved. */
  plan: DailyWorkout | null;
  /** True once today's workout has been successfully checked with the server. */
  loaded: boolean;
  /** True when the check kept failing (offline, server hiccup) and we don't
   * know whether today has a workout. The build page must not be offered. */
  loadFailed: boolean;
  retryLoad: () => void;
  /** Today's date as YYYY-MM-DD in the device's time zone. */
  date: string;
  /** Use a freshly built/regenerated workout and open it. */
  setBuilt: (workout: DailyWorkout) => void;
  /** Show a workout the server already had (it wasn't known here), without
   * replacing anything. Opens by itself if it has progress in it. */
  adopt: (workout: DailyWorkout) => void;
  openWorkout: () => void;
  closeWorkout: () => void;
  /** Mark today's workout as saved (logged) after the session is stored. */
  markSaved: (sessionId: string) => void;
  /** Progress as last loaded from the server, and a counter that changes
   * whenever it was replaced from the server (so the log screen reloads it). */
  remoteProgress: WorkoutProgress | null;
  remoteVersion: number;
  /** Saves progress for the open workout. Resolves false if it was
   * regenerated or saved on another device (the context then reloads). */
  saveProgress: (progress: WorkoutProgress) => Promise<boolean>;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

const OPEN_KEY = "fc_open_workout";
const CLOSED_KEY = "fc_closed_workout";
// Waits between attempts when loading fails (a phone waking a tab often
// fails the first request or two).
const RETRY_DELAYS_MS = [800, 2000, 4000];

// localStorage (not sessionStorage): survives the browser discarding and
// restoring a background tab.
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (e.g. private mode) — just won't survive a reload.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loggedSets(workout: DailyWorkout | null): number {
  if (!workout?.progress?.rows) return 0;
  return Object.values(workout.progress.rows).reduce((n, rows) => n + rows.filter((r) => r.logged).length, 0);
}

function syncKey(workout: DailyWorkout | null): string | null {
  return workout ? `${workout.workoutId}|${workout.updatedAt}|${workout.savedSessionId}` : null;
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<DailyWorkout | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => readKey(OPEN_KEY));
  const [closedId, setClosedId] = useState<string | null>(() => readKey(CLOSED_KEY));
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [date, setDate] = useState(() => formatLocalDateKey(new Date()));
  const [remoteProgress, setRemoteProgress] = useState<WorkoutProgress | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);
  // What this device last saw on the server, to tell whether a re-check
  // brought anything new.
  const syncedRef = useRef<string | null>(null);
  // Bumped whenever this device changes the workout itself, so a re-check
  // that started before the change doesn't overwrite it with stale data.
  const localChangeRef = useRef(0);

  const setOpen = useCallback((id: string | null) => {
    setOpenId(id);
    writeKey(OPEN_KEY, id);
  }, []);
  const setClosed = useCallback((id: string | null) => {
    setClosedId(id);
    writeKey(CLOSED_KEY, id);
  }, []);

  const apply = useCallback((workout: DailyWorkout | null) => {
    syncedRef.current = syncKey(workout);
    setToday(workout);
    setRemoteProgress(workout?.progress ?? null);
    setRemoteVersion((v) => v + 1);
  }, []);

  // Checks the server for today's workout. `attempts` > 1 retries after
  // failures, so a flaky moment right after the tab wakes doesn't look like
  // "no workout".
  const refresh = useCallback(
    async (attempts: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const changeAtStart = localChangeRef.current;
        const day = formatLocalDateKey(new Date());
        let workout: DailyWorkout | null = null;
        let ok = false;
        for (let i = 0; i < attempts && !ok; i++) {
          if (i > 0) await sleep(RETRY_DELAYS_MS[Math.min(i - 1, RETRY_DELAYS_MS.length - 1)]);
          try {
            workout = await api.getDailyWorkout(day);
            ok = true;
          } catch (err) {
            if ((err as { status?: number }).status === 401) break; // signed out: retrying can't help
          }
        }
        if (!ok) {
          // Only matters if we've never heard from the server: once we know
          // today's state, a failed background re-check just keeps it.
          if (!loadedRef.current) setLoadFailed(true);
          return;
        }
        loadedRef.current = true;
        setLoaded(true);
        setLoadFailed(false);
        setDate(day);
        if (changeAtStart !== localChangeRef.current) return;
        if (syncKey(workout) === syncedRef.current) return;
        apply(workout);
      } finally {
        loadingRef.current = false;
      }
    },
    [apply]
  );

  useEffect(() => {
    refresh(RETRY_DELAYS_MS.length + 1);
    const onWake = () => {
      if (document.visibilityState === "visible") refresh(loadedRef.current ? 1 : RETRY_DELAYS_MS.length + 1);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [refresh]);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    refresh(RETRY_DELAYS_MS.length + 1);
  }, [refresh]);

  const setBuilt = useCallback(
    (workout: DailyWorkout) => {
      localChangeRef.current++;
      apply(workout);
      setDate(workout.date);
      loadedRef.current = true;
      setLoaded(true);
      setLoadFailed(false);
      setClosed(null);
      setOpen(workout.workoutId);
    },
    [apply, setOpen, setClosed]
  );

  const adopt = useCallback(
    (workout: DailyWorkout) => {
      localChangeRef.current++;
      apply(workout);
      setDate(workout.date);
      loadedRef.current = true;
      setLoaded(true);
      setLoadFailed(false);
    },
    [apply]
  );

  const openWorkout = useCallback(() => {
    if (!today) return;
    setClosed(null);
    setOpen(today.workoutId);
  }, [today, setOpen, setClosed]);

  const closeWorkout = useCallback(() => {
    if (!today) return;
    setOpen(null);
    // Remembered so a workout with sets logged doesn't pop back open on the
    // next load after the person chose to go back to the build page.
    setClosed(today.workoutId);
  }, [today, setOpen, setClosed]);

  const markSaved = useCallback(
    (sessionId: string) => {
      localChangeRef.current++;
      setToday((t) => (t ? { ...t, savedSessionId: sessionId } : t));
      syncedRef.current = null; // next re-check picks up the server's copy
      setOpen(null);
      setClosed(null);
    },
    [setOpen, setClosed]
  );

  const saveProgress = useCallback(
    async (progress: WorkoutProgress) => {
      if (!today) return false;
      localChangeRef.current++;
      try {
        const { updatedAt } = await api.saveWorkoutProgress(today.date, today.workoutId, progress);
        if (syncedRef.current?.startsWith(`${today.workoutId}|`)) {
          syncedRef.current = `${today.workoutId}|${updatedAt}|${today.savedSessionId}`;
        }
        // Keep this device's copy current too (e.g. the "sets logged so
        // far" count on the build page after going Back).
        setToday((t) => (t && t.workoutId === today.workoutId ? { ...t, progress, updatedAt } : t));
        return true;
      } catch (err) {
        if ((err as { status?: number }).status === 409) {
          // Regenerated or saved elsewhere — show what the server has now.
          syncedRef.current = null;
          localChangeRef.current++;
          await refresh(1);
          return false;
        }
        throw err;
      }
    },
    [today, refresh]
  );

  // Open when chosen, or when it has sets logged and wasn't deliberately
  // closed. Never for a saved (finished) workout, or one that was
  // regenerated or saved elsewhere.
  const plan =
    today && !today.savedSessionId && (openId === today.workoutId || (loggedSets(today) > 0 && closedId !== today.workoutId))
      ? today
      : null;

  return (
    <PlanContext.Provider
      value={{
        today,
        plan,
        loaded,
        loadFailed,
        retryLoad,
        date,
        setBuilt,
        adopt,
        openWorkout,
        closeWorkout,
        markSaved,
        remoteProgress,
        remoteVersion,
        saveProgress,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within a PlanProvider");
  return ctx;
}

export { loggedSets };
