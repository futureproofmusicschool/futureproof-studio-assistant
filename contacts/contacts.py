#!/usr/bin/env python3
"""Loopback client for the Studio Assistant's Google-backed contacts.

The app server is the only writer. This helper preserves the original commands
without touching the legacy contacts.json backup.

Usage:
    python3 contacts/contacts.py list [<category-id>]
    python3 contacts/contacts.py add <category-id> "<name>" [--role R] [--contact C] [--status S] [--notes N] [--samples]
    python3 contacts/contacts.py set <id> <field> <value>
    python3 contacts/contacts.py rm <id>
    python3 contacts/contacts.py log <id> "<summary>" [--channel email|call|dm|in-person|other] [--date YYYY-MM-DD]
    python3 contacts/contacts.py history <id>

Environment:
    STUDIO_ASSISTANT_URL  App origin (default http://127.0.0.1:$PORT, port 3017)

Statuses: to-contact, contacted, replied, confirmed, declined
Settable fields: name, role, category, status, haveSamples (true/false), contact,
notes, lastContact (YYYY-MM-DD or none)
"""

import datetime
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


STATUSES = ["to-contact", "contacted", "replied", "confirmed", "declined"]
CHANNELS = ["email", "call", "dm", "in-person", "other"]
FIELDS = ["name", "role", "category", "status", "haveSamples", "contact", "notes", "lastContact"]
PORT = os.environ.get("PORT", "3017").strip() or "3017"
API_BASE = os.environ.get("STUDIO_ASSISTANT_URL", f"http://127.0.0.1:{PORT}").rstrip("/")


def api_error(error):
    try:
        payload = json.loads(error.read().decode("utf-8"))
        return payload.get("error") or f"HTTP {error.code}"
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f"HTTP {error.code}"


def request_json(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {} if body is None else {"Content-Type": "application/json"}
    last_error = None
    for attempt in range(2):
        request = urllib.request.Request(API_BASE + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            message = api_error(error)
            if error.code < 500 or attempt == 1:
                sys.exit(f"Studio Assistant API: {message}")
            last_error = message
        except urllib.error.URLError as error:
            last_error = str(error.reason)
            if attempt == 1:
                break
        time.sleep(0.25)
    sys.exit(f"cannot reach Studio Assistant at {API_BASE}: {last_error}")


def load():
    return request_json("GET", "/api/contacts")


def today():
    return datetime.date.today().isoformat()


def find(data, contact_id):
    for entry in data["contacts"]:
        if entry["id"] == contact_id:
            return entry
    sys.exit(f"no contact {contact_id}")


def flag(args, name, default=None):
    if name not in args:
        return default
    index = args.index(name) + 1
    if index >= len(args):
        sys.exit(f"{name} needs a value")
    return args[index]


def contact_path(contact_id, suffix=""):
    return f"/api/contacts/entries/{urllib.parse.quote(contact_id, safe='')}{suffix}"


def require_args(args, count, usage):
    if len(args) < count:
        sys.exit(f"usage: {usage}")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]

    if cmd == "list":
        data = load()
        want = args[0] if args else None
        for category in data["categories"]:
            if want and category["id"] != want:
                continue
            entries = sorted(
                (entry for entry in data["contacts"] if entry["category"] == category["id"]),
                key=lambda entry: (STATUSES.index(entry["status"]), entry["name"]),
            )
            print(f"\n## {category['name']}")
            if not entries:
                print("  (empty)")
            for entry in entries:
                samples = " [samples]" if entry["haveSamples"] else ""
                last = f"  last {entry['lastContact'][:10]}" if entry.get("lastContact") else ""
                role = f" ({entry['role']})" if entry["role"] else ""
                print(f"  [{entry['id']}] {entry['name']}{role} — {entry['status']}{samples}{last}")

    elif cmd == "add":
        require_args(args, 2, 'contacts.py add <category-id> "<name>" [options]')
        category, name = args[0], args[1]
        data = load()
        if not any(item["id"] == category for item in data["categories"]):
            sys.exit(f"no category {category}")
        status = flag(args, "--status", "to-contact")
        if status not in STATUSES:
            sys.exit(f"bad status {status}")
        contact_id = "k_" + secrets.token_hex(6)
        request_json("POST", "/api/contacts/entries", {
            "id": contact_id,
            "name": name,
            "role": flag(args, "--role", ""),
            "category": category,
            "status": status,
            "haveSamples": "--samples" in args,
            "contact": flag(args, "--contact", ""),
            "notes": flag(args, "--notes", ""),
        })
        print(f"added {contact_id} to {category}")

    elif cmd == "set":
        require_args(args, 3, "contacts.py set <id> <field> <value>")
        contact_id, field, value = args[0], args[1], args[2]
        if field not in FIELDS:
            sys.exit(f"bad field {field} (one of {', '.join(FIELDS)})")
        data = load()
        find(data, contact_id)
        if field == "status" and value not in STATUSES:
            sys.exit(f"bad status {value}")
        if field == "category" and not any(item["id"] == value for item in data["categories"]):
            sys.exit(f"no category {value}")
        if field == "haveSamples":
            parsed = value.lower() in ("true", "1", "yes")
        elif field == "lastContact":
            parsed = None if value.lower() in ("none", "null", "") else value
        else:
            parsed = value
        request_json("PATCH", contact_path(contact_id), {field: parsed})
        print(f"set {contact_id}.{field}")

    elif cmd == "rm":
        require_args(args, 1, "contacts.py rm <id>")
        contact_id = args[0]
        find(load(), contact_id)
        request_json("DELETE", contact_path(contact_id))
        print(f"removed {contact_id}")

    elif cmd == "log":
        require_args(args, 2, 'contacts.py log <id> "<summary>" [options]')
        contact_id, summary = args[0], args[1]
        channel = flag(args, "--channel", "email")
        if channel not in CHANNELS:
            sys.exit(f"bad channel {channel} (one of {', '.join(CHANNELS)})")
        date = flag(args, "--date", today())
        entry = find(load(), contact_id)
        request_json("POST", contact_path(contact_id, "/log"), {
            "operationId": "h_" + secrets.token_hex(16),
            "date": date,
            "channel": channel,
            "summary": summary,
        })
        if entry["status"] == "to-contact":
            request_json("PATCH", contact_path(contact_id), {"status": "contacted"})
        print(f"logged {channel} touch on {date} for {entry['name']}")

    elif cmd == "history":
        require_args(args, 1, "contacts.py history <id>")
        entry = find(load(), args[0])
        print(f"# {entry['name']} — {entry['status']}")
        if not entry["log"]:
            print("  (no correspondence logged)")
        for item in entry["log"]:
            print(f"  {item['date']}  [{item['channel']}]  {item['summary']}")

    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:])
