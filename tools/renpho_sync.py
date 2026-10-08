#!/usr/bin/env python3
"""
Renpho → Complete Fitness Coach sync.

Pulls your body-composition scans from your Renpho account and uploads any
new ones to the app. Run it on your own computer whenever you like (or on a
schedule). Your Renpho email and password stay on this machine: they're
read from environment variables and sent only to Renpho, never to the app.
The app is reached with the personal upload token from Settings →
Data import.

Renpho has no official API. This uses `renpho-py`, an unofficial,
reverse-engineered client. That's fine for syncing your own account, but it
could break if Renpho changes things, and it isn't something to build a
public product on. For that, the plan is Apple Health + manual entry.

Setup (once):
    pip install renpho-py
    export RENPHO_EMAIL="you@example.com"
    export RENPHO_PASSWORD="your-renpho-password"
    export CFC_API_URL="http://localhost:3001"      # your backend URL
    export CFC_UPLOAD_TOKEN="cfc_..."                # Settings → Data import

Run:
    python3 tools/renpho_sync.py            # upload everything new
    python3 tools/renpho_sync.py --dry-run  # show what would be uploaded
    python3 tools/renpho_sync.py --dump     # print one raw Renpho record

Re-running is safe: each scan carries its Renpho id, and the app skips any
it already has.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

TIME_KEYS = ("timeStamp", "time_stamp", "timestamp", "measureTime", "measure_time", "localCreatedAt", "createdAt", "created_at")


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing environment variable {name} (see the top of this file).")
    return value


def parse_time(record):
    """Renpho records carry their time under different keys depending on the
    scale/API version, as epoch seconds, epoch milliseconds or ISO text."""
    for key in TIME_KEYS:
        raw = record.get(key)
        if raw in (None, ""):
            continue
        try:
            if isinstance(raw, (int, float)) or str(raw).isdigit():
                n = float(raw)
                if n > 1e12:  # milliseconds
                    n /= 1000
                return datetime.fromtimestamp(n, tz=timezone.utc)
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(timezone.utc)
        except (ValueError, OSError):
            continue
    return None


def number(value):
    try:
        n = float(value)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def to_measurement(record):
    when = parse_time(record)
    if when is None:
        return None
    weight = number(record.get("weight"))
    body_fat = number(record.get("bodyfat"))
    # Muscle mass in kg. Renpho reports "sinew" as muscle mass (kg) on most
    # body-composition scales; "muscle" is a percentage, so fall back to
    # weight × muscle% when sinew isn't there.
    muscle_kg = number(record.get("sinew"))
    if muscle_kg is None and weight and number(record.get("muscle")):
        muscle_kg = round(weight * number(record.get("muscle")) / 100, 1)
    if muscle_kg is not None and weight and muscle_kg >= weight:
        muscle_kg = None  # implausible — leave it out rather than store nonsense
    if weight is None and body_fat is None and muscle_kg is None:
        return None
    m = {
        "measuredAt": when.isoformat().replace("+00:00", "Z"),
        "externalId": str(record.get("id") or int(when.timestamp())),
    }
    if weight is not None:
        m["weightKg"] = round(weight, 2)
    if body_fat is not None:
        m["bodyFatPct"] = round(body_fat, 1)
    if muscle_kg is not None:
        m["muscleMassKg"] = round(muscle_kg, 1)
    return m


def upload(api_url, token, measurements):
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/ingest/body",
        data=json.dumps({"source": "RENPHO", "measurements": measurements}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Upload failed ({e.code}): {e.read().decode(errors='replace')}")


def main():
    parser = argparse.ArgumentParser(description="Sync Renpho scans to Complete Fitness Coach.")
    parser.add_argument("--days", type=int, default=None, help="only scans from the last N days")
    parser.add_argument("--dry-run", action="store_true", help="show what would be uploaded, upload nothing")
    parser.add_argument("--dump", action="store_true", help="print one raw Renpho record and exit")
    args = parser.parse_args()

    try:
        from renpho import RenphoClient
    except ImportError:
        sys.exit("renpho-py isn't installed. Run: pip install renpho-py")

    client = RenphoClient(env("RENPHO_EMAIL"), env("RENPHO_PASSWORD"))
    client.login()
    records = client.get_all_measurements()

    if args.dump:
        print(json.dumps(records[0] if records else {}, indent=2, default=str))
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days) if args.days else None
    measurements = []
    skipped = 0
    for r in records:
        m = to_measurement(r)
        if m is None:
            skipped += 1
            continue
        if cutoff and datetime.fromisoformat(m["measuredAt"].replace("Z", "+00:00")) < cutoff:
            continue
        measurements.append(m)

    print(f"Renpho returned {len(records)} records; {len(measurements)} usable" + (f", {skipped} without a time or values" if skipped else "") + ".")
    if skipped and not measurements:
        print("Nothing usable. Run with --dump to see the raw record shape.")
        return
    if args.dry_run:
        for m in measurements[-10:]:
            print(m)
        return

    api_url = env("CFC_API_URL")
    token = env("CFC_UPLOAD_TOKEN")
    created = skipped_dupes = 0
    for i in range(0, len(measurements), 500):
        result = upload(api_url, token, measurements[i : i + 500])
        created += result.get("created", 0)
        skipped_dupes += result.get("skipped", 0)
    print(f"Uploaded {created} new scan(s); {skipped_dupes} were already in the app.")


if __name__ == "__main__":
    main()
