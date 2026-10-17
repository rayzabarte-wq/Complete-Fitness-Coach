import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api.js";
import type { Gym } from "./equipment.js";

// Which gym (Home / Regular / Visiting) workouts are built for. Shared by the
// gym button in the header and the Log screen, so changing it in one place
// changes it everywhere. The choice is remembered on the account. The
// header's gym button only appears on strength screens (useShowGymMenu): where
// you train means nothing for golf, running and the rest.

interface GymContextValue {
  gyms: Gym[];
  /** The gym new workouts are built for, once the list has loaded. */
  activeGymId: string | null;
  /** Switches gym (instantly on screen, then saved to the account). */
  chooseGym: (id: string) => void;
  /** Re-reads the gyms, e.g. after one was renamed in Settings. */
  refresh: () => void;
  /** Whether the header's gym button is showing: only on strength screens. */
  showMenu: boolean;
  setShowMenu: (show: boolean) => void;
}

const GymContext = createContext<GymContextValue>({ gyms: [], activeGymId: null, chooseGym: () => {}, refresh: () => {}, showMenu: false, setShowMenu: () => {} });

export function GymProvider({ children }: { children: ReactNode }) {
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [activeGymId, setActiveGymId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);

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

  return <GymContext.Provider value={{ gyms, activeGymId, chooseGym, refresh, showMenu, setShowMenu }}>{children}</GymContext.Provider>;
}

export const useGyms = () => useContext(GymContext);

/** Call from a strength screen: shows the header's gym button while it's on screen. */
export function useShowGymMenu() {
  const { setShowMenu } = useGyms();
  useEffect(() => {
    setShowMenu(true);
    return () => setShowMenu(false);
  }, [setShowMenu]);
}
