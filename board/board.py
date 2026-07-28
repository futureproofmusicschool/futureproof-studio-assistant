#!/usr/bin/env python3
"""Small helper for board/board.json so card edits stop being ad-hoc heredocs.

Usage:
    python3 board/board.py list [<list-id>]
    python3 board/board.py add <list-id> "<title>" ["<desc>"] [--due YYYY-MM-DD]
    python3 board/board.py move <card-id> <list-id> [--pos N]
    python3 board/board.py rm <card-id>

List ids come from board.json (workflow lists like today, in-progress, next, done, plus your own backlogs).
"""
import json
import os
import platform
import sys
import secrets
import datetime
import pathlib


def data_root():
    override = os.environ.get("STUDIO_ASSISTANT_DATA_DIR", "").strip()
    if override:
        return pathlib.Path(override).expanduser().resolve()
    if platform.system() == "Darwin":
        return pathlib.Path.home() / "Library" / "Application Support" / "Futureproof Studio Assistant"
    if platform.system() == "Windows":
        return pathlib.Path(os.environ.get("APPDATA", pathlib.Path.home() / "AppData" / "Roaming")) / "Futureproof Studio Assistant"
    return pathlib.Path(os.environ.get("XDG_DATA_HOME", pathlib.Path.home() / ".local" / "share")) / "futureproof-studio-assistant"


DATA_FILE = data_root() / "board" / "board.json"


def load():
    return json.loads(DATA_FILE.read_text())


def save(b):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(b, indent=1, ensure_ascii=False) + "\n")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def next_pos(b, lid):
    return max((c["pos"] for c in b["cards"] if c["list"] == lid), default=0) + 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    b = load()

    if cmd == "list":
        want = args[0] if args else None
        for l in b["lists"]:
            if want and l["id"] != want:
                continue
            cards = sorted(
                (c for c in b["cards"] if c["list"] == l["id"]),
                key=lambda c: c["pos"],
            )
            if not cards and want is None:
                continue
            print(f"\n## {l['name']}")
            for c in cards:
                due = f"  (due {c['due'][:10]})" if c.get("due") else ""
                print(f"  [{c['id']}] {c['title']}{due}")

    elif cmd == "add":
        lid, title = args[0], args[1]
        desc = args[2] if len(args) > 2 and not args[2].startswith("--") else ""
        due = None
        if "--due" in args:
            due = args[args.index("--due") + 1] + "T00:00:00.000Z"
        card = {
            "id": "c_" + secrets.token_hex(4),
            "title": title,
            "desc": desc,
            "list": lid,
            "pos": next_pos(b, lid),
            "due": due,
            "createdAt": now(),
            "updatedAt": now(),
        }
        b["cards"].append(card)
        save(b)
        print(f"added {card['id']} to {lid}")

    elif cmd == "move":
        cid, lid = args[0], args[1]
        pos = int(args[args.index("--pos") + 1]) if "--pos" in args else None
        for c in b["cards"]:
            if c["id"] == cid:
                c["list"] = lid
                c["pos"] = pos if pos is not None else next_pos(b, lid)
                c["updatedAt"] = now()
                save(b)
                print(f"moved {cid} -> {lid}")
                return
        sys.exit(f"no card {cid}")

    elif cmd == "rm":
        before = len(b["cards"])
        b["cards"] = [c for c in b["cards"] if c["id"] != args[0]]
        if len(b["cards"]) == before:
            sys.exit(f"no card {args[0]}")
        save(b)
        print(f"removed {args[0]}")

    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:])
