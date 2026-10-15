import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import Log from "./pages/Log.js";
import Login from "./pages/Login.js";
import Settings from "./pages/Settings.js";
import Calendar, { DayDetail } from "./pages/Calendar.js";
import Progress from "./pages/Progress.js";
import Plan from "./pages/Plan.js";
import { api, auth } from "./lib/api.js";
import { PlanProvider } from "./lib/planContext.js";
import { ConsentOnboarding } from "./components/Consent.js";

// Information architecture: three tabs for the things used day to day —
// Calendar (plan + what happened), Log (record it), Progress (goals and
// trends) — with Settings behind a gear icon in the header.

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => {
    // Opening a password reset link always shows the reset page, even on a
    // device that's still logged in (resetting signs every session out).
    if (new URLSearchParams(window.location.search).has("reset")) auth.clearToken();
    return !!auth.getToken();
  });
  const [consentReviewed, setConsentReviewed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    api
      .getProfile()
      .then((p) => setConsentReviewed(p.consentReviewed))
      .catch(() => {
        // An expired session clears the token in api.ts — fall back to login.
        if (!auth.getToken()) setLoggedIn(false);
        else setConsentReviewed(true);
      });
  }, [loggedIn]);

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

  if (consentReviewed === null) {
    return <p className="text-dim" style={{ textAlign: "center", marginTop: 80 }}>Loading…</p>;
  }

  // First run (or first time after this update): the consent step comes
  // before anything that could collect personal data.
  if (!consentReviewed) {
    return <ConsentOnboarding onDone={() => setConsentReviewed(true)} />;
  }

  return (
    <BrowserRouter>
      <PlanProvider>
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            paddingBottom: "calc(76px + env(safe-area-inset-bottom))",
          }}
        >
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              background: "var(--bar)",
              color: "var(--on-navy)",
              padding:
                "max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h1 style={{ margin: 0, fontSize: 19, color: "var(--on-navy)", letterSpacing: "-0.01em" }}>
              Complete Fitness Coach
            </h1>
            <Link to="/settings" aria-label="Settings" style={{ color: "var(--on-navy)", display: "flex", padding: 4 }}>
              <GearIcon />
            </Link>
          </header>

          <main style={{ padding: "14px max(16px, env(safe-area-inset-right)) 8px max(16px, env(safe-area-inset-left))" }}>
            <Routes>
              <Route path="/" element={<Calendar />} />
              <Route path="/day/:date" element={<DayDetail />} />
              <Route path="/log" element={<Log />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/settings" element={<Settings onLoggedOut={() => setLoggedIn(false)} />} />
              <Route path="/plan" element={<Plan />} />
            </Routes>
          </main>

          <nav
            aria-label="Main"
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "space-around",
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              padding: "8px max(0px, env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(0px, env(safe-area-inset-left))",
            }}
          >
            <NavTab to="/" label="Calendar" end />
            <NavTab to="/log" label="Log" />
            <NavTab to="/progress" label="Progress" />
          </nav>
        </div>
      </PlanProvider>
    </BrowserRouter>
  );
}

function NavTab({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        color: isActive ? "var(--accent)" : "var(--text-dim)",
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 700,
        padding: "6px 18px",
        borderTop: isActive ? "3px solid var(--sun)" : "3px solid transparent",
        marginTop: -9,
        paddingTop: 9,
      })}
    >
      {label}
    </NavLink>
  );
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
