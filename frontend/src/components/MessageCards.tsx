import { useEffect, useState } from "react";
import { api, AppMessage } from "../lib/api.js";

// Messages from the app's owner, shown at the top of the Calendar until the
// person dismisses them. Fails quietly: a missing message is never worth an
// error on the home screen.
export default function MessageCards() {
  const [messages, setMessages] = useState<AppMessage[]>([]);

  useEffect(() => {
    api.getMessages().then(setMessages).catch(() => {});
  }, []);

  function dismiss(id: string) {
    setMessages((m) => m.filter((x) => x.id !== id));
    api.dismissMessage(id).catch(() => {});
  }

  if (messages.length === 0) return null;
  return (
    <>
      {messages.map((m) => (
        <div key={m.id} className="card" role="status" style={{ marginBottom: 12, borderLeft: "4px solid var(--accent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontWeight: 600, color: "var(--navy)" }}>{m.title}</div>
            <button className="button-quiet" onClick={() => dismiss(m.id)} aria-label={`Dismiss message: ${m.title}`}>
              Dismiss
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.body}</p>
        </div>
      ))}
    </>
  );
}
