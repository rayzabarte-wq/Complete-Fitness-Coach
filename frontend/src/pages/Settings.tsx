import { ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, auth, Profile, SessionType } from "../lib/api.js";
import GymsSection from "../components/GymsSection.js";
import Collapsible from "../components/Collapsible.js";
import { APP_VERSION, ServerStatus, describeVersions, getServerStatus, versionsDiffer } from "../lib/diagnose.js";
import { SESSION_TYPE_TREE } from "../lib/sessionTypes.js";
import { ConsentSettings } from "../components/Consent.js";

// Settings lives behind the gear icon rather than a tab: it's a
// set-and-forget place, not somewhere you go daily.
export default function Settings({ onLoggedOut }: { onLoggedOut: () => void }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api.getProfile().then(setProfile);
  }, [version]);
  const reload = () => setVersion((v) => v + 1);
  const [server, setServer] = useState<ServerStatus | null>(null);
  useEffect(() => {
    getServerStatus().then(setServer);
  }, []);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="button-quiet" style={{ marginBottom: 10 }}>
        ‹ Back
      </button>
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Settings</h2>
      {profile && (
        <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
          Signed in as {profile.email}
        </p>
      )}

      {server && versionsDiffer(server) && (
        <div className="card" style={{ borderLeft: "4px solid var(--accent)" }}>
          <strong style={{ color: "var(--navy)" }}>The app and the server are on different versions</strong>
          <p className="text-dim" style={{ fontSize: 13, margin: "6px 0 0" }}>
            Some features won't work until both have been redeployed to the latest version. {describeVersions(server)}
          </p>
        </div>
      )}

      <Collapsible title="Training">{profile && <TrainingSection profile={profile} onSaved={reload} />}</Collapsible>

      <Collapsible title="Profile">{profile && <ProfileSection profile={profile} onSaved={reload} />}</Collapsible>

      <Collapsible title="Privacy & consent" id="privacy">
        <div className="card">
          <ConsentSettings onChanged={reload} />
        </div>
      </Collapsible>

      <Collapsible title="Data import" id="import">
        {profile && <DataImportSection profile={profile} onChanged={reload} />}
      </Collapsible>

      <Collapsible title="Connections">
        <OutlookSection />
        <StravaSection />
      </Collapsible>

      <Collapsible title="Gyms">
        <GymsSection />
      </Collapsible>

      <Collapsible title="Workout types">
        <WorkoutTypesSection />
      </Collapsible>

      <Collapsible title="Planning">
        <div className="card">
          <strong>3-month training plan</strong>
          <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
            The multi-sport quarterly planner (priorities, approaches, weekly framework). The strength auto-fill on the Calendar works without it.
          </p>
          <Link to="/plan" className="button-secondary" style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 8 }}>
            Open the 3-month plan
          </Link>
        </div>
      </Collapsible>

      <Collapsible title="Your data">
        <YourDataSection />
      </Collapsible>

      <button
        className="button-secondary"
        style={{ width: "100%", marginTop: 16 }}
        onClick={() => {
          auth.clearToken();
          onLoggedOut();
        }}
      >
        Log out
      </button>

      <p className="text-dim" style={{ fontSize: 11, textAlign: "center", marginTop: 12 }}>
        {server ? describeVersions(server) : `App version ${APP_VERSION}.`}
      </p>
    </div>
  );
}

function TrainingSection({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [days, setDays] = useState(profile.trainingDaysPerWeek);
  const [saving, setSaving] = useState(false);
  const option = profile.splitOptions.find((o) => o.days === days);

  async function save(n: number) {
    setDays(n);
    setSaving(true);
    try {
      await api.updateProfile({ trainingDaysPerWeek: n });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <strong>Strength days per week</strong>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }} role="radiogroup" aria-label="Strength days per week">
        {profile.splitOptions.map((o) => (
          <button
            key={o.days}
            role="radio"
            aria-checked={days === o.days}
            onClick={() => save(o.days)}
            disabled={saving}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: days === o.days ? "none" : "1px solid var(--border)",
              background: days === o.days ? "var(--accent)" : "var(--surface)",
              color: days === o.days ? "var(--on-accent)" : "var(--text)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {o.days}
          </button>
        ))}
      </div>
      {option && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10, color: "var(--navy)" }}>Split: {option.split.label}</div>
          <p className="text-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
            {option.split.explanation}
          </p>
        </>
      )}
    </div>
  );
}

function ProfileSection({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [birthYear, setBirthYear] = useState(profile.birthYear ? String(profile.birthYear) : "");
  const [sex, setSex] = useState<"" | "MALE" | "FEMALE">(profile.sex ?? "");
  const [height, setHeight] = useState(profile.heightCm ? String(profile.heightCm) : "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setMessage(null);
    try {
      await api.updateProfile({
        birthYear: birthYear ? Number(birthYear) : null,
        sex: sex || null,
        heightCm: height ? Number(height) : null,
      });
      setMessage("Saved.");
      onSaved();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't save");
    }
  }

  return (
    <div className="card">
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        Used to compare your numbers with published healthy ranges for your age and sex. Needs "Store my profile" switched on below.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <label style={{ fontSize: 12 }}>
          Birth year
          <input inputMode="numeric" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, ""))} style={{ width: "100%", padding: 6 }} />
        </label>
        <label style={{ fontSize: 12 }}>
          Sex
          <select value={sex} onChange={(e) => setSex(e.target.value as "" | "MALE" | "FEMALE")} style={{ width: "100%", padding: 6 }}>
            <option value="">—</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          Height (cm)
          <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} style={{ width: "100%", padding: 6 }} />
        </label>
      </div>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {message && <p className="text-dim" style={{ fontSize: 13 }}>{message}</p>}
      <button className="button-primary" onClick={save} style={{ width: "100%", marginTop: 8 }}>
        Save profile
      </button>
    </div>
  );
}

function DataImportSection({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const r = await api.createIngestToken();
      setToken(r.token);
      onChanged();
    } catch (e: any) {
      setError(typeof e.message === "string" ? e.message : "Couldn't create a token");
    }
  }

  async function revoke() {
    await api.revokeIngestToken();
    setToken(null);
    onChanged();
  }

  const code = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, background: "var(--surface-2)", padding: "2px 4px", borderRadius: 4, wordBreak: "break-all" as const };

  return (
    <div className="card">
      <strong>Upload token</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        A personal key that lets an iPhone Shortcut (Apple Health steps) and the Renpho sync script send data to the app without your password. Keep it private. You can revoke it at any time.
      </p>
      {token ? (
        <div style={{ padding: 8, border: "1px solid var(--accent)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 4 }}>Copy this now. It won't be shown again.</div>
          <div style={code}>{token}</div>
        </div>
      ) : (
        <div className="text-dim" style={{ fontSize: 13 }}>{profile.hasIngestToken ? "A token is active." : "No token yet."}</div>
      )}
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="button-primary" onClick={create} style={{ flex: 1 }}>
          {profile.hasIngestToken ? "Replace token" : "Create token"}
        </button>
        {profile.hasIngestToken && (
          <button className="button-secondary" onClick={revoke} style={{ flex: 1 }}>
            Revoke
          </button>
        )}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>Apple Health steps (iPhone Shortcut)</summary>
        <ol style={{ fontSize: 13, paddingLeft: 18, lineHeight: 1.5 }}>
          <li>Open the Shortcuts app and create a new shortcut.</li>
          <li>
            Add <em>Find Health Samples</em>: type Steps, start date is today, group by Day.
          </li>
          <li>
            Add <em>Calculate Statistics</em> (Sum) on the samples.
          </li>
          <li>
            Add <em>Get Contents of URL</em>: <span style={code}>{api.apiUrl}/ingest/steps</span>, method POST, header <span style={code}>Authorization: Bearer YOUR_TOKEN</span>, JSON body{" "}
            <span style={code}>{'{"date": "YYYY-MM-DD", "steps": <Sum>}'}</span> (use <em>Format Date</em> with format yyyy-MM-dd for the date).
          </li>
          <li>In Automation, run it daily (for example at 23:30) with "Run immediately" switched on.</li>
        </ol>
        <p className="text-dim" style={{ fontSize: 12 }}>Your Garmin's steps reach Apple Health through Garmin Connect's Apple Health sharing, so this picks those up too.</p>
      </details>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>Renpho body scans</summary>
        <p style={{ fontSize: 13 }}>
          Run <span style={code}>tools/renpho_sync.py</span> from the project folder on your computer. It signs in to Renpho with your Renpho login (kept on your machine, never sent to this app) and uploads new scans here. See SETUP.md, "Renpho sync", for the one-time setup.
        </p>
        <p className="text-dim" style={{ fontSize: 12 }}>
          Renpho has no official API, so the script uses an unofficial one, which is fine for your own account. For a public version of the app, the plan is to use Apple Health (Renpho can write scans there) plus manual entry instead.
        </p>
      </details>
    </div>
  );
}

function OutlookSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Pick up the ?outlook=connected / ?outlook=error redirect from the
    // OAuth callback, then clean the URL so refreshing doesn't re-show it.
    const params = new URLSearchParams(window.location.search);
    const outlookResult = params.get("outlook");
    if (outlookResult === "connected") {
      setMessage("Outlook connected.");
    } else if (outlookResult === "error") {
      setMessage(`Couldn't connect Outlook: ${params.get("message") ?? "unknown error"}`);
    }
    if (outlookResult) {
      window.history.replaceState({}, "", "/settings");
    }

    api
      .getOutlookStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  async function handleDisconnect() {
    setLoading(true);
    try {
      await api.disconnectOutlook();
      setConnected(false);
      setMessage(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <strong>Outlook calendar sync</strong>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
          When connected, every workout you log creates a calendar event in
          Outlook — which syncs automatically to the Outlook app on iOS and
          macOS. If you leave feedback on a plan afterward, the event
          updates to include it.
        </p>

        {message && (
          <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
            {message}
          </p>
        )}

        {connected === null ? (
          <p className="text-dim" style={{ fontSize: 13, marginTop: 10 }}>
            Checking status...
          </p>
        ) : connected ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "var(--accent)", fontWeight: 600, marginBottom: 8 }}>✓ Connected</div>
            <button className="button-primary" onClick={handleDisconnect} disabled={loading} style={{ width: "100%" }}>
              {loading ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <a
            href={api.outlookConnectUrl()}
            className="button-primary"
            style={{
              display: "block",
              textAlign: "center",
              textDecoration: "none",
              marginTop: 10,
            }}
          >
            Connect Outlook
          </a>
        )}
      </div>
    </div>
  );
}

function StravaSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stravaResult = params.get("strava");
    if (stravaResult === "connected") {
      setMessage("Strava connected.");
    } else if (stravaResult === "error") {
      setMessage(`Couldn't connect Strava: ${params.get("message") ?? "unknown error"}`);
    }
    if (stravaResult) {
      window.history.replaceState({}, "", "/settings");
    }

    api
      .getStravaStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  async function handleDisconnect() {
    setLoading(true);
    try {
      await api.disconnectStrava();
      setConnected(false);
      setMessage(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <strong>Strava sync</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        When connected, cardio and golf sessions on the Calendar tab can
        pull their actual duration straight from a matching Strava
        activity instead of typing it in by hand.
      </p>

      {message && (
        <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
          {message}
        </p>
      )}

      {connected === null ? (
        <p className="text-dim" style={{ fontSize: 13, marginTop: 10 }}>
          Checking status...
        </p>
      ) : connected ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: "var(--accent)", fontWeight: 600, marginBottom: 8 }}>✓ Connected</div>
          <button className="button-primary" onClick={handleDisconnect} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <a
          href={api.stravaConnectUrl()}
          className="button-primary"
          style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 10 }}
        >
          Connect Strava
        </a>
      )}
    </div>
  );
}

function WorkoutTypesSection() {
  const [visible, setVisible] = useState<SessionType[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getPreferences()
      .then((p) => setVisible(p.visibleSessionTypes))
      .catch(() => setVisible(["STRENGTH"]));
  }, []);

  async function save(next: SessionType[]) {
    setVisible(next);
    setSaving(true);
    try {
      await api.updatePreferences(next);
    } finally {
      setSaving(false);
    }
  }

  function toggleLeaf(type: SessionType) {
    if (!visible) return;
    const next = visible.includes(type) ? visible.filter((t) => t !== type) : [...visible, type];
    save(next);
  }

  function toggleGroup(children: SessionType[], allChecked: boolean) {
    if (!visible) return;
    const next = allChecked
      ? visible.filter((t) => !children.includes(t))
      : [...new Set([...visible, ...children])];
    save(next);
  }

  return (
    <div className="card">
      <strong>Calendar workout types</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        The app is strength-only for now: everything else is switched off
        but kept. Tick a type to bring it back into the Calendar and the Log
        tab. Unticking hides it without deleting anything already scheduled.
      </p>

      {!visible ? (
        <p className="text-dim" style={{ fontSize: 13, marginTop: 10 }}>
          Loading...
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          {SESSION_TYPE_TREE.map((cat) =>
            cat.children ? (
              <GroupRow
                key={cat.label}
                label={cat.label}
                children_={cat.children}
                visible={visible}
                onToggleGroup={toggleGroup}
                onToggleLeaf={toggleLeaf}
              />
            ) : (
              <LeafRow key={cat.type} label={cat.label} type={cat.type} checked={visible.includes(cat.type)} onToggle={toggleLeaf} />
            )
          )}
        </div>
      )}
      {saving && (
        <p className="text-dim" style={{ fontSize: 11, marginTop: 6 }}>
          Saving...
        </p>
      )}
    </div>
  );
}

function LeafRow({
  label,
  type,
  checked,
  onToggle,
  indent = false,
}: {
  label: string;
  type: SessionType;
  checked: boolean;
  onToggle: (type: SessionType) => void;
  indent?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        paddingLeft: indent ? 24 : 0,
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      <input type="checkbox" checked={checked} onChange={() => onToggle(type)} style={{ width: 18, height: 18 }} />
      {label}
    </label>
  );
}

function GroupRow({
  label,
  children_,
  visible,
  onToggleGroup,
  onToggleLeaf,
}: {
  label: string;
  children_: { type: SessionType; label: string }[];
  visible: SessionType[];
  onToggleGroup: (children: SessionType[], allChecked: boolean) => void;
  onToggleLeaf: (type: SessionType) => void;
}) {
  const childTypes = children_.map((c) => c.type);
  const checkedCount = childTypes.filter((t) => visible.includes(t)).length;
  const allChecked = checkedCount === childTypes.length;
  const someChecked = checkedCount > 0 && !allChecked;

  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={() => onToggleGroup(childTypes, allChecked)}
          style={{ width: 18, height: 18 }}
        />
        {label}
      </label>
      {children_.map((c) => (
        <LeafRow key={c.type} label={c.label} type={c.type} checked={visible.includes(c.type)} onToggle={onToggleLeaf} indent />
      ))}
    </div>
  );
}
function YourDataSection() {
  const [downloading, setDownloading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const data = await api.exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card">
      <strong>Your data</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        Download everything this account has stored (workouts, scans, goals,
        steps, profile, consent history and scheduled sessions) as a JSON
        file. Account deletion is permanent and removes all of it immediately.
      </p>

      <button
        className="button-primary"
        onClick={handleDownload}
        disabled={downloading}
        style={{ width: "100%", marginTop: 10 }}
      >
        {downloading ? "Preparing..." : "Download my data"}
      </button>

      {!confirmingDelete ? (
        <button
          onClick={() => setConfirmingDelete(true)}
          style={{
            width: "100%",
            marginTop: 8,
            padding: 10,
            background: "none",
            border: "1px solid var(--danger)",
            borderRadius: 8,
            color: "var(--danger)",
            cursor: "pointer",
          }}
        >
          Delete my account
        </button>
      ) : (
        <DeleteAccountConfirm onCancel={() => setConfirmingDelete(false)} />
      )}
    </div>
  );
}

function DeleteAccountConfirm({ onCancel }: { onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount(password, needsCode ? code : undefined);
      // Account and all its data are gone server-side — clear the local
      // session and send back to the login screen.
      auth.clearToken();
      window.location.href = "/";
    } catch (err: any) {
      if (err.requires2fa) {
        setNeedsCode(true);
      } else {
        setError(err.message ?? "Failed to delete account");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 10, border: "1px solid var(--danger)", borderRadius: 8 }}>
      <p style={{ fontSize: 13, color: "var(--danger)" }}>
        This permanently deletes your account and all your data. This can't be undone.
      </p>
      <input
        type="password"
        placeholder="Confirm your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 8, marginTop: 6 }}
      />
      {needsCode && (
        <input
          placeholder="6-digit 2FA code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ width: "100%", padding: 8, marginTop: 6 }}
        />
      )}
      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "none", background: "var(--border)", color: "var(--text-dim)", cursor: "pointer" }}
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting || !password}
          style={{ flex: 1, padding: 8, borderRadius: 6, border: "none", background: "var(--danger)", color: "#fff", cursor: "pointer" }}
        >
          {deleting ? "Deleting..." : "Permanently delete"}
        </button>
      </div>
    </div>
  );
}
