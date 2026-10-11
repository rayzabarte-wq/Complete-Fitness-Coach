#!/usr/bin/env bash
# Starts the backend and frontend together. Runs automatically whenever
# the codespace is opened; can also be run by hand: bash .devcontainer/start.sh
cd "$(dirname "$0")/.."

if curl -sf http://localhost:3001/health > /dev/null; then
  echo "The app is already running. Open the PORTS tab and click the globe icon next to port 5173."
  exit 0
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && ! grep -qE '^ANTHROPIC_API_KEY="sk-ant-[^."]' backend/.env 2>/dev/null; then
  echo "NOTE: No Anthropic API key found. The app works, but AI coaching buttons will show an error."
  echo "      Add it at github.com/settings/codespaces (secret name ANTHROPIC_API_KEY), then restart the codespace."
  echo
fi

trap 'kill 0' EXIT
(cd backend && npm run dev) &
(cd frontend && npm run dev) &
echo
echo "Starting... in a few seconds, open the PORTS tab and click the globe icon next to port 5173."
echo "Keep this terminal open while you use the app."
wait
