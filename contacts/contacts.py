#!/usr/bin/env python3
"""Small helper for contacts/contacts.json so outreach edits stop being ad-hoc heredocs.

Usage:
    python3 contacts/contacts.py list [<category-id>]
    python3 contacts/contacts.py add <category-id> "<name>" [--role R] [--contact C] [--status S] [--notes N] [--samples]
    python3 contacts/contacts.py set <id> <field> <value>
    python3 contacts/contacts.py rm <id>
    python3 contacts/contacts.py log <id> "<summary>" [--channel email|call|dm|in-person|other] [--date YYYY-MM-DD]
    python3 contacts/contacts.py history <id>

Category ids: collaborators, leads, label
Statuses: to-contact, contacted, replied, confirmed, declined
Settable fields: name, role, category, status, haveSamples (true/false), contact, notes, lastContact (YYYY-MM-DD or none)
"""
import datetime
import json
import pathlib
import secrets
import sys

PATH = pathlib.Path(__file__).with_name("contacts.json")

STATUSES = ["to-contact", "contacted", "replied", "confirmed", "declined"]
CHANNELS = ["email", "call", "dm", "in-person", "other"]
FIELDS = ["name", "role", "category", "status", "haveSamples", "contact", "notes", "lastContact"]


def load():
    return json.loads(PATH.read_text())


def save(data):
    PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def today():
    return datetime.date.today().isoformat()


def find(data, cid):
    for entry in data["contacts"]:
        if entry["id"] == cid:
            return entry
    sys.exit(f"no contact {cid}")


def flag(args, name, default=None):
    if name in args:
        return args[args.index(name) + 1]
    return default


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    data = load()

    if cmd == "list":
        want = args[0] if args else None
        for category in data["categories"]:
            if want and category["id"] != want:
                continue
            entries = sorted(
                (e for e in data["contacts"] if e["category"] == category["id"]),
                key=lambda e: (STATUSES.index(e["status"]), e["name"]),
            )
            print(f"\n## {category['name']}")
            if not entries:
                print("  (empty)")
            for e in entries:
                samples = " [samples]" if e["haveSamples"] else ""
                last = f"  last {e['lastContact'][:10]}" if e.get("lastContact") else ""
                role = f" ({e['role']})" if e["role"] else ""
                print(f"  [{e['id']}] {e['name']}{role} — {e['status']}{samples}{last}")

    elif cmd == "add":
        category, name = args[0], args[1]
        if not any(c["id"] == category for c in data["categories"]):
            sys.exit(f"no category {category}")
        status = flag(args, "--status", "to-contact")
        if status not in STATUSES:
            sys.exit(f"bad status {status}")
        entry = {
            "id": "k_" + secrets.token_hex(4),
            "name": name,
            "role": flag(args, "--role", ""),
            "category": category,
            "status": status,
            "haveSamples": "--samples" in args,
            "contact": flag(args, "--contact", ""),
            "notes": flag(args, "--notes", ""),
            "lastContact": None,
            "log": [],
            "createdAt": now(),
            "updatedAt": now(),
        }
        data["contacts"].append(entry)
        save(data)
        print(f"added {entry['id']} to {category}")

    elif cmd == "set":
        cid, field, value = args[0], args[1], args[2]
        if field not in FIELDS:
            sys.exit(f"bad field {field} (one of {', '.join(FIELDS)})")
        entry = find(data, cid)
        if field == "status" and value not in STATUSES:
            sys.exit(f"bad status {value}")
        if field == "category" and not any(c["id"] == value for c in data["categories"]):
            sys.exit(f"no category {value}")
        if field == "haveSamples":
            entry[field] = value.lower() in ("true", "1", "yes")
        elif field == "lastContact":
            entry[field] = None if value.lower() in ("none", "null", "") else value
        else:
            entry[field] = value
        entry["updatedAt"] = now()
        save(data)
        print(f"set {cid}.{field}")

    elif cmd == "rm":
        before = len(data["contacts"])
        data["contacts"] = [e for e in data["contacts"] if e["id"] != args[0]]
        if len(data["contacts"]) == before:
            sys.exit(f"no contact {args[0]}")
        save(data)
        print(f"removed {args[0]}")

    elif cmd == "log":
        cid, summary = args[0], args[1]
        channel = flag(args, "--channel", "email")
        if channel not in CHANNELS:
            sys.exit(f"bad channel {channel} (one of {', '.join(CHANNELS)})")
        date = flag(args, "--date", today())
        entry = find(data, cid)
        entry["log"].append({"date": date, "channel": channel, "summary": summary})
        entry["lastContact"] = date
        if entry["status"] == "to-contact":
            entry["status"] = "contacted"
        entry["updatedAt"] = now()
        save(data)
        print(f"logged {channel} touch on {date} for {entry['name']}")

    elif cmd == "history":
        entry = find(data, args[0])
        print(f"# {entry['name']} — {entry['status']}")
        if not entry["log"]:
            print("  (no correspondence logged)")
        for item in entry["log"]:
            print(f"  {item['date']}  [{item['channel']}]  {item['summary']}")

    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:])
