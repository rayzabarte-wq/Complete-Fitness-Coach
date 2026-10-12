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
// Whether the workout is currently *open* (the set-by-set log showing,
// rather than the build page) is per device, remembered for the browser
// tab so a refresh mid-workout stays in the workout.

interface PlanContextValue {
  /** Today's workout, if one has been built (saved or not). */
  today: DailyWorkout | null;
  /** The workout shown in the log screen: today's, when open and not yet saved. */
  plan: DailyWorkout | null;
  /** False until the first check with the server has finished. */
  loaded: boolean;
  /** Today's date as YYYY-MM-DD in the device's time zone. */
  date: string;
  /** Use a freshly built/regenerated workout and open it. */
  setBuilt: (workout: DailyWorkout) => void;
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

const OPEN_KEY = "openWorkoutId";

function readOpenId(): string | null {
  try {
    return sessionStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

function writeOpenId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(OPEN_KEY, id);
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage unavailable (e.g. private mode) — just won't survive refresh.
  }
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<DailyWorkout | null>(null);
  const [openId, setOpenId] = useState<string | null>(readOpenId);
  const [loaded, setLoaded] = useState(false);
  const [date, setDate] = useState(() => formatLocalDateKey(new Date()));
  const [remoteProgress, setRemoteProgress] = useState<WorkoutProgress | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  // What this device last saw on the server, to tell whether a re-check
  // brought anything new.
  const syncedRef = useRef<string | null>(null);
  // Bumped whenever this device changes the workout itself, so a re-check
  // that started before the change doesn't overwrite it with stale data.
  const localChangeRef = useRef(0);

  const setOpen = useCallback((id: string | null) => {
    setOpenId(id);
    writeOpenId(id);
  }, []);

  const apply = useCallback((workout: DailyWorkout | null) => {
    syncedRef.current = workout ? `${workout.workoutId}|${workout.updatedAt}|${workout.savedSessionId}` : null;
    setToday(workout);
    setRemoteProgress(workout?.progress ?? null);
    setRemoteVersion((v) => v + 1);
  }, []);

  const refresh = useCallback(async () => {
    const changeAtStart = localChangeRef.current;
    const day = formatLocalDateKey(new Date());
    let workout: DailyWorkout | null;
    try {
      workout = await api.getDailyWorkout(day);
    } catch {
      setLoaded(true);
      return; // offline or signed out — keep whatever is showing
    }
    setLoaded(true);
    setDate(day);
    if (changeAtStart !== localChangeRef.current) return;
    const key = workout ? `${workout.workoutId}|${workout.updatedAt}|${workout.savedSessionId}` : null;
    if (key === syncedRef.current) return;
    apply(workout);
  }, [apply]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const setBuilt = useCallback(
    (workout: DailyWorkout) => {
      localChangeRef.current++;
      apply(workout);
      setDate(workout.date);
      setOpen(workout.workoutId);
    },
    [apply, setOpen]
  );

  const openWorkout = useCallback(() => {
    if (today) setOpen(today.workoutId);
  }, [today, setOpen]);

  const closeWorkout = useCallback(() => setOpen(null), [setOpen]);

  const markSaved = useCallback(
    (sessionId: string) => {
      localChangeRef.current++;
      setToday((t) => (t ? { ...t, savedSessionId: sessionId } : t));
      syncedRef.current = null; // next re-check picks up the server's copy
      setOpen(null);
    },
    [setOpen]
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
          await refresh();
          return false;
        }
        throw err;
      }
    },
    [today, refresh]
  );

  // Open only while it's today's, unsaved workout (a workout regenerated or
  // saved elsewhere closes it here).
  const plan = today && !today.savedSessionId && openId === today.workoutId ? today : null;

  return (
    <PlanContext.Provider
      value={{
        today,
        plan,
        loaded,
        date,
        setBuilt,
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
