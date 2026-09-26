import { useEffect, useState } from "react";
import { api, auth, SessionType } from "../lib/api.js";
import { SESSION_TYPE_TREE, ALL_SESSION_TYPES } from "../lib/sessionTypes.js";

export default function Settings() {
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

      <StravaSection />

      <WorkoutTypesSection />

      <YourDataSection />
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
      .catch(() => setVisible(ALL_SESSION_TYPES));
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
    <div className="card" style={{ marginTop: 12 }}>
      <strong>Calendar workout types</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        Choose which workout types appear in the Calendar tab — both in the
        "schedule a session" picker and in the day view itself. Unchecking
        a type hides it from the calendar without deleting anything already
        scheduled.
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
    <div className="card" style={{ marginTop: 12 }}>
      <strong>Your data</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        Download everything this account has stored — workouts, recommendations,
        scheduled sessions, and nutrition logs — as a JSON file. Account
        deletion is permanent and removes all of it immediately.
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
