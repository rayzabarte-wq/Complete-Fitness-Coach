import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true makes the dev server reachable from other devices on the
  // same WiFi (e.g. testing from a phone) — by default Vite only listens
  // on localhost.
  server: { port: 5173, host: true },
});
