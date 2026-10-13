import { useEffect, useState } from "react";
import { api, CustomExerciseInput, EquipmentInput, Exercise, Muscle } from "../lib/api.js";
import { Accessory, CustomEquipment, EquipmentSetting, GYM_KIND_LABEL, Gym, GymsResponse, buildWeights } from "../lib/equipment.js";

// Settings > Gyms. Three profiles (Home / Regular gym / Visiting), each with
// its own tick-boxes for equipment, accessories and the user's own custom
// equipment, plus the weights each piece can load. Custom exercises (built
// around custom equipment or not) are added at the bottom.

const inputStyle = {
  width: 70,
  padding: 6,
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 6,
} as const;

const wideInput = { ...inputStyle, width: "100%" } as const;

interface EquipmentDraft {
  equipment: EquipmentSetting["equipment"];
  kind: EquipmentSetting["kind"];
  label: string;
  enabled: boolean;
  minLb: string;
  maxLb: string;
  stepLb: string;
  custom: string; // comma-separated, parsed on save
  bandLevels: string[];
}

function toDraft(item: EquipmentSetting): EquipmentDraft {
  return {
    equipment: item.equipment,
    kind: item.kind,
    label: item.label,
    enabled: item.enabled,
    minLb: String(item.minLb),
    maxLb: String(item.maxLb),
    stepLb: String(item.stepLb),
    custom: item.customWeightsLb.join(", "),
    bandLevels: item.bandLevels,
  };
}

/** Parses "10, 12.5 15" into numbers. Returns the bad tokens too, so the form can say what it couldn't read. */
function parseCustomList(text: string): { values: number[]; bad: string[] } {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const values: number[] = [];
  const bad: string[] = [];
  for (const t of tokens) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) values.push(n);
    else bad.push(t);
  }
  return { values, bad };
}

function previewText(weights: number[]): string {
  if (weights.length === 0) return "No weights yet — check the min, max and step";
  const shown = weights.length <= 12 ? weights.join(", ") : `${weights.slice(0, 8).join(", ")} … ${weights.slice(-3).join(", ")}`;
  return `${weights.length} options: ${shown} lb`;
}

function CheckRow({ label, checked, onChange, bold }: { label: string; checked: boolean; onChange: (v: boolean) => void; bold?: boolean }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: bold ? 14 : 13, fontWeight: bold ? 600 : 400, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />
      {label}
    </label>
  );
}

export default function GymsSection() {
  const [data, setData] = useState<GymsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGyms()
      .then((res) => {
        setData(res);
        setSelectedId(res.activeGymId);
      })
      .catch(() => setError("Couldn't load your gyms"));
  }, []);

  if (!data) {
    return (
      <div className="card" style={{ marginTop: 12 }}>
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
          {error ?? "Loading..."}
        </p>
      </div>
    );
  }

  const gym = data.gyms.find((g) => g.id === selectedId) ?? data.gyms[0];

  return (
    <>
      <div className="card" style={{ marginTop: 12 }}>
        <strong>Gyms &amp; equipment</strong>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
          Tick what each place has. When you build a workout you choose which gym you're at, and it only includes exercises you can
          do there, with weights you can really load.
        </p>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {data.gyms.map((g) => (
            <button
              key={g.id}
              className={g.id === gym.id ? "button-primary" : "button-secondary"}
              onClick={() => setSelectedId(g.id)}
              style={{ flex: 1, fontSize: 13, padding: "8px 4px" }}
            >
              {GYM_KIND_LABEL[g.kind]}
            </button>
          ))}
        </div>
        <GymEditor key={gym.id} gym={gym} data={data} onSaved={setData} />
      </div>

      <CustomEquipmentCard data={data} onChanged={setData} />
      <CustomExercisesCard data={data} />
    </>
  );
}

function GymEditor({ gym, data, onSaved }: { gym: Gym; data: GymsResponse; onSaved: (r: GymsResponse) => void }) {
  const [name, setName] = useState(gym.name);
  const [drafts, setDrafts] = useState<EquipmentDraft[]>(gym.equipment.map(toDraft));
  const [accessories, setAccessories] = useState<Accessory[]>(gym.accessories);
  const [customIds, setCustomIds] = useState<string[]>(gym.customEquipmentIds);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(equipment: EquipmentDraft["equipment"], patch: Partial<EquipmentDraft>) {
    setMessage(null);
    setDrafts((cur) => cur.map((d) => (d.equipment === equipment ? { ...d, ...patch } : d)));
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    const items: EquipmentInput[] = [];
    for (const d of drafts) {
      if (!d.enabled) {
        items.push({ equipment: d.equipment, enabled: false });
        continue;
      }
      if (d.kind === "band") {
        items.push({ equipment: d.equipment, enabled: true, bandLevels: d.bandLevels });
        continue;
      }
      const { values, bad } = parseCustomList(d.custom);
      if (bad.length > 0) {
        setError(`${d.label}: couldn't read "${bad.join('", "')}" in the custom weights list — use numbers separated by commas.`);
        return;
      }
      items.push({
        equipment: d.equipment,
        enabled: true,
        minLb: d.kind === "bodyweight" ? 0 : Number(d.minLb),
        maxLb: Number(d.maxLb),
        stepLb: Number(d.stepLb),
        customWeightsLb: values,
      });
    }
    setSaving(true);
    try {
      const res = await api.saveGym(gym.id, { name: name.trim() || GYM_KIND_LABEL[gym.kind], accessories, customEquipmentIds: customIds, items });
      onSaved(res);
      setMessage("Saved. New workouts at this gym will use this.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this gym");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ fontSize: 13 }}>
        <span className="text-dim">Name</span>
        <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ ...wideInput, marginTop: 4 }} />
      </label>

      {drafts.map((d) => {
        const custom = parseCustomList(d.custom);
        const weights = buildWeights(d.kind, Number(d.minLb), Number(d.maxLb), Number(d.stepLb), custom.values);
        return (
          <div key={d.equipment} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <CheckRow bold label={d.label} checked={d.enabled} onChange={(v) => update(d.equipment, { enabled: v })} />

            {d.enabled && d.kind === "band" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, paddingLeft: 26 }}>
                {data.allBandLevels.map((lvl) => (
                  <CheckRow
                    key={lvl}
                    label={lvl}
                    checked={d.bandLevels.includes(lvl)}
                    onChange={(v) => update(d.equipment, { bandLevels: v ? [...d.bandLevels, lvl] : d.bandLevels.filter((l) => l !== lvl) })}
                  />
                ))}
              </div>
            )}

            {d.enabled && d.kind !== "band" && (
              <div style={{ marginTop: 8, paddingLeft: 26, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 13 }}>
                  {d.kind === "weighted" && (
                    <label>
                      Min{" "}
                      <input type="number" inputMode="decimal" value={d.minLb} onChange={(e) => update(d.equipment, { minLb: e.target.value })} style={inputStyle} />
                    </label>
                  )}
                  <label>
                    {d.kind === "bodyweight" ? "Max added" : "Max"}{" "}
                    <input type="number" inputMode="decimal" value={d.maxLb} onChange={(e) => update(d.equipment, { maxLb: e.target.value })} style={inputStyle} />
                  </label>
                  <label>
                    Step{" "}
                    <input type="number" inputMode="decimal" value={d.stepLb} onChange={(e) => update(d.equipment, { stepLb: e.target.value })} style={inputStyle} />
                  </label>
                  <span className="text-dim">lb</span>
                </div>
                <label style={{ fontSize: 13 }}>
                  <span className="text-dim">Or list exact weights (overrides the range), e.g. 10, 12.5, 15, 20, 30</span>
                  <input
                    type="text"
                    value={d.custom}
                    onChange={(e) => update(d.equipment, { custom: e.target.value })}
                    placeholder="Leave blank to use the range above"
                    style={{ ...wideInput, marginTop: 4 }}
                  />
                </label>
                {d.kind === "bodyweight" && (
                  <span className="text-dim" style={{ fontSize: 12 }}>
                    Added weight is optional load on top of bodyweight. Set Max to 0 if you don't add any.
                  </span>
                )}
                <span className="text-dim" style={{ fontSize: 12 }}>
                  {previewText(weights)}
                </span>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Also has</strong>
        {data.allAccessories.map((a) => (
          <CheckRow
            key={a.value}
            label={a.label}
            checked={accessories.includes(a.value)}
            onChange={(v) => {
              setMessage(null);
              setAccessories((cur) => (v ? [...cur, a.value] : cur.filter((x) => x !== a.value)));
            }}
          />
        ))}
        {data.customEquipment.map((c) => (
          <CheckRow
            key={c.id}
            label={`${c.name} (yours)`}
            checked={customIds.includes(c.id)}
            onChange={(v) => {
              setMessage(null);
              setCustomIds((cur) => (v ? [...cur, c.id] : cur.filter((x) => x !== c.id)));
            }}
          />
        ))}
        {data.customEquipment.length === 0 && (
          <span className="text-dim" style={{ fontSize: 12 }}>
            Got something else (a sled, landmine, cable stack)? Add it under "Your own equipment" below, then tick it here.
          </span>
        )}
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p>}
      {message && (
        <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
          {message}
        </p>
      )}
      <button className="button-primary" onClick={handleSave} disabled={saving} style={{ width: "100%" }}>
        {saving ? "Saving..." : `Save ${name.trim() || GYM_KIND_LABEL[gym.kind]}`}
      </button>
    </div>
  );
}

function CustomEquipmentCard({ data, onChanged }: { data: GymsResponse; onChanged: (r: GymsResponse) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<GymsResponse>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <strong>Your own equipment</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        Name anything that isn't in the lists above, then tick it on the gyms that have it. Add an exercise that uses it below and
        that exercise will only show up at those gyms.
      </p>
      {data.customEquipment.map((c: CustomEquipment) => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, fontSize: 14 }}>
          <span>{c.name}</span>
          <button className="button-secondary" disabled={busy} onClick={() => run(() => api.removeCustomEquipment(c.id))} style={{ fontSize: 12, padding: "4px 10px" }}>
            Remove
          </button>
        </div>
      ))}
      <form
        style={{ display: "flex", gap: 8, marginTop: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (await run(() => api.addCustomEquipment(name.trim()))) setName("");
        }}
      >
        <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Landmine attachment" style={{ ...wideInput, flex: 1 }} />
        <button className="button-primary" type="submit" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}

const MUSCLES: Muscle[] = ["CHEST", "SHOULDERS", "TRICEPS", "BACK", "BICEPS", "QUADS", "HAMSTRINGS", "GLUTES", "CORE"];
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

function CustomExercisesCard({ data }: { data: GymsResponse }) {
  const [mine, setMine] = useState<Exercise[]>([]);
  const [form, setForm] = useState<CustomExerciseInput>({
    name: "",
    category: "ACCESSORY",
    muscleGroup: "",
    repRangeStyle: "HYPERTROPHY",
    equipment: "BODYWEIGHT",
    movementPattern: "PUSH",
    primaryMuscle: "CHEST",
    requires: [],
    customEquipmentId: null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .getExercises()
      .then((all) => setMine(all.filter((e) => e.userId && !e.archivedAt)))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const set = <K extends keyof CustomExerciseInput>(k: K, v: CustomExerciseInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const equipmentName = (id?: string | null) => data.customEquipment.find((c) => c.id === id)?.name;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createExercise({ ...form, name: form.name.trim(), muscleGroup: form.muscleGroup.trim() || titleCase(form.primaryMuscle ?? "CHEST") });
      setForm((f) => ({ ...f, name: "", muscleGroup: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the exercise");
    } finally {
      setBusy(false);
    }
  }

  const select = { ...wideInput, marginTop: 4 } as const;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <strong>Your own exercises</strong>
      <p className="text-dim" style={{ fontSize: 13, marginTop: 6 }}>
        Add exercises the app doesn't know. They join your workouts at any gym that has what they need.
      </p>
      {mine.map((ex) => (
        <div key={ex.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, fontSize: 14 }}>
          <span>
            {ex.name}
            <span className="text-dim" style={{ fontSize: 12 }}>
              {" "}
              · {titleCase(ex.movementPattern)}
              {ex.customEquipmentId && equipmentName(ex.customEquipmentId) ? ` · needs ${equipmentName(ex.customEquipmentId)}` : ""}
            </span>
          </span>
          <button
            className="button-secondary"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={async () => {
              await api.archiveExercise(ex.id).catch(() => {});
              load();
            }}
          >
            Remove
          </button>
        </div>
      ))}

      <form onSubmit={add} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <input type="text" required value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Exercise name, e.g. Landmine Press" style={wideInput} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
          <label>
            <span className="text-dim">Type</span>
            <select value={form.movementPattern} onChange={(e) => set("movementPattern", e.target.value as CustomExerciseInput["movementPattern"])} style={select}>
              {["PUSH", "PULL", "LEGS", "CORE"].map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-dim">Main muscle</span>
            <select value={form.primaryMuscle} onChange={(e) => set("primaryMuscle", e.target.value as Muscle)} style={select}>
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {titleCase(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-dim">Main lift or accessory?</span>
            <select value={form.category} onChange={(e) => set("category", e.target.value as CustomExerciseInput["category"])} style={select}>
              <option value="COMPOUND">Main lift (compound)</option>
              <option value="ACCESSORY">Accessory</option>
            </select>
          </label>
          <label>
            <span className="text-dim">Rep style</span>
            <select value={form.repRangeStyle} onChange={(e) => set("repRangeStyle", e.target.value as CustomExerciseInput["repRangeStyle"])} style={select}>
              <option value="STRENGTH">Strength (lower reps)</option>
              <option value="HYPERTROPHY">Muscle (higher reps)</option>
            </select>
          </label>
          <label>
            <span className="text-dim">Loaded with</span>
            <select value={form.equipment} onChange={(e) => set("equipment", e.target.value as CustomExerciseInput["equipment"])} style={select}>
              <option value="DUMBBELL">Dumbbells</option>
              <option value="BARBELL">Barbell</option>
              <option value="EZ_BAR">EZ bar</option>
              <option value="BAND">Resistance band</option>
              <option value="BODYWEIGHT">Bodyweight / added weight</option>
            </select>
          </label>
          <label>
            <span className="text-dim">Built around your equipment</span>
            <select value={form.customEquipmentId ?? ""} onChange={(e) => set("customEquipmentId", e.target.value || null)} style={select}>
              <option value="">None</option>
              {data.customEquipment.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          <span className="text-dim" style={{ fontSize: 13 }}>
            Needs:
          </span>
          {data.allAccessories.map((a) => (
            <CheckRow
              key={a.value}
              label={a.label}
              checked={(form.requires ?? []).includes(a.value)}
              onChange={(v) => set("requires", v ? [...(form.requires ?? []), a.value] : (form.requires ?? []).filter((x) => x !== a.value))}
            />
          ))}
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p>}
        <button className="button-primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? "Adding..." : "Add exercise"}
        </button>
      </form>
    </div>
  );
}
