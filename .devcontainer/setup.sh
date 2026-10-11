#!/usr/bin/env bash
# One-time setup when the codespace is created: install dependencies,
# write backend/.env and frontend/.env, create the tables, load exercises.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing backend dependencies"
(cd backend && npm ci)
echo "==> Installing frontend dependencies"
(cd frontend && npm ci)

if [ ! -f backend/.env ]; then
  echo "==> Creating backend/.env"
  cp backend/.env.example backend/.env
  secret=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  # The public URL of this codespace's frontend, for the optional
  # Outlook/Strava sign-in redirects.
  if [ -n "${CODESPACE_NAME:-}" ]; then
    public="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    public="http://localhost:5173"
  fi
  sed -i \
    -e 's#^DATABASE_URL=.*#DATABASE_URL="postgresql://strength:strength@localhost:5432/strength_app"#' \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=\"${secret}\"#" \
    -e 's#^ANTHROPIC_API_KEY=.*#ANTHROPIC_API_KEY=""#' \
    -e "s#^FRONTEND_URL=.*#FRONTEND_URL=\"${public}\"#" \
    -e "s#^MICROSOFT_REDIRECT_URI=.*#MICROSOFT_REDIRECT_URI=\"${public}/api/integrations/outlook/callback\"#" \
    -e "s#^STRAVA_REDIRECT_URI=.*#STRAVA_REDIRECT_URI=\"${public}/api/integrations/strava/callback\"#" \
    backend/.env
fi

if [ ! -f frontend/.env ]; then
  echo "==> Creating frontend/.env"
  # Same-origin path, proxied to the backend by the Vite dev server.
  echo 'VITE_API_URL="/api"' > frontend/.env
fi

echo "==> Waiting for the database"
cd backend
for i in $(seq 1 30); do
  if npx prisma migrate deploy; then break; fi
  if [ "$i" = 30 ]; then echo "Database never became ready" >&2; exit 1; fi
  sleep 2
done
npm run seed

echo "==> Setup complete"
