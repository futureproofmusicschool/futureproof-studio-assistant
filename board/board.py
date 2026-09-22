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
import sys


import urllib.request
import urllib.error

API_BASE = os.environ.get("STUDIO_ASSISTANT_URL", "http://localhost:" + os.environ.get("PORT", "3017")).rstrip("/")

def request(method, route, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API_BASE + route, data=body, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try: message = json.loads(error.read()).get("error", str(error))
        except ValueError: message = str(error)
        sys.exit(message)
    except urllib.error.URLError:
        sys.exit("Start Studio Assistant before using the board helper.")

def load():
    return request("GET", "/api/board")


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
        card = request("POST", "/api/board/cards", {"title": title, "list": lid, "desc": desc, "due": due})
        print(f"added {card['id']} to {lid}")

    elif cmd == "move":
        cid, lid = args[0], args[1]
        pos = int(args[args.index("--pos") + 1]) if "--pos" in args else None
        for c in b["cards"]:
            if c["id"] == cid:
                request("PATCH", f"/api/board/cards/{cid}", {"list": lid, **({"pos": pos} if pos is not None else {})})
                print(f"moved {cid} -> {lid}")
                return
        sys.exit(f"no card {cid}")

    elif cmd == "rm":
        before = len(b["cards"])
        b["cards"] = [c for c in b["cards"] if c["id"] != args[0]]
        if len(b["cards"]) == before:
            sys.exit(f"no card {args[0]}")
        request("DELETE", f"/api/board/cards/{args[0]}")
        print(f"removed {args[0]}")

    else:
        sys.exit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:])
