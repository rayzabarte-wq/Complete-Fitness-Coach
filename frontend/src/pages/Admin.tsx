import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AdminLogEntry, AdminUsage, AdminMessage, AdminUser, AdminUsersResponse } from "../lib/api.js";
import Collapsible from "../components/Collapsible.js";

// The owner's area: who has signed up, suspend or delete accounts, and send
// in-app messages. Only reachable for emails listed in ADMIN_EMAILS (server
// side); anyone else is shown nothing.
export default function Admin() {
  const [state, setState] = useState<"loading" | "denied" | "needs2fa" | "ok">("loading");
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [log, setLog] = useState<AdminLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [users, msgs, entries] = await Promise.all([api.adminUsers(), api.adminMessages(), api.adminLog()]);
      setData(users);
      setMessages(msgs);
      setLog(entries);
      setState("ok");
    } catch (e: any) {
      if (e?.status === 403) setState("needs2fa");
      else if (e?.status === 404) setState("denied");
      else {
        setError(e?.message ?? "Couldn't load the admin area.");
        setState("ok");
      }
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (state === "loading") return <p className="text-dim">Loading…</p>;
  if (state === "denied") return <p className="text-dim">There's nothing here.</p>;
  if (state === "needs2fa") {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>Turn on 2FA in Settings before using the admin area. It holds other people's account details.</p>
        <Link to="/settings" className="button-secondary" style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}>
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 10px" }}>Admin</h2>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {data && <Summary s={data.summary} />}

      <Collapsible title="Users" hint={data ? `${data.summary.total}` : undefined} defaultOpen rememberAs="admin-users">
        {data && <UsersList users={data.users} onChanged={reload} />}
      </Collapsible>

      <Collapsible title="Messages" rememberAs="admin-messages">
        <MessagesSection users={data?.users ?? []} messages={messages} onChanged={reload} />
      </Collapsible>

      <Collapsible title="Feature use" rememberAs="admin-usage">
        <UsageSection />
      </Collapsible>

      <Collapsible title="Activity log" rememberAs="admin-log">
        {log.length === 0 ? (
          <p className="text-dim" style={{ fontSize: 13 }}>Nothing yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
            {log.map((l) => (
              <li key={l.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <b>{l.action}</b>
                {l.targetEmail ? ` · ${l.targetEmail}` : ""}
                {l.detail ? ` · ${l.detail}` : ""}
                <div className="text-dim" style={{ fontSize: 11 }}>
                  {l.adminEmail} · {new Date(l.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      <p className="text-dim" style={{ fontSize: 12, marginTop: 14 }}>
        Only account basics and counts are shown here. Training, body, nutrition and consent data aren't visible to admins.
      </p>
    </div>
  );
}

function Summary({ s }: { s: AdminUsersResponse["summary"] }) {
  const items: [string, number][] = [
    ["Users", s.total],
    ["New (7 days)", s.newLast7Days],
    ["Active (7 days)", s.activeLast7Days],
    ["Suspended", s.suspended],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
      {items.map(([label, n]) => (
        <div key={label} className="card" style={{ padding: 10, textAlign: "center" }}>
          <div style={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, fontSize: 20, color: "var(--navy)" }}>{n}</div>
          <div className="text-dim" style={{ fontSize: 11 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "never";
}

function UsersList({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = users.filter((u) => u.email.toLowerCase().includes(filter.trim().toLowerCase()));

  async function resetTwoFactor(u: AdminUser) {
    if (!window.confirm(`Turn off 2FA for ${u.email}? They can then use "Forgot password" on the login screen and log in without a code, and turn 2FA back on in Settings. Their trusted devices are signed out.`)) return;
    setBusy(u.id);
    setError(null);
    try {
      await api.adminReset2fa(u.id);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend(u: AdminUser) {
    if (!u.suspendedAt && !window.confirm(`Suspend ${u.email}? They'll be logged out and can't log back in until reinstated. Their data is kept.`)) return;
    setBusy(u.id);
    setError(null);
    try {
      if (u.suspendedAt) await api.adminReinstate(u.id);
      else await api.adminSuspend(u.id);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <input
        type="search"
        placeholder="Search by email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: 10, margin: "8px 0" }}
      />
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {shown.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>No matching users.</p>}
      {shown.map((u) => (
        <div key={u.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{u.email}</div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {u.isAdmin && <span className="chip chip-accent">Admin</span>}
              {u.suspendedAt && <span className="chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>Suspended</span>}
            </div>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            Joined {fmtDate(u.createdAt)} · Last seen {fmtDate(u.lastSeenAt)}
            <br />
            {u.sessionCount} workout{u.sessionCount === 1 ? "" : "s"} logged
            {u.lastSessionAt ? ` (last ${fmtDate(u.lastSessionAt)})` : ""} · 2FA {u.totpEnabled ? "on" : "off"}
          </div>
          {!u.isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="button-secondary" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busy === u.id} onClick={() => toggleSuspend(u)}>
                {u.suspendedAt ? "Reinstate" : "Suspend"}
              </button>
              {u.totpEnabled && (
                <button className="button-secondary" style={{ padding: "6px 12px", fontSize: 13 }} disabled={busy === u.id} onClick={() => resetTwoFactor(u)}>
                  Turn off 2FA
                </button>
              )}
              <button
                className="button-secondary"
                style={{ padding: "6px 12px", fontSize: 13, color: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={() => setDeleting(u)}
              >
                Delete…
              </button>
            </div>
          )}
          {deleting?.id === u.id && (
            <DeleteConfirm
              user={u}
              onCancel={() => setDeleting(null)}
              onDeleted={() => {
                setDeleting(null);
                onChanged();
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DeleteConfirm({ user, onCancel, onDeleted }: { user: AdminUser; onCancel: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteUser(user.id, typed);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} style={{ marginTop: 10, padding: 10, background: "var(--danger-soft)", borderRadius: 10 }}>
      <div style={{ fontSize: 13 }}>
        This permanently deletes the account and all its data. It can't be undone. Type <b>{user.email}</b> to confirm.
      </div>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        aria-label="Type the email to confirm"
        style={{ width: "100%", boxSizing: "border-box", padding: 10, marginTop: 8 }}
      />
      {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="submit" className="button-secondary" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} disabled={busy || typed.trim().toLowerCase() !== user.email.toLowerCase()}>
          {busy ? "Deleting…" : "Delete account"}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MessagesSection({ users, messages, onChanged }: { users: AdminUser[]; messages: AdminMessage[]; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState("");
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const who = target ? users.find((u) => u.id === target)?.email : "everyone";
    if (!window.confirm(`Send this message to ${who}?`)) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api.adminSendMessage({ title, body, targetUserId: target || undefined, expiresInDays: days });
      setTitle("");
      setBody("");
      setSent(true);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    if (!window.confirm("Withdraw this message? People who haven't dismissed it will stop seeing it.")) return;
    try {
      await api.adminWithdrawMessage(id);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <form onSubmit={send} className="card" style={{ margin: "8px 0 12px", display: "grid", gap: 8 }}>
        <label style={{ fontSize: 13 }}>
          To
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4 }}>
            <option value="">Everyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={80} style={{ padding: 10 }} aria-label="Title" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message (shown on their Calendar until dismissed)" maxLength={1000} rows={4} style={{ padding: 10 }} aria-label="Message" />
        <label style={{ fontSize: 13 }}>
          Stop showing after
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: "100%", padding: 10, marginTop: 4 }}>
            <option value={3}>3 days</option>
            <option value={14}>2 weeks</option>
            <option value={30}>30 days</option>
            <option value={0}>Never (until dismissed)</option>
          </select>
        </label>
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        {sent && <div style={{ color: "var(--accent)", fontSize: 13 }}>Sent. People will see it next time they open the app.</div>}
        <button type="submit" className="button-primary" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Sending…" : "Send message"}
        </button>
      </form>

      <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Recent messages</h3>
      {messages.length === 0 && <p className="text-dim" style={{ fontSize: 13 }}>None sent yet.</p>}
      {messages.map((m) => (
        <div key={m.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{m.title}</div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "4px 0" }}>{m.body}</div>
          <div className="text-dim" style={{ fontSize: 12 }}>
            To {m.everyone ? "everyone" : (m.targetEmail ?? "a deleted user")} · {fmtDate(m.createdAt)}
            {m.expiresAt ? ` · until ${fmtDate(m.expiresAt)}` : ""} · dismissed by {m.dismissedBy}
          </div>
          <button className="button-quiet" style={{ marginTop: 6 }} onClick={() => withdraw(m.id)}>
            Withdraw
          </button>
        </div>
      ))}
    </div>
  );
}

const FEATURE_LABELS: Record<string, string> = {
  page_calendar: "Calendar screen",
  page_day: "Day view",
  page_log: "Log screen",
  page_progress: "Progress screen",
  page_settings: "Settings screen",
  page_plan: "Training plan screen",
  log_steps_tab: "Log: Steps tab",
  log_nutrition_tab: "Log: Nutrition tab",
  log_other_sport_tab: "Log: other sport tabs",
  workout_generated: "Workout built",
  workout_saved: "Workout saved",
  gym_switched: "Gym switched",
  gym_preset_applied: "Gym preset applied",
  custom_equipment_added: "Custom equipment added",
  custom_exercise_created: "Custom exercise created",
  steps_saved: "Steps entered by hand",
  nutrition_saved: "Nutrition entered by hand",
  body_scan_added: "Body scan added",
  goal_created: "Body goal created",
  message_dismissed: "Message dismissed",
  golf_round_logged: "Golf round logged",
  golf_goal_set: "Golf rounds goal set",
  ambitions_saved: "Ambitions written",
  sport_goal_saved: "Sport goal written",
  availability_saved: "Weekly time saved",
  golf_week_proposed: "Golf week proposed",
  golf_week_added: "Golf week added to calendar",
  run_week_planned: "Running week planned",
  run_days_saved: "Runs per week saved",
  week_planned_from_plan: "Week planned from training plan",
  plan_assessed: "Plan frequencies assessed",
  onboarding_completed: "Welcome journey finished",
  onboarding_skipped: "Welcome journey skipped",
  golf_profile_saved: "Golf handicap / shaping saved",
  golf_clubs_edited: "Golf bag edited",
  app_install_clicked: "Install app tapped",
};

// Totals per feature over the last 30 days. Never shows who used what.
function UsageSection() {
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.adminUsage().then(setUsage).catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>;
  if (!usage) return <p className="text-dim" style={{ fontSize: 13 }}>Loading…</p>;

  const features = [...usage.features].sort((a, b) => b.users30 - a.users30 || b.events30 - a.events30);
  const max = Math.max(1, ...features.map((f) => f.users30));
  return (
    <div>
      <p className="text-dim" style={{ fontSize: 12, margin: "8px 0" }}>
        {usage.optedInUsers} of {usage.totalUsers} users have agreed to usage statistics, and only their activity is counted. Last 30 days.
      </p>
      {features.map((f) => (
        <div key={f.name} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 8 }}>
            <span>{FEATURE_LABELS[f.name] ?? f.name}</span>
            <span className="text-dim" style={{ whiteSpace: "nowrap" }}>
              {f.users30} {f.users30 === 1 ? "person" : "people"} · {f.events30} uses · {f.users7} this week
            </span>
          </div>
          <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, marginTop: 3 }}>
            <div style={{ height: 6, width: `${(f.users30 / max) * 100}%`, background: "var(--accent)", borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
