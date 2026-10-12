import { createContext, useContext, useState, ReactNode } from "react";
import { WorkoutPlan } from "./api.js";

interface PlanContextValue {
  plan: WorkoutPlan | null;
  setPlan: (plan: WorkoutPlan | null) => void;
  /** The calendar entry the current workout was started from, if any —
   * marked done when the workout is saved. */
  plannedSessionId: string | null;
  setPlannedSessionId: (id: string | null) => void;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  const [plannedSessionId, setPlannedSessionId] = useState<string | null>(null);
  return <PlanContext.Provider value={{ plan, setPlan, plannedSessionId, setPlannedSessionId }}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within a PlanProvider");
  return ctx;
}
