# Running Complete Fitness Coach on your computer

A step-by-step guide for complete beginners. It works on **Mac** and **Windows**.
Plan on about 30–45 minutes the first time. After that, starting the app takes
about 30 seconds (see [Starting the app again later](#starting-the-app-again-later)).

## What you're setting up

The app has three parts. All three run on your own computer:

| Part | What it does | Where it runs |
|---|---|---|
| **Database** (PostgreSQL) | Stores your account, workouts, and plans | In the background |
| **Backend** (`backend/` folder) | The "brain": handles logins, saves data, talks to the AI | http://localhost:3001 |
| **Frontend** (`frontend/` folder) | The screens you click on | http://localhost:5173 (open this in your browser) |

> **What's a "terminal"?** It's a window where you type commands. On **Mac**,
> open the **Terminal** app (press `Cmd + Space`, type *Terminal*, press Enter).
> On **Windows**, open **PowerShell** (press the Windows key, type *PowerShell*,
> press Enter). Whenever this guide shows a grey box of commands, type or paste
> each line into the terminal and press **Enter**.

---

## Step 1: Install Node.js

Node.js runs the app's code, and it includes `npm`, which downloads the app's building blocks.

1. Go to https://nodejs.org and download the **LTS** version (the button on the left).
2. Open the downloaded file and click through the installer, keeping the default options.
3. **Close and reopen** your terminal, then check that it worked:

   ```bash
   node -v
   npm -v
   ```

   You should see version numbers, like `v22.x.x` and `10.x.x`. Any Node version 20 or newer is fine.

## Step 2: Install the database (PostgreSQL)

Pick **one** option. If you're unsure, pick **Option A**.

### Option A (Mac): Postgres.app, the easiest option

1. Download it from https://postgresapp.com and drag it into your Applications folder.
2. Open **Postgres.app** and click **Initialize**. You should see a green check or "Running".
3. In the Postgres.app window, **double-click the database with your username**. A terminal window opens with a `=#` prompt.
4. Paste these two lines and press Enter:

   ```sql
   CREATE USER strength WITH PASSWORD 'strength' CREATEDB;
   CREATE DATABASE strength_app OWNER strength;
   ```

   You should see `CREATE ROLE` and `CREATE DATABASE`. Type `\q` and press Enter to leave.

### Option A (Windows): The official PostgreSQL installer

1. Download the Windows installer (version 16 or newer) from https://www.postgresql.org/download/windows/ (click "Download the installer").
2. Run it and keep the defaults. When it asks for a **password for the `postgres` superuser**, pick one and **write it down**. Keep the port as **5432**. You can skip "Stack Builder" at the end.
3. Open **SQL Shell (psql)** from the Start menu. Press **Enter** to accept each default (Server, Database, Port, Username). Then type the password from step 2. You won't see it as you type; that's normal.
4. At the `postgres=#` prompt, paste:

   ```sql
   CREATE USER strength WITH PASSWORD 'strength' CREATEDB;
   CREATE DATABASE strength_app OWNER strength;
   ```

   You should see `CREATE ROLE` and `CREATE DATABASE`. Type `\q` and press Enter to leave.

### Option B (Mac or Windows): Docker

Use this only if you already use Docker or want to try it.

1. Install **Docker Desktop** from https://www.docker.com/products/docker-desktop and open it.
2. In your terminal, go into the project folder (see Step 3) and run:

   ```bash
   docker compose up -d
   ```

   This starts a database with the right name, username, and password already set up (see `docker-compose.yml`).

> Whichever option you chose, your database address is:
> `postgresql://strength:strength@localhost:5432/strength_app`

## Step 3: Get the code and open it in the terminal

1. Download the app **from GitHub, not from your own zip**. Your `strength-app259.zip` is missing the database setup files and fixes that make it run. Go to
   https://github.com/rayzabarte-wq/Complete-Fitness-Coach/tree/claude/strength-app-258-setup-l7wuii,
   click the green **Code** button, then **Download ZIP**.
2. Unzip it somewhere easy to find, like your **Documents** folder, and rename the folder to `strength-app259`.
3. Move your terminal into the project folder with `cd` ("change directory"). For example:

   ```bash
   # Mac
   cd ~/Documents/strength-app259

   # Windows
   cd $HOME\Documents\strength-app259
   ```

   > **Tip:** Type `cd ` (with a space), drag the folder from Finder or File
   > Explorer into the terminal window, and press Enter.

   Check that you're in the right place: run `ls`. You should see `backend`, `frontend`, and `README.md`.

## Step 4: Set up the backend

### 4a. Create your settings file (`.env`)

```bash
cd backend
cp .env.example .env
```

Now open `backend/.env` in a text editor. [VS Code](https://code.visualstudio.com) is a good free choice. On Mac, TextEdit also works, but choose **Format → Make Plain Text** first. On Windows, you can use Notepad. Files starting with a dot are hidden by default:
- **Mac Finder:** press `Cmd + Shift + .` to show hidden files.
- **Windows:** in File Explorer, go to **View → Show → Hidden items**.

Change these three lines:

1. **`DATABASE_URL`**: replace the whole line with:

   ```
   DATABASE_URL="postgresql://strength:strength@localhost:5432/strength_app"
   ```

2. **`JWT_SECRET`**: this is a secret key that keeps logins secure. Generate a random one by running this in your terminal:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Copy the long output and paste it between the quotes: `JWT_SECRET="paste-it-here"`.

3. **`ANTHROPIC_API_KEY`**: powers the AI coaching (workout generation, golf sessions, and the 3-month plan).
   - Sign up at https://console.anthropic.com, add a payment method or credits (it's pay-as-you-go), then go to **API Keys → Create Key**.
   - Paste it in: `ANTHROPIC_API_KEY="sk-ant-..."`.
   - **Keep this key private.** Don't share it or upload it anywhere. The `.env` file is already set to stay out of Git.
   - *No key yet?* The app still starts, and you can log in, log workouts, and use the calendar. Only the AI buttons will show an error.

Leave everything else as it is. Outlook, Strava, and the weather location are optional, and the README explains them. Save the file.

### 4b. Install the backend's building blocks

Still in the `backend` folder:

```bash
npm install
```

This takes a minute or two. Warnings in yellow are normal; only red `ERR!` lines are a problem.

### 4c. Create the database tables and add the exercise list

```bash
npx prisma migrate dev
npm run seed
```

- The first command creates all the tables. You should see "Your database is now in sync with your schema."
- The second fills in the exercise catalog. You should see `Seeded 20 exercises.`

### 4d. Start the backend

```bash
npm run dev
```

You should see: `Backend listening on http://localhost:3001`

**Leave this terminal window open.** The backend only runs while it's open. To check it, visit http://localhost:3001/health in your browser. It should say `{"ok":true}`.

## Step 5: Set up and start the frontend

Open a **second** terminal window (Mac: `Cmd + N` in Terminal; Windows: open another PowerShell). Go to the project folder again, then:

```bash
cd frontend
npm install
npm run dev
```

You should see a line like `Local: http://localhost:5173/`. **Leave this window open too.**

(The frontend already knows the backend is at `http://localhost:3001`, so you don't need a `.env` file here.)

## Step 6: Open the app and create your account

1. Open **http://localhost:5173** in your browser.
2. Enter your email and a password of **at least 10 characters**, then click **Register**.
3. The app requires two-factor login (2FA). A QR code appears. Scan it with an authenticator app on your phone, such as **Google Authenticator**, **Microsoft Authenticator**, **Authy**, or **1Password**.
4. Type the 6-digit code from your phone and click **Confirm & finish setup**.

You're in! You'll land on the **Calendar**. Try **Workout**: pick Push, Pull, Legs, or Core to get an AI-generated session (this needs the API key).

> **Using it on your phone:** if your phone is on the same Wi-Fi, the
> frontend terminal also shows a `Network:` address (like
> `http://192.168.1.20:5173`). The pages will open on your phone, but
> logging in won't work yet, because the phone would look for the backend on
> itself. To fix that, create `frontend/.env` containing
> `VITE_API_URL="http://192.168.1.20:3001"` (use your computer's address), then
> restart the frontend.

---

## Starting the app again later

Once the setup is done, you only need two terminals each time:

```bash
# Terminal 1
cd path/to/strength-app259/backend
npm run dev

# Terminal 2
cd path/to/strength-app259/frontend
npm run dev
```

Then open http://localhost:5173. Make sure the database is running first: Postgres.app is open (Mac), or Docker Desktop is open (if you used Docker). The Windows installer version starts automatically.

To **stop** the app, click into each terminal and press `Ctrl + C`.

## Upgrading to the strength-first version (260)

Version 260 refocuses the app on strength. It adds body goals, a Progress tab, per-muscle recovery, block-based exercise variation, week auto-fill, daily steps, a profile and a consent step. Your existing account and data are kept. Other sports are switched off, not deleted: tick them back on in **Settings → Workout types**. To upgrade:

1. Get the new code (or `git pull` and check out the new branch).
2. Stop the app (`Ctrl + C` in both terminals). Then, in the `backend` folder, run:

   ```bash
   npm install
   npx prisma migrate dev
   npm run seed
   ```

   You should see `strength_focus_goals_progress` applied. `npm run seed` adds the larger exercise catalog and the muscle and variation tags the recovery and variation features need. It never touches your logged workouts.

3. In the `frontend` folder, run `npm install`, then start both parts as usual.
4. When you next open the app, you'll see a one-time **"Your data, your choice"** screen. Tick what you're happy for the app to store. To use body goals, scans and steps, tick **Store my body and activity data**.

### Daily steps from Apple Health (optional)

A web app can't read Apple Health directly, so an iPhone Shortcut sends your daily step count to the app instead. Your Garmin's steps reach Apple Health through Garmin Connect's Apple Health sharing, so this picks those up too.

1. In the app, go to **Settings → Data import** and tap **Create token**. Copy it.
2. Follow the step-by-step instructions under **Apple Health steps** on that screen.

> Your iPhone has to be able to reach the backend. On your home network, use
> your computer's local address (e.g. `http://192.168.1.20:3001`) rather than
> `localhost`. Once the app is deployed, use its public URL.

### Renpho sync (optional)

Pulls your Renpho body-composition scans into the app. It runs on your computer, so your Renpho password never goes to the app.

```bash
pip install renpho-py
export RENPHO_EMAIL="you@example.com"
export RENPHO_PASSWORD="your-renpho-password"
export CFC_API_URL="http://localhost:3001"
export CFC_UPLOAD_TOKEN="cfc_..."          # from Settings → Data import
python3 tools/renpho_sync.py --dry-run     # check what it found
python3 tools/renpho_sync.py               # upload
```

Run it again whenever you've had new scans, or schedule it. Already-imported scans are skipped. If it says nothing is usable, run `python3 tools/renpho_sync.py --dump` and share the output, since Renpho's record format varies between scales.

## Already set up the earlier version (258)?

Version 259 adds the **Schedule Builder**, where you choose the day and time of each session yourself instead of having the AI place them. It also adds a few new database fields. Your existing account and data are kept. To upgrade:

1. Download the new version as in [Step 3](#step-3-get-the-code-and-open-it-in-the-terminal).
2. Copy your old `backend/.env` file into the new `backend` folder.
3. Stop the old app (`Ctrl + C` in both terminals). Then, in the new `backend` folder, run:

   ```bash
   npm install
   npx prisma migrate dev
   ```

   You should see `manual_schedule_builder` listed and "Your database is now in sync with your schema."

   > If you see `Drift detected` or a message asking to **reset** the database,
   > type `n` and press Enter so nothing is deleted, then ask for help.
   > This can happen if you created the database tables yourself earlier
   > with `--name init`.

4. In the new `frontend` folder, run `npm install`, then start both parts as usual.

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` or `npm`: "command not found" or "not recognized" | Close and reopen the terminal after installing Node. If that doesn't work, restart your computer. |
| `Can't reach database server at localhost:5432` | The database isn't running. Open Postgres.app or Docker Desktop. On Windows, open **Services**, find **postgresql**, and click **Start**. |
| `P1000: Authentication failed` | The `DATABASE_URL` in `backend/.env` doesn't match the user and password you created in Step 2. Check for typos. |
| `JWT_SECRET is not set` | You didn't save `backend/.env`, or the `JWT_SECRET` line is empty. |
| `Port 3001 (or 5173) is already in use` / `EADDRINUSE` | The app is already running in another terminal. Close that one first, or restart your computer. |
| Login page shows "Failed to fetch" | The backend isn't running. Check that Terminal 1 still shows `Backend listening...`. |
| "Too many attempts. Try again in a few minutes." | The app locks login after 10 tries in 15 minutes as a safety feature. Wait 15 minutes. |
| AI buttons show an error | Check `ANTHROPIC_API_KEY` in `backend/.env`, and check that your Anthropic account has credits. Restart the backend after editing `.env`. |
| Lost your authenticator app | Easiest fix for a local setup: in the `backend` folder run `npx prisma studio`, open the **User** table, set `totpEnabled` to `false`, and save. |
| Want to look at your data | `cd backend`, then `npx prisma studio`. It opens a visual editor for the database in your browser. |
