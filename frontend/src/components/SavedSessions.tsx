import { useEffect, useState } from "react";
import { api, SavedSession, SavedSessionInput } from "../lib/api.js";
import { parseExerciseLines, drillsToLines, MAX_EXERCISES } from "../lib/exerciseLines.js";

// The library of saved rehab / own sessions. Type a physio's sheet in once,
// then add it to any day later from the Calendar. Here they can be edited,
// renamed, saved as a new session under a different name, copied or deleted.
// Adding one to the calendar copies it, so changing it here never alters
// sessions already planned.

const toInput = (name: string, minutes: string, notes: string, exerciseText: string): SavedSessionInput => ({
  name: name.trim(),
  estimatedMinutes: minutes ? Number(minutes) : null,
  notes: notes.trim() || null,
  exercises: parseExerciseLines(exerciseText).map((d) => ({ name: d.name, detail: d.detail })),
});

/** Save what's typed in a session form to the library, without leaving the form. */
export function SaveToLibraryBox({ defaultName, getDraft }: { defaultName: string; getDraft: () => Omit<SavedSessionInput, "name"> }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [clash, setClash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = name || defaultName;

  async function save(overwrite: boolean) {
    const finalName = shown.trim();
    if (!finalName) return setError("Give it a name first.");
    const draft = getDraft();
    if (draft.exercises.length === 0) return setError("Add at least one exercise first.");
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createSavedSession({ ...draft, name: finalName, overwrite });
      setClash(false);
      setMsg(overwrite ? `Replaced “${finalName}” in your library.` : `Saved “${finalName}” to your library.`);
    } catch (e: any) {
      if (e.status === 409) setClash(true);
      else setError(e.message ?? "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, padding: 10, border: "1px dashed var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Keep this for next time</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input
          value={shown}
          onChange={(e) => {
            setName(e.target.value);
            setClash(false);
            setMsg(null);
          }}
          maxLength={80}
          aria-label="Name in my library"
          placeholder="Name in my library"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="button" className="button-secondary" disabled={busy} onClick={() => save(false)}>
          {busy ? "Saving…" : "Save to library"}
        </button>
      </div>
      {clash && (
        <p style={{ fontSize: 12, margin: "6px 0 0" }}>
          “{shown.trim()}” is already in your library. Change the name to save this as a new session, or{" "}
          <button type="button" className="button-quiet" disabled={busy} onClick={() => save(true)}>
            replace the saved one
          </button>
        </p>
      )}
      {msg && <p style={{ color: "var(--good)", fontSize: 12, margin: "6px 0 0" }}>{msg}</p>}
      {error && <p style={{ color: "var(--danger)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}

type Editing = { id: string | null; original: string; name: string; minutes: string; notes: string; text: string };

export function SavedSessionsManager() {
  const [items, setItems] = useState<SavedSession[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listSavedSessions()
      .then(setItems)
      .catch((e) => setError(e.message ?? "Couldn't load your library"));
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const startNew = () => setEditing({ id: null, original: "", name: "", minutes: "30", notes: "", text: "" });
  const startEdit = (s: SavedSession) =>
    setEditing({ id: s.id, original: s.name, name: s.name, minutes: s.estimatedMinutes ? String(s.estimatedMinutes) : "", notes: s.notes ?? "", text: drillsToLines(s.exercises) });

  async function save() {
    if (!editing) return;
    const input = toInput(editing.name, editing.minutes, editing.notes, editing.text);
    if (!input.name) return setError("Give it a name.");
    const ok = await run(() => (editing.id ? api.updateSavedSession(editing.id, input) : api.createSavedSession(input)), `Saved “${input.name}”.`);
    if (ok) setEditing(null);
  }

  // Keeps the original as it was and adds the edited version under the new name.
  async function saveAsNew() {
    if (!editing) return;
    const input = toInput(editing.name, editing.minutes, editing.notes, editing.text);
    if (!input.name || input.name.toLowerCase() === editing.original.trim().toLowerCase()) {
      return setError("Change the name first, so this is saved as a new session and the original stays as it is.");
    }
    const ok = await run(() => api.createSavedSession(input), `Saved “${input.name}” as a new session. “${editing.original}” is unchanged.`);
    if (ok) setEditing(null);
  }

  return (
    <div>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>
        Rehab or your own sessions, such as a physio's exercise sheet, typed in once and added to any day from the Calendar. Adding one copies it, so changing it here never alters sessions already planned.
      </p>

      {editing ? (
        <div className="card" style={{ marginBottom: 10 }}>
          <strong>{editing.id ? "Edit session" : "New session"}</strong>
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            maxLength={80}
            placeholder="Name, e.g. Physio: right shoulder"
            aria-label="Name"
            style={{ width: "100%", padding: 8, marginTop: 8 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="number"
              min={1}
              value={editing.minutes}
              onChange={(e) => setEditing({ ...editing, minutes: e.target.value.replace(/[^0-9]/g, "") })}
              aria-label="Minutes"
              style={{ width: 70, padding: 8 }}
            />
            <span className="text-dim" style={{ fontSize: 13 }}>
              minutes
            </span>
          </div>
          <textarea
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            rows={7}
            aria-label="Exercises, one per line"
            placeholder={"Exercises, one per line, as on your sheet:\nBand external rotation — 3 x 15 each side\nWall slides — 2 x 10, slow"}
            style={{ width: "100%", padding: 8, marginTop: 8 }}
          />
          <p className="text-dim" style={{ fontSize: 12, margin: "4px 0 0" }}>
            Up to {MAX_EXERCISES} exercises. Text before a dash or colon is the exercise, the rest is how to do it.
          </p>
          <input
            value={editing.notes}
            onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
            maxLength={1000}
            placeholder="Notes (optional), e.g. stop if sharp pain"
            aria-label="Notes"
            style={{ width: "100%", padding: 8, marginTop: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="button-primary" disabled={busy} onClick={save}>
              {editing.id ? "Save changes" : "Save to library"}
            </button>
            {editing.id && (
              <button className="button-secondary" disabled={busy} onClick={saveAsNew}>
                Save as new session
              </button>
            )}
            <button className="button-quiet" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          {editing.id && (
            <p className="text-dim" style={{ fontSize: 12, margin: "6px 0 0" }}>
              “Save as new session” needs a different name; the original stays as it was.
            </p>
          )}
        </div>
      ) : (
        <button className="button-secondary" onClick={startNew} disabled={busy}>
          New session
        </button>
      )}

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
      {notice && <p style={{ color: "var(--good)", fontSize: 13 }}>{notice}</p>}

      {items === null && !error && <p className="text-dim">Loading…</p>}
      {items && items.length === 0 && !editing && (
        <p className="text-dim" style={{ fontSize: 13 }}>
          Nothing saved yet. Create one here, or add a rehab session on the Calendar and use “Save to library”.
        </p>
      )}
      {items?.map((s) => (
        <div key={s.id} className="card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.name}</strong>
            <span className="text-dim" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {s.exercises.length} exercise{s.exercises.length === 1 ? "" : "s"}
              {s.estimatedMinutes ? ` · ~${s.estimatedMinutes} min` : ""}
            </span>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>
            {s.timesUsed === 0 ? "Not used yet" : `Used ${s.timesUsed} time${s.timesUsed === 1 ? "" : "s"}`}
            {s.lastUsedAt ? ` · last ${new Date(s.lastUsedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="button-quiet" disabled={busy} onClick={() => startEdit(s)}>
              Edit
            </button>
            <button className="button-quiet" disabled={busy} onClick={() => run(() => api.duplicateSavedSession(s.id), `Copied “${s.name}”. Edit the copy to rename it.`)}>
              Copy
            </button>
            {confirmDelete === s.id ? (
              <>
                <button
                  className="button-quiet"
                  style={{ color: "var(--danger)" }}
                  disabled={busy}
                  onClick={async () => {
                    await run(() => api.deleteSavedSession(s.id), `Deleted “${s.name}”. Sessions already on your calendar are unchanged.`);
                    setConfirmDelete(null);
                  }}
                >
                  Yes, delete
                </button>
                <button className="button-quiet" onClick={() => setConfirmDelete(null)}>
                  Keep
                </button>
              </>
            ) : (
              <button className="button-quiet" style={{ color: "var(--danger)" }} disabled={busy} onClick={() => setConfirmDelete(s.id)}>
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
