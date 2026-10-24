# Complete Fitness Coach

Multi-user fitness and training planner. The backend is split into two
clearly-bounded modules — **Sport** (deep AI coaching, currently Strength
and Golf) and **Scheduler** (session scheduling, weather, and data
capture for "connector" sports that already have a strong dedicated app —
Run/Walk/Cycling/Swim via Strava, calendar sync via Outlook). See
"Sport vs. Scheduler" below for why that split exists and where the line
is drawn. Each account's data is fully isolated from every other
account's.

## Structure

```
strength-app/
├── backend/          Node + TypeScript + Express API, Prisma + Postgres
│   ├── prisma/
│   │   └── schema.prisma   Data model (shared by both modules — see below)
│   └── src/
│       ├── sport/          Deep AI coaching — Strength, Golf
│       │   ├── routes/     exercises, sessions (workout logging), workouts (plan generation), golf
│       │   ├── services/   workoutPlanner.ts, golfPlanner.ts (Claude API)
│       │   ├── lib/        equipmentConfig.ts (per-gym equipment defaults + weight resolution)
│       │   └── index.ts    Sport's public interface — import only from here
│       ├── scheduler/      Scheduling, weather, connector-sport data capture
│       │   ├── routes/     calendar, outlook, strava
│       │   ├── services/   weather.ts, outlookCalendar.ts, stravaSync.ts
│       │   └── index.ts    Scheduler's public interface — import only from here
│       ├── routes/         Shared/core: auth, account (data rights, preferences)
│       ├── services/       Shared/core: auth.ts (password/2FA/session tokens)
│       ├── lib/             Shared/core: prisma.ts, requireAuth.ts
│       └── index.ts        App entrypoint — wires both modules together
└── frontend/         React + Vite + TypeScript, installable as a PWA
    └── src/
        ├── pages/           Calendar / Workout / Log / History / Settings
        ├── components/
        └── lib/             API client, shared taxonomy (sessionTypes.ts)
```

### Sport vs. Scheduler

Not every sport gets its own AI coaching layer. Strava, for instance,
already does activity tracking and training suggestions for running and
cycling, with years of user trust behind it — there's no gap for this app
to fill there, so Run/Walk/Cycling/Cycling-Turbo/Swim are **connector
sports**: scheduled and captured (via Strava sync or manual entry), never
coached. Golf is different — Arccos does shot-tracking and stats, but
nothing that plans a practice session, so Golf gets the same deep-AI
treatment as Strength (`sport/services/golfPlanner.ts`, mirroring
`workoutPlanner.ts`). If a connector sport ever earns its own AI layer
later, the golf planner's pattern is the template to copy: generate real
coaching, but still read whatever data the incumbent app's ecosystem
already captures (see "AI-generated golf practice sessions" below for how
that works with Arccos specifically).

**The module boundary is enforced at the code level, not just
conceptually.** Each module has exactly one file (`sport/index.ts`,
`scheduler/index.ts`) that other code is allowed to import from — nothing
reaches into `sport/routes`, `sport/services`, `scheduler/routes`, or
`scheduler/services` directly from outside its own module. The one
cross-module dependency (Sport's session logging syncs to Outlook, which
is a Scheduler capability) goes through `scheduler/index.ts` explicitly,
not a direct file import — see the comments in `sport/routes/sessions.ts`
and `scheduler/index.ts`.

**What's still shared, deliberately:** one Postgres database (one
`schema.prisma` for both modules — `sport/services/golfPlanner.ts` reads
`PlannedSession`, which is Scheduler's table, directly via Prisma, noted
in a comment there), one Express app, one login, one deployment. The
module split is about code organization, not a distributed system — if
Sport and Scheduler ever become genuinely separate apps, this boundary is
what a real split would cut along, but that's deliberately not done yet
while both are still evolving fast. See the README section on this
decision (or just ask — Claude can walk through the reasoning again) for
why now isn't the right time for an actual split.

## Strength-first release (260)

The first release is a **strength app**. Every other sport is still in the
code and the database, but switched off by default (`User.visibleSessionTypes`
defaults to `[STRENGTH]`; the migration switched existing accounts too). Ticking
a type back on in Settings → Workout types brings it back to the Calendar
and the Log tab.

**Navigation.** Three tabs: **Calendar** (plan + what happened), **Log**
(record it) and **Progress** (goals and trends). Settings sits behind the gear
icon in the header. The 3-month planner is reachable from Settings.

**Log is per sport.** Strength is *active*: build a session, then log it live,
set by set. Steps and the connector sports (run, cycling, walk, swim, golf
rounds) are *passive*: data arrives from Apple Health or Strava and is just
displayed. Golf range/short-game/putting stay active (AI drill plan, then log).

**Split from days per week** (`sport/lib/training.ts`). Every muscle should get
about two sessions a week, so the split follows the days you commit to:
2–3 → full body, 4 → upper/lower, 5 → push/pull/legs/upper/lower,
6 → push/pull/legs ×2. A 3–4 day push/pull/legs would hit each muscle once.

**Per-muscle recovery** (`sport/services/recovery.ts`). Nine muscles. Every
exercise is tagged with one primary and any secondary muscles. Logging it
starts a 72h (primary) / 48h (secondary) clock, scaled by the sets' RPE
(0.8× at RPE 6 up to 1.2× at RPE 10). No heart-rate or sleep data.

**Block-based variation** (`sport/services/exerciseSelection.ts`). Each session
focus keeps the same exercises for a 4-week block so the load can progress. An
exercise is swapped mid-block only if it stalls (no improvement in estimated
1RM over 3 sessions). At a block's end, main lifts that are still progressing
carry over and the rest rotate. Each exercise has a `variationTag` (e.g.
`CHEST_INCLINE_PRESS`), and the new block favours the tags with the fewest
sets over the last 8 weeks. This follows the evidence that frequent rotation
doesn't help, but covering different regions of a muscle does.

**Week auto-fill** (`scheduler/services/strengthAutofill.ts`, Calendar →
"Auto-fill strength for this week"). It continues the split rotation and
places each session on a day when that session's muscles are projected to
have recovered, with no more than 3 training days in a row. Empty days become
rest days. If a body goal is behind pace, it adds one extra session. Re-running
it only replaces auto-planned entries that haven't happened yet. Anything you
added or edited yourself stays.

**Body goals** (`services/goals.ts`, `routes/body.ts`). Each goal is a metric
(body fat %, muscle mass, body weight), a target value and a date. Every
revision is kept as a `GoalTarget` version. The chart shows the current pace
line in full and earlier ones faintly, with a tappable marker at each revision.
A revision needs a reason. The **quarterly review** describes, rather than
scores, how ambitious goals were and how they were recalibrated. It reports
injury/life-event revisions separately from targets that were simply eased.

**Body data sources.** For now, Renpho scans come from `tools/renpho_sync.py`
(the unofficial `renpho-py` client, run on your own machine). For a public
product, the intended sources are Apple Health (Renpho can write there) and
manual entry. Both already work through the same `/ingest/body` endpoint and
the manual form.

**Steps.** A daily log (days can also be added or corrected by hand under Log → Steps) imported from Apple Health by an iPhone Shortcut posting
to `/ingest/steps` with a personal upload token (`routes/ingest.ts`). The goal
is an *average* daily step goal. Progress compares your average with it, and
the calendar ticks the days you reached it.

**Progress tab.** Sub-tabs: Goals (goals, scans, benchmarks, quarterly review),
Strength (best set per session as estimated 1RM), Balance (recovery now,
variation coverage) and Steps. Each sub-tab has the same period-on-period
comparison: two periods, plain numbers, the difference and an up/down arrow.
Within each sub-tab, every block (How you compare, Body goals, Recent scans,
Quarterly goal review, Strength progression, Recovery, Coverage, Daily steps,
Step goal, Compare periods) is a collapsible section, like Settings. The
graph sections (Body goals, Strength progression, Daily steps) open by
default and everything else starts closed; whichever way you leave a section
is remembered on that device. A closed header carries a short summary ("1
active", "2 logged", "7,750 avg", "3 recovering"). Both pages share
`components/Collapsible.tsx`.

**Calendar day view.** Each day is a simplified summary: one line per activity
in that activity's fixed colour (strength blue, steps green, ...) with a tick
when done, and a steps bar filled toward the goal. Tap a day for the full
detail (`/day/:date`). Colour always identifies the activity. Hitting a target
is shown with a tick or fill, never a colour change.

**Profile and consent** (`services/consent.ts`, `routes/consent.ts`). Birth year,
sex and height are kept only to compare you with published healthy ranges
(body fat: Gallagher et al. 2000; BMI: WHO). Consent is asked once, before
anything personal is collected, as four separate opt-ins with nothing
pre-ticked: store profile, store body/activity data, benchmarking, future
analytics. `ConsentRecord` is an append-only log tied to the wording version.
Withdrawing takes effect immediately: profile fields, or all scans, goals and
steps, are deleted. It all appears in the data export and is erased with the
account. **Have the wording and lawful bases reviewed by a data-protection
professional before any public launch.** Body composition is special-category
health data under GDPR.

## Data model (v1)

- `Exercise` — name, category (compound/accessory), primary muscle group,
  rep range style (strength 5-8 / hypertrophy 8-15), **equipment**
  (dumbbell/barbell/EZ bar/band/bodyweight), **movement pattern**
  (push/pull/legs/core), default set count
- `WorkoutSession` — date, notes
- `SetEntry` — session, exercise, weight (lb), band level (for band
  exercises), reps, target reps, RPE, order
- `Recommendation` — cached AI suggestion per exercise (weight/reps/sets +
  rest interval + reasoning), written whenever a full workout is generated
- `NutritionLog` — date, calories, protein/carbs/fat, notes (schema is in
  place now; UI comes later)

## Calories and macros

Daily calories, protein, carbs and fat are stored per day (`NutritionDay`) and
shown under **Log > Nutrition**, with a 14-day list and the average. MyFitnessPal
has no public API (its developer programme is closed to new applicants), so
the route is **Apple Health**: MyFitnessPal writes its totals to Apple Health,
and an iPhone Shortcut reads them and posts them to `POST /ingest/nutrition`
with your personal upload token, exactly like steps. Setup steps are in
**Settings > Data import > Calories and macros**. The endpoint takes one day
(`{"date","calories","proteinG","carbsG","fatG"}`) or `{"days":[...]}`; any
figure can be left out, and only the figures sent are changed. Days can also be
entered by hand (`PUT /nutrition/:date`). Both need the body-data consent, like
steps, and the data is included in the export and deleted with the account.
This adds a table: apply the `nutrition_days` migration.

## Gyms & equipment

You can describe up to three places you train under **Settings > Gyms**: a
**Home gym**, a **Regular gym** and a **Visiting gym** (travel, a friend's,
a hotel). Each is its own profile with tick-boxes:

- **Equipment types:** Dumbbells, Barbell, EZ bar, Resistance bands,
  Bodyweight. For the weighted ones set a min, max and step (e.g. 5–45lb in
  5lb steps) — or an exact list for uneven gear like a fixed-dumbbell rack
  (`10, 12.5, 15, 20, 30`). Bands: which of Light / Medium / Heavy / X-Heavy
  it has. Bodyweight: the most optional *added* weight (0 if none).
- **Also has:** Bench, Pull-up / chin-up bar, Gym rings. Exercises that need
  one (`Exercise.requires`) are left out of gyms without it.
- **Your own equipment:** name anything else ("Sled", "Landmine attachment"),
  then tick it on the gyms that have it. **Your own exercises** can be linked
  to that item (and to the accessories they need); they join your workouts
  only at gyms that have everything they need.

On the **Log** page a *Home / Regular gym / Visiting gym* switcher chooses
which gym the next workout is built for. The choice is remembered
(`User.activeGymId`), and the workout records the gym (`gymId`/`gymName`).

What it drives:

- **Which exercises you get** — only ones doable at that gym. The training
  block is shared between gyms: an exercise the current gym can't do is
  replaced for that session only, so the block is intact when you're back home.
- **Which weights are offered and suggested.** The AI is told that gym's exact
  loadable values, suggestions are snapped to the nearest one, and the Log
  page's dropdowns come from the workout's gym.
- **Server-side validation** of logged sets against that gym's equipment.

Each gym starts from a **preset**, shown at the top of its editor. Home: *Standard
home gym* (5–45lb dumbbells, 20–80lb barbell/EZ bar, all bands, bench + bar +
rings). Regular gym: *Commercial gym* (5–100lb dumbbells, 45–315lb barbell,
EZ bar, bands, bench + bar). Visiting gym: *Basic hotel gym* (5–50lb dumbbells,
bench, bodyweight), *Well-equipped hotel gym* (dumbbells to 75lb, barbell to
135lb, bench + bar) or *No equipment* (bodyweight + light/medium bands). The
values are editable guesses, not facts about real gyms. After picking one you
can change the min, max and step of any equipment type (or its exact weight
list) and save; only what you change is stored, the rest keeps following the
preset. **Reset to defaults** deletes your adjustments and re-applies the
preset (equipment and accessories; the gym's name and your own-equipment
ticks are kept), and choosing a different preset does the same with the new
one. Presets live in `GYM_PRESETS` in `backend/src/sport/lib/equipmentConfig.ts`;
the choice is `GymProfile.presetId` (`POST /gyms/:id/preset`). Profiles are the
`GymProfile` / `GymEquipment` / `CustomEquipment` tables (`GET /gyms`,
`PUT /gyms/:id`, `PUT /gyms/active`, `/gyms/custom-equipment`), and custom
exercises are `Exercise` rows with a `userId` (`POST`/`DELETE /exercises`). All
are included in the data export and deleted with the account.

Upgrading: apply the `gym_profiles` and `gym_preset` migrations (`npx prisma migrate deploy`, or
`migrate dev` locally) and re-run the seed (`npx prisma db seed`) so catalog
exercises get their bench / bar / rings requirements. The migration turns
any equipment settings saved earlier into each user's Home gym. It also
adds a partial unique index for catalog names that `schema.prisma` can't
express, so `migrate dev` may offer to "fix" it — decline that.

Weights are in pounds only.

The `Log` page shows only the current generated session's exercises, with
a weight/band selector, a reps field (pre-filled with the AI's suggested
target), and a log toggle right alongside each set.

## Authentication and accounts

The app is multi-user: anyone can register their own account, and every
account's workouts, recommendations, scheduled sessions, and connections
are fully isolated from every other account's — enforced at the database
level (every table is scoped to a `userId`), not just hidden in the UI.

Each account is locked behind email + password and TOTP-based 2FA (the
same kind of code Google Authenticator, Authy, or 1Password produce).

- **`POST /auth/register`** creates a new account (rejects a duplicate
  email). Right after registering, the app walks you through **2FA
  setup**: scan a QR code into an authenticator app, confirm a 6-digit
  code, and 2FA is enforced on all future logins for that account.
- Every route except `/auth/*` and the Outlook OAuth redirect endpoints
  requires a valid session token (`Authorization: Bearer <token>`), issued
  at login and valid for 12 hours.
- Login attempts are rate-limited (10 per 15 minutes) to slow down
  brute-forcing.
- **2FA once every 24 hours per device:** after a 2FA code is accepted (at
  login or during setup), the server returns a signed trust token valid for
  24 hours. The frontend keeps it in a first-party cookie (`fc_2fa_trust`,
  `Max-Age` 24h, `SameSite=Strict`, `Secure` on https) and sends it with
  the next login, so only the password is needed until it expires. The
  24 hours count from the last time a code was actually entered; they don't
  extend each time you use it. Details:
  - The cookie is set by the page rather than by the backend because the
    frontend and backend are on different domains. A backend cookie would
    be third-party, which Safari blocks by default.
  - The token has its own JWT audience, so it can't be used as a session
    token (and a session token can't be used as one).
  - It must match the account logging in, and a password reset revokes it.
- **Forgotten password:** "Forgot password?" on the login screen emails a
  one-time link (`POST /auth/forgot-password`) that **expires after 3
  minutes**. The link opens `/?reset=<token>`, which shows a countdown and
  asks for the new password (`POST /auth/reset-password`). Details:
  - The reply is the same whether or not the email has an account, so it
    can't be used to find out who's registered.
  - Only a SHA-256 hash of the token is stored; each link works once, and
    requesting a new one cancels the old one.
  - Resetting signs out every device that was logged in
    (`User.sessionsValidAfter`, checked in `lib/requireAuth.ts`), and
    doesn't log you in: you log in afterwards, so 2FA still applies.
  - Requests are rate-limited (5 per 15 minutes per IP).
  - Emails go through [Resend](https://resend.com) (`RESEND_API_KEY`,
    `EMAIL_FROM`; see `backend/.env.example`). Without a key, the link is
    printed in the backend log instead. The link points at `FRONTEND_URL`,
    never at a URL taken from the request.

If you're deploying this somewhere with a public URL and don't want
open registration, that's a deliberate choice to make yourself — for
example, gate `/auth/register` behind an invite code, or put the whole
app behind a separate access layer. It's open by default here since
that's what "multi-user" means.

Before deploying, generate a real `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

and set it as an env var on your host — never commit it.

## Multi-user data isolation

Every table holding personal data (`WorkoutSession`, `SetEntry`,
`Recommendation`, `PlannedSession`, `NutritionLog`, `MicrosoftAccount`) is
scoped to a `userId`, and every route filters and checks ownership by
`req.userId` (set from the verified session token) before reading,
writing, or deleting anything. One account can never see, edit, or delete
another account's data — this is enforced in the database queries
themselves, not just hidden in the UI. The one shared table is `Exercise`
(the movement catalog) — deliberately not personal data, so it's the same
list for everyone.

Deleting a `User` row cascades automatically (via Prisma's
`onDelete: Cascade`) to every row that account owns, across every table
above — see `backend/prisma/schema.prisma`.

## Data rights (download & delete your data)

From **Settings**, any account can:

- **Download my data** — exports everything that account owns (workout
  sessions with sets, recommendations, scheduled calendar sessions,
  nutrition logs, account creation date) as a JSON file. Password hashes,
  the 2FA secret, and Outlook OAuth tokens are deliberately excluded —
  those are security credentials, not something that should ever leave
  the server in a data export.
- **Delete my account** — requires re-entering your password (and 2FA
  code, if enabled) as confirmation, since it's irreversible. This
  permanently deletes the account and everything it owns via the cascade
  described above.

**Two things this doesn't cover, worth knowing:** Outlook calendar events
already created aren't deleted along with the account — they live in
Microsoft's system, not this app's database, so remove them directly in
Outlook if you want them gone too. And Claude API calls made while
generating workout recommendations go through Anthropic's API, which has
its own data handling terms separate from this app.

**On legal compliance — read this before relying on it:** This gives you
the core *technical* mechanisms that GDPR (EU/UK), CCPA/CPRA
(California), and Australia's Privacy Act commonly require — the right to
access/receive a copy of your data, and the right to erasure/deletion,
plus data being properly segregated per user. That is not the same as the
app being *legally* compliant with any of these frameworks, and this
isn't legal advice. Actually operating a multi-user app under these laws
typically also needs things no amount of code alone provides: a privacy
policy, a documented lawful basis for processing data, a data retention
policy, a breach notification process, clarity on where data is hosted
and whether that involves an international transfer, and — depending on
jurisdiction and scale — things like a Data Protection Officer or
compliance with CCPA's specific business-size thresholds. If this app is
going to have real users beyond yourself, it's worth having a solicitor
or lawyer review the actual legal side before you treat it as compliant.

## Local setup

New to this? **[SETUP.md](SETUP.md)** is a full beginner walkthrough
(installing Node and Postgres, creating the database, first login). The
short version:

### 1. Backend

```bash
cd backend
cp .env.example .env       # fill in DATABASE_URL, ANTHROPIC_API_KEY, JWT_SECRET
npm install
npx prisma migrate dev     # creates the tables
npm run seed               # loads the exercise catalog
npm run dev                 # http://localhost:3001
```

No local Postgres? `docker compose up -d` from the repo root starts one that
matches `postgresql://strength:strength@localhost:5432/strength_app`.

### Or: GitHub Codespaces

`.devcontainer/` runs the whole stack in a codespace: Postgres alongside
the app container, `setup.sh` installs dependencies, writes both `.env`
files, migrates and seeds on create, and `start.sh` starts the backend and
frontend on every attach. The frontend uses `VITE_API_URL="/api"` there,
which the Vite dev server proxies to the backend (see `vite.config.ts`), so
only port 5173 needs forwarding. `ANTHROPIC_API_KEY` comes from a Codespaces
secret. Step-by-step: [SETUP.md](SETUP.md#run-it-from-github-codespaces).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

The frontend talks to the backend via `VITE_API_URL` (see `frontend/.env.example`).

## Deploying (Railway)

Railway is the recommended host. One project runs the Postgres database,
the backend, and the frontend as three services. Realistic cost for this
app's size is around **$5/month** (Railway's Hobby plan; see
[railway.com/pricing](https://railway.com/pricing) for current pricing,
since this can change).

> **Important:** this repo holds two apps (`backend/` and `frontend/`), so
> each Railway service must have its **Root Directory** set. Without it,
> Railway builds the repo root and fails with *"Railpack could not
> determine how to build the app."*

### 1. Database

In your Railway project: **+ Create → Database → PostgreSQL**.

### 2. Backend service

**+ Create → GitHub Repo** → pick this repo. Then in the service's
**Settings**:

- **Source → Root Directory:** `/backend`
- **Source → Branch:** the branch you want to deploy
- **Deploy → Pre-deploy Command:** `npx prisma migrate deploy && npm run seed`
  (creates/updates the tables and loads the exercise catalog on every
  deploy; both steps are safe to repeat)
- **Networking → Generate Domain.** Copy the URL; the frontend needs it.

In **Variables** (see `backend/.env.example` for the full annotated list):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills it in from the database service) |
| `JWT_SECRET` | Long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `FRONTEND_URL` | The frontend's Railway URL (add after step 3). Password reset emails link here, so it must be right. |
| `RESEND_API_KEY` | For "forgot password" emails: create a free account at [resend.com](https://resend.com) → **API Keys** → **Create API Key**. Without it, reset links only appear in the backend's **Deploy Logs**. |
| `EMAIL_FROM` | Optional. Leave unset to use Resend's test sender, which only delivers to the email you signed up to Resend with. To email other people, verify your own domain in Resend and set e.g. `Fitness Coach <coach@yourdomain.com>`. |

Don't set `PORT`; Railway provides it. Optional: `MICROSOFT_*` (Outlook
sync), `STRAVA_*` (Strava sync), `LOCATION_LAT`/`LOCATION_LON` (weather
fallback).

### 3. Frontend service

**+ Create → GitHub Repo** → same repo. In **Settings**:

- **Source → Root Directory:** `/frontend`
- **Source → Branch:** same branch as the backend
- **Networking → Generate Domain.** This is the address you open to use the app.

In **Variables**: `VITE_API_URL` = the backend's URL from step 2, e.g.
`https://your-backend.up.railway.app` (no trailing slash). It's baked in
at build time, so redeploy the frontend if it ever changes.

### 4. Finish up

- Set the backend's `FRONTEND_URL` to the frontend's URL (step 2 table).
- If using Outlook or Strava sync, point `MICROSOFT_REDIRECT_URI` /
  `STRAVA_REDIRECT_URI` (and the callback URLs registered with Azure/
  Strava) at the backend URL instead of localhost.
- Open the frontend URL, register, and set up 2FA.
- On your phone, open the frontend URL in Safari → Share → **Add to Home
  Screen** to get an app-like icon (PWA behavior comes from
  `frontend/public/manifest.json`, already included).

### Checking that both services are on the same version

The frontend and backend deploy separately, so one can be left on an older
version (the symptom is usually a feature that "can't load", because the
backend has no route for it yet). Each reports the commit it was built from
(`RAILWAY_GIT_COMMIT_SHA`): the backend in `GET /health`
(`{"ok":true,"version":"abc1234"}`), the app in its build. **Settings** shows
both at the bottom and a warning at the top when they differ or the server
reports no version (an older server), and the Gyms section explains why it
couldn't load instead of a generic error. If it flags a mismatch, open the
service that's behind in Railway → **Deployments** and redeploy it, and check
its **Settings → Source** branch is the one you deploy from.

### If a deploy fails

Open the failed service → **Deployments** → the failed deployment →
**Build Logs** (or **Deploy Logs** if it built but won't start):

| Log says | Fix |
|---|---|
| `Railpack could not determine how to build the app` | Root Directory isn't set (see above). |
| `Environment variable not found: DATABASE_URL` | Add `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` to the backend. |
| `JWT_SECRET is not set` | Add `JWT_SECRET` to the backend. |
| Reset email never arrives | Check the backend's **Deploy Logs**: without `RESEND_API_KEY` the link is printed there. With a key but no verified domain, Resend only delivers to your own Resend sign-up email. Also check spam. |
| Reset link opens localhost | The backend's `FRONTEND_URL` isn't set to the frontend's Railway URL. |
| App loads but login says "Failed to fetch" | Frontend's `VITE_API_URL` is missing or wrong. Fix it, then redeploy the frontend. |
| Login shows a **405** error | Login is being sent to the frontend instead of the backend: `VITE_API_URL` is empty or points at the frontend's own URL. Set it to the **backend's** URL, then redeploy the frontend. |

## Workout planner

**One workout per day, built once, available on every device.** The AI is
only called when you build a workout or explicitly **Regenerate** it.
Today's workout is saved on the server (`DailyWorkout`, one per account per
local date), so refreshing, or opening the Log tab on another phone or
browser, shows it without another AI call:
- When today's workout exists, the Log tab shows a **Today's workout** card
  with **Open today's workout** (or **Continue**, with the number of sets
  logged so far) and **Regenerate**. Building a different session type
  asks before replacing it.
- Everything entered (sets, reps, weights, ticks, the readiness check-in)
  saves about half a second after each change, and immediately when the
  app goes to the background. The app re-checks the server when it comes
  back to the foreground. **‹ Back** leaves the workout without losing
  anything.
- Starting from a calendar entry opens today's workout if it's the same
  session type, and asks before replacing it otherwise.
- Saving marks today's workout done on every device. A device editing a
  workout that's since been regenerated or saved gets a 409 and reloads
  instead of overwriting it.

**Saved workouts, and reusing a missed one.** Every workout built in the
last 30 days (plus any scheduled ahead) is listed under **Saved workouts**
on the Log tab, each with a status badge: **Done ✓** (logged), **Missed**
(built for a past day, never logged), **Scheduled** (a future day) or
**Moved** (reused on another day). **Use today** (or **Repeat today** for a
completed one) copies the saved workout to today, and **Another day…**
schedules it for a later date, where it becomes that day's workout on every
device. Neither calls the AI. If today's split calls for the session type
you missed, a callout at the top offers it before the Build button. Using a
saved workout on a day that already has one asks first. Copies start fresh
(nothing logged); a missed original is marked Moved, a completed one stays
Done. The Today card and the workout screen say "Saved to your account"
(with when progress last saved) so it's clear nothing is lost.

**A workout can't be replaced by accident.** Building over a day's existing
workout needs `replaceWorkoutId`, the id of the workout the person agreed to
replace. Without it, or with an id that no longer matches, the server answers
**409** with the existing workout and does nothing (it checks before calling
the AI, so no AI call is wasted). The app then opens the existing workout
instead. This matters when a device doesn't know about the saved workout,
e.g. after a failed or stale load. On the app side:
- A failed load of today's workout retries (and re-checks on wake, online,
  pageshow), and if it still fails the Log tab says "Couldn't check for
  today's workout" with a **Try again** button and does **not** offer the
  builder. Only a successful check may show it.
- The open workout is remembered in `localStorage` (not per-tab storage), and
  a workout with sets logged reopens by itself after a reload or a restored
  tab, unless you pressed **Back**.
- Replacing a workout that has sets logged says how many sets will be
  thrown away and uses a "Yes, discard my sets" button.
- Progress saves use `keepalive`, save on `pagehide`/coming back online, and a
  failed save retries every few seconds, showing "Not saved to your account
  yet" until it succeeds.

API: `POST /workouts/plan/:focus` (with `date`) builds or regenerates the
day's workout; `GET /workouts/day/:date` and
`PUT /workouts/day/:date/progress` read and save it;
`GET /workouts/saved?today=` lists saved workouts; `POST /workouts/reuse`
(`sourceId`, `date`) copies one to a day. Only the first of these calls
the AI.

The Workout tab has four buttons — Push, Pull, Legs, Core. Tapping one
generates a complete session in a single call: every exercise for that
pattern (compounds first), with weight/band level, reps, sets, and a rest
interval between sets, plus an estimated total session time. Every
Push/Pull/Legs session also finishes with 2 randomly-rotated core
exercises (a Core session is already all core, so nothing extra is added).
See `backend/src/services/workoutPlanner.ts` for the prompt and selection
logic — it's deliberately isolated so it's easy to iterate on (e.g.
changing how many exercises go into a session, or the rest-interval
guidance) without touching the rest of the app.

Generating a plan takes you straight to the **Log** tab, which shows only
that session's exercises — pre-filled with the AI's suggested weight and
reps, ready to confirm or adjust as you actually perform each set. The
plan is held in a shared context (`frontend/src/lib/planContext.tsx`) so
Workout and Log stay in sync; if you visit Log without generating a
session first, it prompts you to pick one.

## Data quality features (build order steps 1–4)

Implemented from the data quality plan discussed alongside this project:

- **RPE quick-entry**: a row of 1–10 tap buttons under each unlogged set,
  far lower friction than typing a number, so it actually gets filled in.
- **Session timing + hitTarget**: `startedAt` is captured the moment the
  Log screen loads with a plan, `endedAt` when you save — giving real
  session duration instead of an estimate. Every logged set also stores a
  derived `hitTarget` boolean (`reps >= targetReps`), cheap to compute now
  and useful for every future trend calculation.
- **Readiness check-in**: three quick taps (Sleep / Soreness / Energy,
  each Low/Medium/High) at the top of the Log screen before you start,
  stored on the session.
- **Recommendation feedback loop**: when you save a session, the backend
  checks whether any logged set matched that exercise's most recent
  suggested weight and met/exceeded its suggested reps, and records that
  as `followedAsGiven` on the `Recommendation` row. After saving, you're
  also prompted for a quick 👍/👎 on how the generated plan felt overall
  (`SessionFeedback`).

None of this is surfaced as analytics yet — Phase 4/5 in the plan (trend
computation, plateau detection, feeding it back into the recommendation
prompt) is what turns this data into smarter suggestions, and is
deliberately left for later so there's real data to work with first.

## Outlook calendar sync

Each account connects its own Outlook independently — one user's
connection has no visibility into another's calendar or tokens. When
connected (from the Settings tab), every logged workout creates a
calendar event in that user's Outlook — subject like "PUSH Day Workout",
body listing each exercise's actual weight/reps, start/end times from the
session's actual duration. If you leave feedback on a plan afterward, the
same event is patched to include it rather than creating a duplicate.

This works through the **Microsoft Graph API**, not a device-specific
integration — because Outlook's calendar lives in Microsoft's cloud (even
for a personal outlook.com account), a single connection here means the
events sync to the Outlook app on iOS, macOS, or anywhere else Outlook is
signed in, with nothing platform-specific required.

**One-time setup required before this works** (you need to do this
yourself — Claude can't create an Azure app registration for you):

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **App
   registrations** → **New registration**.
2. Name it anything (e.g. "Strength App"). Under **Supported account
   types**, choose **"Accounts in any organizational directory and
   personal Microsoft accounts"** — this is what allows a personal
   outlook.com/Hotmail account to sign in, not just a work/school one.
3. Under **Redirect URI**, add a **Web** platform redirect matching
   `MICROSOFT_REDIRECT_URI` in your `.env` (e.g.
   `http://localhost:3001/integrations/outlook/callback` for local dev —
   update this to your deployed backend URL once hosted).
4. After creating it, copy the **Application (client) ID** into
   `MICROSOFT_CLIENT_ID`.
5. Go to **Certificates & secrets** → **New client secret**, copy the
   generated value (not the ID) into `MICROSOFT_CLIENT_SECRET` — it's
   only shown once.
6. Go to **API permissions** → **Add a permission** → **Microsoft Graph**
   → **Delegated permissions** → add `Calendars.ReadWrite` and
   `offline_access` (`User.Read` is usually there by default).
7. Set `FRONTEND_URL` in `.env` to wherever the app is hosted, so the
   OAuth flow redirects back to the right place after connecting.

Once those env vars are set and the backend is restarted, "Connect
Outlook" in Settings will work. Disconnecting removes the stored tokens
but doesn't delete any calendar events already created.

## Training calendar

The **Calendar** tab is the app's landing page — it's what loads first
after logging in. It's for scheduling ahead across a detailed workout
taxonomy: Strength, Swim, Golf (Range / Round / Short Game / Putting),
Run (Recovery / Tempo / Fartlek / Intervals / Long Run), Walk (Walk /
Hike), Cycling (Easy / Long / Hills), Cycling - Turbo (Easy / Long /
Hills), and Rest Days. This is a scheduling list, not a full tracker:
none of these besides Strength have logging/data-model support yet (see
"Not built yet" below) — you're marking planned sessions done, not
recording pace, distance, or scores (time, covered below, is the
exception).

7 days are always shown at once as day-by-day blocks below the weather
strip — each with that day's temperature range and condition inline, and
whatever's scheduled underneath, so a full week's plan is visible in one
view rather than scrolling through a flat list. Adding a session happens
directly in the day it belongs to: each day has a **+ Add workout**
button that expands into the same category/sub-option/time/notes form
used everywhere else, with that day's date already fixed — there's no
separate top-level scheduler to pick a date in first. A day with nothing
scheduled just shows "Nothing scheduled" until you add something, rather
than being skipped, so gaps in the week are as visible as what's already
planned.

### AI-generated golf practice sessions

When scheduling (or editing) a Golf Range, Short Game, or Putting
session, a "Suggest a session (AI)" button generates a structured
practice plan — specific drills with instructions and time allocations,
summing to roughly the session's expected length — and fills it straight
into the notes field. Golf Round is deliberately excluded: a round isn't
a practice session to generate drills for.

This uses the same Claude-based approach as the strength Workout tab
(`backend/src/services/golfPlanner.ts`), but with much thinner input:
the app doesn't track golf scores, shots, or handicap as structured data
(see "Not built yet"), so it reasons over whatever text is in session
notes rather than a real stats profile.

#### The feedback loop

Two things feed into each suggestion, both weighted explicitly in the
prompt:
- **Your last 3 completed sessions of that same type** — the most
  recent one is called out as the strongest signal, so if its notes say
  "still pulling short putts left," the next Putting session is built to
  address that.
- **Your last 2 completed rounds' notes** — if a round's notes point to
  a relevant weakness (e.g. a Putting session following a round with
  poor putting), that gets factored in too.

#### Why there's no automatic Arccos import

Arccos doesn't offer a public API — this isn't a matter of scope, it's
that the integration Strava-style OAuth connect (see that section above)
depends on doesn't exist for Arccos. The only ways to pull Arccos data
programmatically today are: an unofficial, reverse-engineered client that
requires your actual Arccos email and password (not a revocable OAuth
token — a real security downgrade this app won't implement), or a
private partner API Arccos grants case-by-case to companies with a
business agreement, not something a personal project can get access to.

**The practical workaround**, and the reason the feedback loop above
matters: paste the key stats or takeaways from Arccos's own app into a
round's notes after playing (the notes field hints at this — "e.g. paste
key stats from Arccos: SG putting, GIR, up-and-down rate"). Claude reads
that text directly when generating your next practice session, so the
insight still flows through, just via copy-paste instead of an API call.
If Arccos ever opens a public API, a real OAuth-based sync (like the
Strava one) would be a natural next step.

### Scheduling: category, then sub-option

The "schedule a session" form (and editing an existing session) uses a
two-step picker for every category that has sub-options — Golf, Run,
Walk, Cycling, and Cycling - Turbo — the same pattern Strength already
used for Push/Pull/Legs/Core: pick the top-level category first (e.g.
Golf), and a second dropdown appears with just that category's specific
options (Range/Round/Short Game/Putting). Strength, Swim, and Rest Day
don't need a second step since they aren't split into sub-options.

### Choosing which workout types show up

Settings has a **Calendar workout types** checkbox tree — top-level
checkboxes for Strength, Golf, Run, Walk, Cycling, Cycling - Turbo, and
Swim, with Golf/Run/Walk/Cycling/Cycling-Turbo expanding into their
specific sub-options. Unchecking a type hides it from both the "schedule
a session" dropdown and the day view — any already-scheduled sessions of
that type just stop showing up, they aren't deleted, and reappear if you
re-check the box later. A top-level checkbox toggles all its sub-options
at once (and shows an indeterminate state when only some are checked).
Rest Day isn't part of this list — hiding rest days as a "workout type"
wouldn't make sense, so it's always available. Everything is visible by
default for a new account.

The ‹ / › buttons above the week jump a full 7 days back or forward, so
you can plan several weeks ahead or look back at previous weeks — "Back
to this week" jumps straight back to today's window. Every scheduled
session has an **Edit** button that opens the same fields used to create
it (date, type, movement pattern, expected time, notes), so a session can
be moved to a different day, changed to a different type, or have its
estimate corrected, without deleting and recreating it.

### Scheduled vs. actual time

Every non-rest session gets an expected duration when scheduled (the form
suggests a per-type default — e.g. 60 min for strength, 240 min for a golf
round — editable before saving). A summary above the 7-day view totals
this up: how many sessions are scheduled, total planned time, and how
many rest days. Rest days are deliberately excluded from every time
total — they're not "0-minute workouts," they're the thing scheduled time
is balanced against.

Once a session is actually done, its real duration can be recorded two
ways, right on the session card:
- **Manually** — type minutes in, tap "Log time."
- **From Strava** — if connected (see below), "Sync from Strava" shows
  activities recorded on that session's date, and picking one fills in
  the actual time (and marks the session complete) from the activity's
  real moving time, no typing required.

Once a session has an actual time, the card shows it with its source
("entered manually" or "from Strava") instead of the entry controls — the
running actual-time total in the weekly summary picks it up automatically.

### Strava sync

Connect from **Settings**. This uses Strava's own OAuth API — each
account connects independently, so one person's Strava activities are
never visible to another user of the app. Once connected, "Sync from
Strava" on any non-rest session looks up that user's activities on the
session's calendar date and lets them pick which one to link.

**One-time setup required** (same shape as the Outlook setup below — you
need to do this yourself):

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
   and create an API application (any name/website works for a personal
   project).
2. Set the **Authorization Callback Domain** to match your backend's host
   (just the domain, no protocol/path — e.g. `localhost` for local dev, or
   your deployed backend's domain).
3. Copy the **Client ID** into `STRAVA_CLIENT_ID` and the **Client
   Secret** into `STRAVA_CLIENT_SECRET` in `backend/.env`.
4. Set `STRAVA_REDIRECT_URI` to
   `http://localhost:3001/integrations/strava/callback` for local dev, or
   your deployed backend URL's equivalent.

Without this configured, the Calendar tab still works for scheduling and
manual time entry — "Sync from Strava" just won't appear.

### Weather forecast

The 10-day weather strip above the 7-day planner looks a bit further out
than the planning window — each day shows condition, temperature range,
rain chance, and wind, with a quick OUTDOOR OK / GO INDOOR call based on a
simple rule (under 30% rain chance and under 25mph wind). Any scheduled
walk, run, outdoor ride, golf range session, or round that lands on a day
the forecast doesn't favor gets a warning inline in its day block.
Strength days, rest days, and the turbo trainer are indoor regardless, so
they're never flagged.

**This uses Open-Meteo, not weather.com's actual API** — weather.com
(IBM/The Weather Company) requires an enterprise agreement that isn't
available for a personal project. Open-Meteo is free, needs no signup,
and gives the same real 10-day forecast data.

**Location comes from the device, not a fixed server setting.** Opening
the Calendar tab triggers the browser's native location permission
prompt — allowing it sends your actual coordinates with the forecast
request, so the 10-day outlook (and its day boundaries/timezone) match
wherever you actually are, not a location fixed in the backend's config.
This also matters because the app is multi-user: a single server-side
location wouldn't make sense once different people are using it from
different places.

If location access is denied or unavailable, there's a "Try again"
button to re-prompt, and the backend falls back to `LOCATION_LAT` /
`LOCATION_LON` in `backend/.env` if those are set (decimal degrees —
search "[your town] latitude longitude" if you need them). That fallback
is really only useful as a single default for local development; for a
real multi-user deployment, device location is the mechanism that
actually works per-person. Without either device location or the env
fallback, the Calendar tab still works for scheduling, it just shows a
message instead of the forecast strip.

## 3-month training plan

A new **Plan** tab, alongside Calendar — a Scheduler capability (it
balances and schedules across sports rather than adding coaching depth to
any one of them, so it lives in `backend/src/scheduler`, not `sport`). It
walks through four steps:

1. **Priorities.** Pick which sports (of the 7: Strength, Golf, Run, Walk,
   Cycling, Cycling - Turbo, Swim) are in scope for the next 3 months, a
   priority (Low/Medium/High) for each, an optional per-sport goal (e.g.
   "add 20lb to my back squat", "break 90"), an optional weekly time
   available for that sport (hours/minutes), and an optional overall goal
   for the quarter. The weekly time figure is a hard ceiling, not a
   suggestion — it constrains what Claude proposes in the next step.
2. **Per-sport approach.** Claude proposes, for every prioritized sport
   together in one call (so the total weekly load stays realistic instead
   of each sport being sized in isolation), a short narrative approach —
   phasing, focus, how it should progress — plus a weekly session count and
   a typical session length, plus **phased milestones**: the 12 weeks broken
   into roughly 3 phases, each with a short label and a specific, measurable
   target (a number, time, distance, or skill check tied to the sport's
   stated goal — e.g. "Weeks 1-4 — Base building: Squat 3x5 @ 185lb" through
   to a final-phase target that visibly moves the needle on the goal). Where
   a weekly time-available figure was given, session count × session length
   is kept at or under it. Each approach is reviewed individually: approve
   as-is, or edit the text/count/length/milestones (which counts as
   approving it). Every sport must be approved before moving on.
3. **Weekly schedule.** Once every approach is approved, the person builds
   their own schedule — not Claude. An earlier version had Claude propose
   the whole week's day/time layout, but that didn't place sessions the way
   people actually wanted, so placement was handed back to the person: for
   each session Claude's approach called for (e.g. "3 Strength sessions,
   45 min each"), pick a day of the week and a time of day
   (Morning/Afternoon/Evening), and optionally a specific sub-type (like
   which Strength movement pattern) and exact minutes. A live grid shows
   total planned time per day as you go, and flags two sessions placed at
   the same day/time or a placement that falls inside a scheduling
   constraint (see below) before you can save. This is a *template*, not
   dated sessions; the Calendar tab's day-by-day scheduling is still the
   place actual sessions get put on specific dates. Approving the saved
   schedule activates the plan.
4. **Scheduling constraints.** Free-text limitations like "I can't train
   mornings on office days, Tuesday and Thursday" are parsed by Claude into
   structured days-of-week + blocked times-of-day (common phrases like
   "office days" default to Mon–Fri, "weekends" to Sat/Sun, unless specific
   days are named), with a one-line explanation shown back so a misreading
   is obvious and correctable. Adding a constraint immediately checks it
   against the current framework; any conflicting slot gets a short list of
   move options (same day/different time-of-day first, then the nearest
   day at the same time-of-day, then any other free slot) — picking one
   just moves that slot. That matching logic is plain deterministic code,
   not another AI call, since it's really a constraint-satisfaction lookup
   over a 7×3 grid.

Starting a new plan archives the previous one (only one plan is "current"
per account at a time — `GET /plan/current`), and the account data
export/deletion endpoints cover training plans the same way as everything
else. Since this adds new tables, an existing install needs to run the
migration once: `cd backend && npx prisma migrate dev --name add_training_plan`.
(If you'd already run that migration from an earlier version of this
feature, the framework-versioning/dashboard changes need one more:
`npx prisma migrate dev --name add_plan_amendments_dashboard`, and the move
away from AI-driven scheduling to the manual schedule builder needs a third,
for the new `weeklyMinutesAvailable`, `sessionMinutes`, and
`estimatedMinutes` fields: `npx prisma migrate dev --name manual_schedule_builder`.)

### Amending a plan mid-cycle

Once a plan is ACTIVE, its framework isn't frozen for the rest of the 3
months — the same Plan tab has a "Request a plan amendment" box, where a
free-text request ("cut running back to twice a week and add a second golf
short-game session") is sent to Claude along with the current approaches.
It comes back with a short summary of what changed and updates to just the
sports affected (weekly session target, session length, and/or approach
text — everything else is left alone). Claude only ever touches this
*content*; it never touches the day/time schedule. If an amendment changes
how many sessions a week a sport calls for, the placed schedule for that
sport no longer matches session-for-session, so the Plan tab flags it and
offers to reopen the schedule builder to place the new session count.

Under the hood the schedule itself is still versioned rather than a
straight overwrite: saving a schedule change against an ACTIVE plan closes
the current `FrameworkVersion` (sets its `effectiveTo`) and opens a new one
from that moment, via the same `PUT /plan/:id/framework` endpoint used to
build the schedule the first time. That's what lets the dashboard (next
section) show two honest answers to "how am I doing" once a plan's schedule
has changed — how it looks against the plan as it was originally, and how
it looks against the plan as it now stands, crediting whatever was actually
done under each version while it was in effect. Saving a schedule before
activation doesn't create this history — there's no progress yet to
preserve, so it just replaces the one version's slots in place.

## Consistency dashboard

A Plan/Dashboard toggle appears once a plan has a framework. The dashboard
shows two rolling periods:

- **This week** — the most recent Sunday through today.
- **Last 30 days** — or, if the plan started more recently than that, since
  the plan's start date (labelled accordingly, so the shorter window isn't
  mistaken for an incomplete month).

For each period it shows an overall consistency percentage and rating
(Excellent/Good/Building/Needs attention), total sessions completed vs.
planned, and total hours/minutes completed — broken down per sport, each
expandable into its sub-types (Push/Pull/Legs/Core for Strength; the
specific Run/Golf/Walk/Cycling/Cycling - Turbo sub-type where the framework
or the logged session specifies one; Swim has none, being a single leaf
type). Consistency is computed as planned-vs-completed *counts* within the
period per sport (capped at 100% per sport so over-training one sport can't
mask under-training another), not day-by-day matching — doing Tuesday's
planned run on Wednesday still counts as done. Only `completed: true`
Calendar sessions count, and their minutes come from actual logged time if
present, falling back to the estimate otherwise.

If the plan has been amended, a toggle above both period cards switches the
whole dashboard between "Against amended plan" (the honest, as-it-actually-
went view: whichever framework version was in force on each day) and "As
originally planned" (a counterfactual — what consistency would look like if
the original framework had run the whole period, ignoring the amendment
entirely). Periods before any amendment look identical either way; the two
only diverge once an amendment's date range falls inside the period being
viewed.

One known simplification: period boundaries are computed from a `today`
date the frontend passes as a local `YYYY-MM-DD` (the same
`formatLocalDateKey` helper the Calendar tab already uses to dodge UTC
date-parsing bugs), but the framework-version cutover and the underlying
session-date comparisons happen on the server using its own timezone. For
a single-user personal deployment this is unlikely to matter, but it's
worth knowing about before relying on the dashboard right at a day boundary.

## Admin area and in-app messages

An owner-only page (Settings → **Admin**) for looking after the app's users.

- **Who is an admin:** set `ADMIN_EMAILS` on the backend service in Railway to a comma-separated list of emails (for example `ray.zabarte@gmail.com`), then redeploy. Nobody else can see the page, and an admin must have 2FA switched on to use it.
- **Users:** everyone who has signed up, with join date, last seen, workouts logged and 2FA status, plus counts for new and active users in the last 7 days. Only account basics and counts are shown: no training, body, nutrition or consent data.
- **Suspend / reinstate:** blocks login and every API call straight away (and the Apple Health upload token), keeping the data. Reinstate undoes it.
- **Delete:** permanent; the admin types the person's email to confirm. Same effect as the person deleting their own account.
- **Messages:** write a title and message to everyone or one person. It appears as a card at the top of their Calendar until they dismiss it or it expires (default 2 weeks). You can see how many people dismissed it and withdraw it.
- **Activity log:** every suspend, reinstate, delete and message is recorded with who did it.
- "Last seen" is updated at most once an hour whenever a signed-in account uses the app.
- Admin accounts can't be suspended or deleted from this page.
- Messages only reach people when they open the app. Phone push notifications are not built.

Upgrade note: adds a migration (`20261016090000_admin_and_messages`) that runs with the usual `prisma migrate deploy`.

### Feature-use tracking

Admin → **Feature use** shows, for the last 30 days, how many people used each feature, how many uses, and how many this week. It is totals only; admins can't see who used what.

- **Consent first:** nothing is recorded unless the person ticked "Help improve the app" (Settings → Privacy & consent). The wording was changed to say what is collected, so earlier answers given under the old wording ("nothing is collected today") don't count: people need to turn it off and on again, or answer it fresh at sign-up.
- **What is stored:** a feature name from a fixed list (`USAGE_EVENTS` in `backend/src/services/usage.ts`) and a time. Never anything the person entered.
- **Deleted** with the account, when consent is withdrawn, and after 12 months. Included in the data export.
- **Adding a feature to track:** add its name to `USAGE_EVENTS` and to the `UsageEventName` type in `frontend/src/lib/api.ts`, call `track("name")` where it happens (or wrap the api method in `tracked(...)`), and add a label in `Admin.tsx`.

Upgrade note: adds migration `20261016120000_usage_events`.

## Golf rounds and a quarterly goal

Log → **Golf** (switch Golf on under Settings → Workout types if you can't see the tab) starts with a Rounds section.

- **Log a round:** date, course (suggests ones you've used), 9 or 18 holes, optional score and notes. Edit or delete later. If a Round was planned on the calendar for that day, it is ticked off.
- **Quarterly goal:** pick a calendar quarter (the next one, this one, or the last three) and set how many rounds to play. Every round counts as one, whether 9 or 18 holes. You see rounds done, rounds to go, days left, about how many a week you still need, and whether you're on track.
- **Scores:** average and best score are worked out from 18-hole rounds that have a score.
- **Strava:** with Strava connected (Settings → Connections), Golf activities (for example from a Garmin watch) are added automatically when you open the Rounds section, at most every 10 minutes, or straight away with **Sync now**. Strava doesn't give the course, holes or score: the activity name is used as the course, rounds under 2.5 hours are taken as 9 holes, and the score is left blank. Tap **Edit** to fix any of it and add the score.
- A round you logged by hand for the same day is matched to the Strava activity, not counted twice. Logging a round by hand for a day that already has a Strava round is refused: edit the Strava one instead.
- Deleting a Strava round hides it, so the next sync doesn't bring it back.
- Rounds and goals are included in the data export and deleted with the account.

Upgrade note: adds migrations `20261017100000_golf_rounds` and `20261017120000_golf_rounds_strava`.

## Ambitions and sport goals

At the top of **Progress → Goals**.

- **About you and your ambitions:** a few sentences (up to 600 characters) on who you are and what you want from sport or exercise. When you save, any sport it mentions that isn't switched on (golf, running, swimming, cycling, walking, strength and so on) is offered with a **Switch on** button, which ticks all of that sport's workout types, the same as Settings → Workout types (also linked). The matching is plain word matching on the server; the text isn't sent to the AI or anywhere else.
- **Sport goals:** for each switched-on sport, a sentence or two (up to 300 characters) on what you want from it. It's shown next to **How it's going**: sessions completed (workouts logged for Strength) in the last 90 days, about how many a week, compared with the 90 days before, plus time trained. Golf also shows rounds played and best and average 18-hole score, with a link to the rounds log. A goal written over 3 months ago is flagged for a second look.
- Both are free text, stored in your account, included in the data export and deleted with the account. Clearing a box and saving removes it.

Upgrade note: adds migration `20261017210000_ambitions`.

## iPhone / Safari polish

Beyond the responsive layout itself, a few iOS-specific fixes are baked in:

- Every text input/select is held at 16px minimum, which stops Safari's
  auto-zoom-on-focus behavior (it triggers on any input under 16px).
- The header and bottom nav use `env(safe-area-inset-*)` padding so
  content isn't hidden behind the notch/Dynamic Island or the home
  indicator when the app is added to the home screen (standalone PWA
  mode uses `black-translucent` status bar styling, which draws content
  under the status bar unless this padding is added).
- `overscroll-behavior-y: contain` stops the whole page rubber-banding
  when scrolling past the top; the weather strip's horizontal scroll uses
  `-webkit-overflow-scrolling: touch` for proper momentum scrolling.
- Buttons use `touch-action: manipulation` to remove the ~300ms tap delay
  and stray double-tap-zoom; tap highlight flash is disabled globally for
  a more native feel.
- A separate `apple-mobile-web-app-title` meta tag sets the home-screen
  icon label — Safari doesn't read the PWA manifest's `short_name` for
  this the way Android does.

## Not built yet (intentionally, for later)

- Nutrition UI (schema exists, no routes/pages yet)
- Full cardio and golf tracking (distance, pace, heart rate, scores) — the
  Calendar tab only schedules and marks these done; see the earlier
  conversation about Strava import for how cardio data would eventually
  flow in automatically
- Recommendation history / trend charts

## Weekly time (Settings → Weekly time)

Each person records how long they can usually train on each day of an average
week (15-minute steps, up to 12 hours a day) plus an optional note. It is
stored in `WeeklyAvailability` (`minutesByDay`, index 0 = Sunday) and read via
`getAvailability()` in `backend/src/services/availability.ts`, which also
reports whether it has been set. The 7-day workout proposal will combine it
with the sport ambitions (`services/ambitions.ts`). It is included in the data
export and removed with the account.

## Golf week proposal (Calendar → Plan → Golf practice)

Shown in the Calendar's Plan section when Golf is switched on. `POST /golf/week { from }`
(`sport/services/golfWeek.ts`) asks Claude for 2 to 4 practice sessions across
the next 7 days. Inputs: the notes on the last few rounds (`GolfRound.notes`,
last 75 days; a round is never counted as practice history, only its notes
are read, and its score is not sent), the last six completed range, short
game and putting sessions with their notes, the golf ambition, and the free
minutes each day (Weekly time less anything already planned). Weak driving or
approach play leads to a range or home (garage) session on those shots, weak
short game to a short-game session, weak putting to a putting session.
Whatever the model returns is trimmed to fit (`cleanProposal`): dates inside
the window, one session per day, never longer than that day's free time. Nothing is
saved until the person ticks sessions and adds them (through `POST /calendar`,
with the drills in the session notes, like the single-session suggestion).

## Automatic Strava sync (Calendar)

Opening the Calendar runs `POST /calendar/strava-sync` (at most every 5
minutes per person; the "Sync Strava" link forces it). It reads the last 14
days of Strava activities (`scheduler/services/stravaImport.ts`) and, for each
one not seen before:

- a planned session the same day in the same sport and not yet done is
  completed, with the activity's moving time as the actual time;
- otherwise a new session is recorded as planned and completed.

Mapping: Run/TrailRun/VirtualRun → run (Strava long run or 75+ min → Long run,
Strava "workout" → Intervals, else Recovery); Walk → Walk; Hike → Hike;
Ride/Gravel/MTB/E-bike → Cycling (Long from 2 h, else Easy); VirtualRide →
Cycling - Turbo; Swim → Swim. Golf is handled by the golf rounds importer;
weights and other types are ignored. Every activity handled is remembered in
`StravaImport`, so deleting a session doesn't bring it back, and activities
already linked by hand are left alone. The session type can be edited after.

## Golf practice as a checklist

A golf practice session (range, short game, putting) now carries its drills as
`PlannedSession.drills` (`[{ name, detail, minutes, done, comment }]`). On the
Calendar card, and under Log → Golf, each drill has a tick like a strength set
and a comment box; changes save immediately, and ticking the last drill marks
the session done. `notes` stays free text for the overall session. Sessions
made from "Suggest a session (AI)" or the golf week proposal get their drills
this way; older sessions keep the plan as text in the notes. Drill ticks and
comments are fed back into the next suggestion and the next week's proposal, so
unfinished drills and "pulled the 7-iron left" shape what comes next.

Log → Golf (`components/GolfPracticeLog.tsx`) shows the next unfinished
practice session laid out like the strength log: a header card (saved status,
progress, focus), then a card per drill with a numbered row (comment, ✓ button)
and a 1–10 "Feel" row like RPE, then "Finish practice". The Calendar card keeps
the simpler checklist. Feel scores go to the next suggestion along with ticks and comments.

## Golf level, shot shaping and the bag (Settings → Golf)

- **Handicap** (`GolfProfile.handicap`, with a history in `GolfHandicapEntry`
  each time it changes) sets how the coach pitches practice: fundamentals and
  simple targets for high handicaps, precision and scoring games for low ones.
- **Can you shape the ball?** (`canShapeShots`, yes/no). Anything but "yes",
  including not answered, means no shot-shaping drills; practice adds
  consistency work from the person's comments and round notes instead.
- **Clubs** (`GolfClub`: name and type). Each drill names one exact club, which
  can be changed in Log → Golf ("Club used"). Over the last 90 days the coach
  sees which clubs were practised and gives the never-practised ones priority.
- Rules, in `sport/services/golfBag.ts`, are both put in the prompt and enforced
  on the answer (`checkDrill`): range uses driver, woods, hybrids, irons and
  wedges but never the sand wedge or putter; short game uses wedges, sand wedge
  and irons (bunker drills need the sand wedge or another wedge); putting is the
  putter only; shot-shaping wording is dropped unless the player can shape.

## Installing the app

Settings → "Install the app" (hidden once installed) and a dismissible card on
the phone Calendar. Chrome, Edge and Android get a one-tap **Install the app**
button (the `beforeinstallprompt` event, caught in `lib/install.ts`, imported
from `main.tsx`). iPhone and iPad have no install prompt, so the card shows the
Share → Add to Home Screen steps. The home screen icon is
`public/apple-touch-icon.png`. There is deliberately no service worker, so the
installed app always loads the latest deploy.

## The Calendar's Plan section

One collapsible "Plan" section (`components/PlanPanel.tsx`) holds every planner.
Each is a row (title, one line on what it does, a button) with its result
opening beneath it: **Plan strength** lays out this week's strength sessions;
**Plan golf practice** builds the next 7 days of range, short game and putting.
Rows only appear for workout types switched on in Settings. To add another
workout type, push a `Planner` onto the `planners` list in `pages/Calendar.tsx`.

## Weather location

`getLocation()` in `lib/location.ts`: if location is already allowed for the
site (checked with the Permissions API), the current position is used on every
load, with no prompt. Otherwise the last position is reused from the device
(`localStorage`, rounded to about 1 km, valid 30 days) so Safari isn't asked on
every visit; the browser is only asked the very first time, or when "Update
location" / "Try again" is tapped. A browser can't be made to give a position
without permission; setting Safari → Settings → Websites → Location to Allow
for the site is what makes "always current, never asked" work.

## Indoor golf simulator sessions

A new session type, `GOLF_SIMULATOR` ("Golf → Simulator" in Settings → Workout
types and the Calendar; existing golf users have it switched on by migration).
The Calendar's Plan section gets a **Golf simulator** row (when that type is on)
that proposes simulator sessions for the next 7 days (`POST /golf/week` with
`mode: "simulator"`), and "Suggest a session (AI)" works for it on a single
session. Drills use launch-monitor style work (gapping, dispersion, target
games, skills challenges), never bunker shots or a putter.

Settings → Golf → **Indoor golf simulator** sets the longest club that fits the
space ("No restrictions", or any club in the bag, `GolfProfile.simulatorLongestClub`).
Clubs are ordered by length (`clubRank` in `sport/services/golfBag.ts`: driver,
woods, hybrids, irons, wedges; by the number or loft in the name); simulator
sessions only use the chosen club and shorter ones, in the prompt and enforced
on the answer. Settings shows which clubs that leaves.

## Editing and ordering the bag

Each club in Settings → Golf has Edit (name and type) and Remove. The bag is
always listed longest to shortest by loft (`estimatedLoft` in
`sport/services/golfBag.ts`): degrees in the name win ("Gap wedge (50°)",
"52 wedge"), otherwise the typical loft for the number (7 iron ≈ 34°, 3 wood
≈ 15°, 4 hybrid ≈ 22°) or name (pitching 46°, gap 50°, sand 56°, lob 60°); the
putter goes last. Renaming a club re-sorts it, and carries over to the
simulator's longest-club limit and to the club recorded on past drills
(`PATCH /golf-bag/clubs/:id`). Typing a name picks the type ("7 iron" → Iron).

## Injuries and niggles on the strength build screen

Log → Strength has an "Injuries or niggles" box above the session buttons (kept on the device until cleared). It is sent with the build request and only shapes how exercises are done: the session is never cancelled and sets, reps and weights follow the usual progression. Each exercise that stresses the named area comes back with a one-sentence "Adjusted for your niggle" variation (for example a neutral grip, a lower incline or stopping short of overhead); unaffected exercises are unchanged.

## Golf practice sessions per week

Settings → Golf has a "Golf practice sessions per week" selector (1 to 5, default 2), set out like strength days per week. Calendar → Plan → Golf practice (and Golf simulator) aims for that many sessions in the next 7 days. Practice sessions already on the calendar in that window (range, short game, putting or simulator) count towards the target and are kept, so the proposal only fills the gap, and it still fits each session into the free time from Settings → Weekly time. Stored as `GolfProfile.practiceSessionsPerWeek` (migration `20261018190000_golf_practice_sessions_per_week`, a plain column add with a default).

## Run planning (Calendar → Plan → Running)

Settings → Training has **Runs per week** (2 to 6, default 3), set out like strength days per week (`User.runDaysPerWeek`, migration `20261019090000_run_days_per_week`, a plain column add with a default). Calendar → Plan → Running lays out the next 7 days (`POST /calendar/run-plan`, `scheduler/services/runPlanner.ts`). It is deterministic, with no AI call, like strength auto-fill.

**The periodised plan follows the calendar quarter** (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec) as 13 weeks, and the 7 days take the week most of them fall in:

| Weeks | Phase | Focus |
|---|---|---|
| 1-3, 4 lighter | Base | easy running, light fartlek, a growing long run |
| 5-7, 8 lighter | Build | tempo (threshold) runs and fartlek |
| 9-11 | Peak | intervals at 5k effort, tempo, the longest long run |
| 12 | Taper | less volume, a little intensity (intervals) |
| 13 | Reset | easy running, fartlek, optional 5k test |

Principles it applies: mostly easy running with one or two quality sessions besides the long run (80/20), the long run growing about 10% a week at most, a lighter week every fourth week, hard sessions never on back-to-back days, and an easy day before the long run. The run types come from the sub-types under Run (Recovery, Tempo, Fartlek, Intervals, Long run); a week with n runs takes the first n of the phase's list. Session lengths start from your longest completed run in the last 6 weeks (Strava runs count), or modestly if there are none, and are cut to fit the free time from Settings → Weekly time. The long run goes on a weekend day when it can. Runs already on the calendar (including Strava ones) count towards the target and are kept; earlier auto-planned runs not yet done are replaced; a rest day the app planned itself gives way to a run. Strength auto-fill no longer clears auto-planned runs.

## Golf practice is one planner, with the simulator as one of its types

The separate "Golf simulator" row in Calendar → Plan is gone. There is one **Golf practice** planner (`POST /golf/week { from }`, no mode), and the AI proposes a mix of the practice session types: range, short game, putting and, when Simulator is switched on under session types, indoor simulator. It chooses the simulator where its data helps (distance control, dispersion, approach and driving numbers) or where outdoor practice is unlikely to suit, and the other types where turf, bunkers, putting or outdoor ball flight matter. The sessions-per-week target still counts all of them, simulator sessions still respect the longest-club limit in Settings → Golf, and sessions already on the calendar still count. No database change.

## Steps import hardening

The iPhone Shortcut import (`POST /ingest/steps`) is more forgiving: the date can carry a time or be in the phone's own format, the token header is accepted in any case with stray quotes or a repeated "Bearer", and `GET /ingest/ping` checks the token and consent without sending data. A day's imported steps only ever go up, so a late or empty run (iPhone Health can't be read while the phone is locked) never overwrites steps already received. Rejections are logged on the server (never the token). Settings → Data import shows the last steps received and when. The server also trusts Railway's proxy, so rate limits are per visitor rather than shared.

## Sign-up fixes

After a report that someone couldn't create an account: a wrong 2FA code at the end of sign-up no longer clears the new session (that left the account created but impossible to finish, and a second try then said "already exists"); 2FA codes can be pasted as "123 456"; emails are trimmed and compared without regard to case (phones capitalise the first letter and add a trailing space), including at login and password reset; the sign-up form is its own screen with a repeat-password box and clear messages; if the 2FA step fails to load the account is kept and the person is told to log in and turn 2FA on in Settings; and a database error during registration now answers with a message instead of hanging.

## Optional 2FA

2FA is the person's choice. After sign-up they pick "Set up 2FA" or "Skip for now" (and can skip from the QR screen too). Settings → Security shows whether it is on: off, it offers "Turn on 2FA" (QR code, then a code to confirm); on, it offers "Turn off 2FA", which needs the password and a current code (`POST /auth/2fa/disable`). Setting up again while 2FA is on is refused, so nobody can swap the authenticator from a borrowed session or be locked out by an abandoned replacement; turn it off first. Admin accounts can't turn 2FA off, because the admin area needs it.

**Lost authenticator.** Admin → Users shows "Turn off 2FA" on any account that has it (`POST /admin/users/:id/reset-2fa`, recorded in the audit log). It clears the secret and signs out the person's trusted devices. They then use "Forgot password" on the login screen (a reset link doesn't remove the code step by itself), log in without a code and turn 2FA back on in Settings → Security. There are no recovery codes. No database change.

## Lost authenticator (admin / owner)

Admin accounts can't be changed from the Admin page and can't turn 2FA off themselves (the admin area needs it), so a lost phone is recovered from the server settings, the same place that decides who is an admin.

1. In Railway, open the **backend** service → Variables and add `ADMIN_2FA_RESET` = `your-admin-email:any-note` (for example `ray@example.com:lost-phone-oct-2026`). The email must be in `ADMIN_EMAILS`.
2. Redeploy or restart the backend. On start-up it switches 2FA off for that account, signs out its sessions and trusted devices, and writes `reset-2fa-env` to the audit log. The Railway log shows `[recovery] 2FA switched off for ...`.
3. Log in with the password only. If the password is lost too, use **Forgot password** on the login screen first (it emails a link, and a reset doesn't remove the code step, which is why step 1 comes first).
4. Turn 2FA back on in **Settings → Security**, then remove `ADMIN_2FA_RESET`.

Each distinct value works once, so leaving the variable in place doesn't switch 2FA off again on every restart. To do it again, change the note. For other users the Admin page already has **Turn off 2FA** (see Optional 2FA). No database change.

## Welcome journey (new accounts, and Settings → Planning)

New accounts, after the consent step, go through a four-step journey. It can be skipped at any point ("Skip setup") and every question in it is optional.

1. **Goals in prose.** Three free-text questions: what you want from training, anything specific you're aiming for (an event, a number, a date), and what a normal week looks like. The answers are sent to Claude, which suggests the settings below as JSON (`services/onboarding.ts`; the screen says so). Nothing is saved at this point. If the AI call fails, plain word matching still ticks the sports mentioned, so the journey never depends on it.
2. **Sports.** The sports the answers pointed to are pre-ticked, each with a priority (main focus / regular / keep ticking over) and an optional goal sentence. A sport's goal sentence is saved as its "ambition" (shown with your progress), and the overall aim goes to Progress → ambitions and to the plan.
3. **Weekly rhythm.** Sessions a week for strength, running and golf practice (the same settings as in Settings, and used by the same planners), and an optional daily step goal.
4. **Horizon.** The plan starts today and ends either on the **suggested calendar-quarter end** or on **a date you choose**. The suggested end is the end of the current quarter if at least 8 weeks of it remain (so a full 3 months, or the part that's left), otherwise the end of the **next** quarter. A chosen date must be 2 weeks to 18 months away. If the answers named an event date, it is pre-filled as the chosen date. The rule lives in `scheduler/services/horizon.ts`.

"Build my plan" (`POST /onboarding/start`) saves only what was confirmed: it turns on the workout types for the chosen sports (the first time through it shows exactly those; later runs only add; the golf simulator stays a separate opt-in), saves the settings, and opens a training plan in DRAFT. The AI then proposes an approach per sport for the plan's real length, using the sessions a week already set in Settings, and the person lands on the plan screen to review it, approve it and set the weekly framework as before.

Accounts that existed before this update are marked as done (migration `20261024210000_onboarding`), so only new accounts see it automatically. Everyone can run it again from Settings → Planning → "Set up goals and a new plan", which replaces the current plan. `POST /plan` (the manual route on the plan screen) now uses the same quarter-end rule instead of a fixed three months.

## Weekly pattern and "Plan my week"

The plan's weekly pattern (the schedule step after the approaches are approved) is only a **sport, a day and the minutes available** for each session. There is no workout type, movement pattern or time of day to pick; a time of day is worked out on save (the first free one that day that your constraints don't block, up to three sessions a day). Older schedules that include those details still work.

Calendar → Plan → **Week from your training plan** → "Plan my week" turns that pattern into the next 7 days of real workouts (`POST /calendar/week-plan`, `scheduler/services/weekFromPlan.ts`). What each session *is* comes from what has been done so far:

- **Strength** continues the split's rotation from the last strength day trained (logged or completed), spread over the pattern's days.
- **Running** takes the run types for this week of the quarter's periodised plan (long run, tempo, fartlek, intervals, easy runs), fitted onto the days in the pattern with the usual rules (no back-to-back hard days) and capped at the slot's minutes. Run length builds from your longest recent run.
- **Golf, cycling, turbo, walking, swimming** rotate through their session types, taking the one done least in the last 4 weeks first. The longest slot becomes the long ride / hike, and a golf slot of 3 hours or more a round. The golf simulator is only used if it's switched on.

Sessions the app planned earlier that haven't happened are replaced; anything you added or changed stays, and its day's slot is left alone. Days outside the plan's dates are skipped, and the result also shows how many sessions have been done against what the pattern called for so far (it informs; it doesn't pile the missed sessions onto later weeks). The per-sport planners (strength auto-fill, running, golf) still work on their own.

## If Railway deployments stop or pause

This happened after Railway's platform outage of 21-23 October 2026 (see status.railway.com). GitHub's commit status shows each service's last deploy (`gh api repos/<owner>/<repo>/commits/<sha>/status`), which tells you whether the problem is Railway or the code.

1. In Railway, open each service (the backend and the frontend) → **Deployments**. Services that were stopped or removed during an incident don't restart on their own. On the newest deployment choose **Redeploy**, or press Ctrl/Cmd+K and choose **Deploy Latest Commit**. Variables, domains and settings are kept.
2. Under **Settings → Source**, check the repo, that the branch is `claude/strength-app-258-setup-l7wuii`, and that **Automatic deployments** is on. If pushes still don't deploy, disconnect and reconnect the repo, and check in GitHub (repo Settings → Integrations → GitHub Apps) that the Railway app still has access.
3. Check **Workspace settings → Billing** has an active plan; a cancelled one also stops services.
4. Anything using a Railway API token needs a new one if the incident invalidated it.
5. Check the backend at `<backend url>/health`, which should answer `{"ok":true,...}`. The backend runs pending database migrations as it starts.
