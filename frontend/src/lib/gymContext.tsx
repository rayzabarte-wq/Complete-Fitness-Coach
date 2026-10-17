import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api.js";
import type { Gym } from "./equipment.js";

// Which gym (Home / Regular / Visiting) workouts are built for. Shared by the
// gym button in the header and the Log screen, so changing it in one place
// changes it everywhere. The choice is remembered on the account.

interface GymContextValue {
  gyms: Gym[];
  /** The gym new workouts are built for, once the list has loaded. */
  activeGymId: string | null;
  /** Switches gym (instantly on screen, then saved to the account). */
  chooseGym: (id: string) => void;
  /** Re-reads the gyms, e.g. after one was renamed in Settings. */
  refresh: () => void;
}

const GymContext = createContext<GymContextValue>({ gyms: [], activeGymId: null, chooseGym: () => {}, refresh: () => {} });

export function GymProvider({ children }: { children: ReactNode }) {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .getGyms()
      .then((res) => {
        setGyms(res.gyms);
        setActiveGymId((current) => current ?? res.activeGymId ?? res.gyms[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const chooseGym = useCallback((id: string) => {
    setActiveGymId(id);
    api.setActiveGym(id).catch(() => {});
  }, []);

  return <GymContext.Provider value={{ gyms, activeGymId, chooseGym, refresh }}>{children}</GymContext.Provider>;
}

export const useGyms = () => useContext(GymContext);
