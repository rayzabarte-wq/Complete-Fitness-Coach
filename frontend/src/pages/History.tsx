import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

interface SessionWithSets {
  id: string;
  date: string;
  notes: string | null;
  sets: {
    id: string;
    weightLb: number;
    bandLevel: string | null;
    reps: number;
    targetReps: number;
    exercise: { name: string };
  }[];
}

export default function History() {
  const [sessions, setSessions] = useState<SessionWithSets[]>([]);

  useEffect(() => {
    api.getRecentSessions().then((data) => setSessions(data as SessionWithSets[]));
  }, []);

  if (sessions.length === 0) {
    return <p className="text-dim">No sessions logged yet — head to Log to add your first one.</p>;
  }

  return (
    <div>
      {sessions.map((session) => (
        <div key={session.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>{new Date(session.date).toLocaleDateString()}</div>
          {session.sets.map((s) => (
            <div key={s.id} className="text-dim" style={{ padding: "4px 0" }}>
              {s.exercise.name}: {s.bandLevel ? `${s.bandLevel} band` : s.weightLb > 0 ? `${s.weightLb}lb` : "Bodyweight"} × {s.reps} (target {s.targetReps})
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
