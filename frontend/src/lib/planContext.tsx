import { createContext, useContext, useState, ReactNode } from "react";
import { WorkoutPlan } from "./api.js";

interface PlanContextValue {
  plan: WorkoutPlan | null;
  setPlan: (plan: WorkoutPlan | null) => void;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);
  return <PlanContext.Provider value={{ plan, setPlan }}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used within a PlanProvider");
  return ctx;
}
