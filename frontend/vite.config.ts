import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The commit this build was made from (Railway provides it to builds), so
  // the app can show its version and spot a server on a different one.
  define: {
    __APP_VERSION__: JSON.stringify((process.env.RAILWAY_GIT_COMMIT_SHA ?? "dev").slice(0, 7)),
  },
  server: {
    port: 5173,
    // host: true makes the dev server reachable from other devices on the
    // same WiFi (e.g. testing from a phone) — by default Vite only listens
    // on localhost.
    host: true,
    // GitHub Codespaces serves the app from *.app.github.dev, which Vite
    // otherwise rejects as an unknown host.
    allowedHosts: [".app.github.dev"],
    // Lets the frontend reach the backend through its own address
    // (VITE_API_URL="/api"), which is how it runs in Codespaces — see
    // .devcontainer/setup.sh. Unused when VITE_API_URL is a full URL.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
