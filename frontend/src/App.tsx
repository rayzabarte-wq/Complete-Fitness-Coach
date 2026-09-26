import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import LogWorkout from "./pages/LogWorkout.js";
import History from "./pages/History.js";
import Workout from "./pages/Workout.js";
import Login from "./pages/Login.js";
import Settings from "./pages/Settings.js";
import Calendar from "./pages/Calendar.js";
import Plan from "./pages/Plan.js";
import { auth } from "./lib/api.js";
import { PlanProvider } from "./lib/planContext.js";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!auth.getToken());

  if (!loggedIn) {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 16px max(16px, env(safe-area-inset-left))",
        }}
      >
        <Login onLoggedIn={() => setLoggedIn(true)} />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <PlanProvider>
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            paddingBottom: "calc(72px + env(safe-area-inset-bottom))",
          }}
        >
          <header
            style={{
              padding:
                "max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h1 style={{ margin: 0, fontSize: 22 }}>Complete Fitness Coach</h1>
            <button
              onClick={() => {
                auth.clearToken();
                setLoggedIn(false);
              }}
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 13 }}
            >
              Log out
            </button>
          </header>

          <main style={{ padding: "8px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left))" }}>
            <Routes>
              <Route path="/" element={<Calendar />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/log" element={<LogWorkout />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>

          <nav
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "space-around",
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              padding: "10px max(0px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(0px, env(safe-area-inset-left))",
            }}
          >
            <NavTab to="/" label="Calendar" />
            <NavTab to="/plan" label="Plan" />
            <NavTab to="/workout" label="Workout" />
            <NavTab to="/log" label="Log" />
            <NavTab to="/history" label="History" />
            <NavTab to="/settings" label="Settings" />
          </nav>
        </div>
      </PlanProvider>
    </BrowserRouter>
  );
}

function NavTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        color: isActive ? "var(--accent)" : "var(--text-dim)",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 600,
      })}
    >
      {label}
    </NavLink>
  );
}
