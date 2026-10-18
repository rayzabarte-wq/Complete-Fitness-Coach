import { useState } from "react";
import { track } from "../lib/api.js";
import { useInstall } from "../lib/install.js";

// "Install the app": a button where the browser allows a one-tap install, and
// the Add to Home Screen steps on iPhone/iPad. Renders nothing once installed.

const DISMISS_KEY = "installBannerDismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallSteps() {
  const { installed, ios, canPrompt, install } = useInstall();
  const [note, setNote] = useState<string | null>(null);

  if (installed) return <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>The app is installed on this device.</p>;

  if (canPrompt) {
    return (
      <div>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>Add Fitness Coach to your home screen or apps so it opens like any other app, full screen.</p>
        <button
          className="button-primary"
          onClick={async () => {
            track("app_install_clicked");
            const r = await install();
            setNote(r === "accepted" ? "Installing…" : null);
          }}
        >
          Install the app
        </button>
        {note && <p className="text-dim" style={{ fontSize: 13 }}>{note}</p>}
      </div>
    );
  }

  if (ios) {
    return (
      <div>
        <p className="text-dim" style={{ fontSize: 13, marginTop: 0 }}>On iPhone and iPad the app is added from the browser's Share menu:</p>
        <ol style={{ fontSize: 14, paddingLeft: 20, margin: "6px 0" }}>
          <li>Tap the <strong>Share</strong> button (the square with an arrow, at the bottom or top of the screen).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. The Fitness Coach icon appears on your home screen.</li>
        </ol>
        <p className="text-dim" style={{ fontSize: 12, margin: 0 }}>If you added it before, delete the old icon first so the new one shows.</p>
      </div>
    );
  }

  return (
    <p className="text-dim" style={{ fontSize: 13, margin: 0 }}>
      Your browser's menu has an <strong>Install app</strong> (or <strong>Add to Home screen</strong>) option. In Chrome it's under the ⋮ menu; in Edge, under … → Apps.
    </p>
  );
}

/** A small dismissible card on the Calendar, only on phones, only if not installed. */
export function InstallBanner() {
  const { installed, ios, canPrompt } = useInstall();
  const [hidden, setHidden] = useState(dismissed);
  const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 700px)").matches;
  if (installed || hidden || !phone || !(ios || canPrompt)) return null;

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--sun)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ color: "var(--navy)" }}>Put Fitness Coach on your home screen</strong>
        <button
          className="button-quiet"
          aria-label="Dismiss"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* private mode: it just returns next time */
            }
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ marginTop: 6 }}>
        <InstallSteps />
      </div>
    </div>
  );
}
