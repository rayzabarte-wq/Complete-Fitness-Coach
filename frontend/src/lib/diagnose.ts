import { api } from "./api.js";

// Helps work out why something that should load didn't. The app and the
// server are deployed separately, so a very common cause is that one is on
// a newer version than the other (the server then has no route for what the
// app asks for). Each reports the commit it was built from; comparing them
// turns "something went wrong" into something fixable.

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

export interface ServerStatus {
  /** Whether the server answered at all. */
  reachable: boolean;
  /** Its version, or null when it doesn't report one (an older server). */
  version: string | null;
}

export async function getServerStatus(): Promise<ServerStatus> {
  try {
    const res = await fetch(`${api.apiUrl}/health`);
    if (!res.ok) return { reachable: true, version: null };
    const body = await res.json().catch(() => ({}));
    return { reachable: true, version: typeof body.version === "string" ? body.version : null };
  } catch {
    return { reachable: false, version: null };
  }
}

/** True when the app and server are known to be on different versions. */
export function versionsDiffer(server: ServerStatus): boolean {
  if (!server.reachable) return false;
  if (server.version === null) return true; // an older server that reports no version
  if (APP_VERSION === "dev" || server.version === "dev") return false; // local development
  return server.version !== APP_VERSION;
}

export function describeVersions(server: ServerStatus): string {
  const serverText = !server.reachable ? "not reachable" : server.version ?? "an older version";
  return `App version ${APP_VERSION}, server version ${serverText}.`;
}

/** A plain-words explanation of why `what` couldn't be loaded. */
export async function describeProblem(what: string, err: unknown): Promise<string> {
  const status = (err as { status?: number })?.status;
  const server = await getServerStatus();
  const versions = describeVersions(server);

  if (!server.reachable) {
    return `Couldn't load ${what}: the app can't reach the server. Check your connection and try again. ${versions}`;
  }
  if (status === 401) {
    return `Couldn't load ${what}: you've been signed out. Log in again.`;
  }
  if (versionsDiffer(server) && (status === 404 || status === undefined || server.version === null)) {
    return `Couldn't load ${what}: the server is running a different (older) version than the app, so it doesn't have this feature yet. The backend needs to be redeployed. ${versions}`;
  }
  const detail = err instanceof Error && err.message ? err.message : "unknown error";
  return `Couldn't load ${what}: the server answered "${detail}"${status ? ` (${status})` : ""}. ${versions}`;
}
