import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, WorkoutPlan, WorkoutProgress } from "./api.js";

// The strength workout currently in progress. It lives on the server
// (GET/PUT/DELETE /workouts/active), not just in this tab, so a workout
// built on one device can be opened and continued on another. This context
// loads it when the app opens and re-checks whenever the app comes back to
// the foreground, picking up a workout built — or progress entered,
// finished or discarded — on another device in the meantime.

interface PlanContextValue {
  plan: WorkoutPlan | null;
  /** Set after building a new workout (already saved on the server). */
  setPlan: (plan: WorkoutPlan) => void;
  /** Ends the workout here and on the server (after saving, or to discard). */
  clearPlan: () => void;
  /** The calendar entry the current workout was started from, if any —
   * marked done when the workout is saved. */
  plannedSessionId: string | null;
  /** False until the first check with the server has finished. */
  loaded: boolean;
  /** Progress as last saved on the server, and a counter that changes
   * whenever it was replaced from the server (so the log screen reloads it). */
  remoteProgress: WorkoutProgress | null;
  remoteVersion: number;
  /** Saves progress for the current workout. Resolves false if the workout
   * was replaced or finished on another device (the context then reloads). */
  saveProgress: (progress: WorkoutProgress) => Promise<boolean>;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlanState] = useState<WorkoutPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [remoteProgress, setRemoteProgress] = useState<WorkoutProgress | null>(null);
  const [remoteVersion, setRemoteVersion] = useState(0);
  // What this device last saw on the server, to tell whether a re-check
  // brought anything new.
  const syncedRef = useRef<{ workoutId: string | null; updatedAt: string | null }>({ workoutId: null, updatedAt: null });
  // Bumped whenever this device changes the workout itself, so a re-check
  // that started before the change doesn't overwrite it with stale data.
  const localChangeRef = useRef(0);

  const refresh = useCallback(async () => {
    const changeAtStart = localChangeRef.current;
    let active;
    try {
      active = await api.getActiveWorkout();
    } catch {
      setLoaded(true);
      return; // offline or signed out — keep whatever is showing
    }
    setLoaded(true);
    if (changeAtStart !== localChangeRef.current) return;

    if (!active) {
      if (syncedRef.current.workoutId !== null) {
        // Finished or discarded on another device.
        syncedRef.current = { workoutId: null, updatedAt: null };
        setPlanState(null);
        setRemoteProgress(null);
      }
      return;
    }

    const synced = syncedRef.current;
    if (active.workoutId === synced.workoutId && active.updatedAt === synced.updatedAt) return;
    syncedRef.current = { workoutId: active.workoutId, updatedAt: active.updatedAt };
    const { progress, updatedAt: _updatedAt, ...workout } = active;
    setPlanState(workout);
    setRemoteProgress(progress);
    setRemoteVersion((v) => v + 1);
  }, []);

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

  const setPlan = useCallback((next: WorkoutPlan) => {
    localChangeRef.current++;
    syncedRef.current = { workoutId: next.workoutId, updatedAt: null };
    setPlanState(next);
    setRemoteProgress(null);
    setRemoteVersion((v) => v + 1);
  }, []);

  const clearPlan = useCallback(() => {
    localChangeRef.current++;
    syncedRef.current = { workoutId: null, updatedAt: null };
    setPlanState(null);
    setRemoteProgress(null);
    api.discardActiveWorkout().catch(() => {});
  }, []);

  const saveProgress = useCallback(
    async (progress: WorkoutProgress) => {
      if (!plan) return false;
      localChangeRef.current++;
      try {
        const { updatedAt } = await api.saveWorkoutProgress(plan.workoutId, progress);
        if (syncedRef.current.workoutId === plan.workoutId) {
          syncedRef.current = { workoutId: plan.workoutId, updatedAt };
        }
        return true;
      } catch (err) {
        if ((err as { status?: number }).status === 409) {
          // Replaced or finished elsewhere — show what the server has now.
          syncedRef.current = { workoutId: null, updatedAt: null };
          localChangeRef.current++;
          await refresh();
          return false;
        }
        throw err;
      }
    },
    [plan, refresh]
  );

  return (
    <PlanContext.Provider
      value={{
        plan,
        setPlan,
        clearPlan,
        plannedSessionId: plan?.plannedSessionId ?? null,
        loaded,
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
