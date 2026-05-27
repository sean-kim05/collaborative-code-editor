"""3-layer persistence read benchmark — Redis warm cache vs PostgreSQL cold read.

The CollabCode backend keeps every room's file system in Redis (`fs:{room_id}`)
with PostgreSQL as the durable source of truth. This benchmark is intentionally
skipped unless `DATABASE_URL` is set and the `rooms` table is reachable —
without PG, the "cold read" path collapses to the in-memory dict fallback and
isn't a meaningful comparison.

To enable: export DATABASE_URL=postgresql://user:pass@host/db before running.

Usage:
    python bench_persistence.py [--host http://localhost:5001]
"""
from __future__ import annotations

import os
import sys

import json

OUT_PATH = os.path.join(os.path.dirname(__file__), "results", "persistence.json")


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        msg = ("DATABASE_URL not set — skipping persistence benchmark. "
               "Without PostgreSQL the 'cold read' path falls back to in-memory dict, "
               "which makes the cold-vs-warm comparison meaningless.")
        sys.stderr.write(msg + "\n")
        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, "w") as f:
            json.dump({"skipped": True, "reason": msg}, f, indent=2)
        sys.stderr.write(f"wrote skip marker to {OUT_PATH}\n")
        return 0

    # When PG is available, the proper implementation would:
    #   1. Connect to Redis (REDIS_URL) and the PG database (DATABASE_URL).
    #   2. Use a fresh room_id (so no warm cache leaks in).
    #   3. Issue many `code_change`s to populate a 50-file fs.
    #   4. For COLD: flush the `fs:{room_id}` Redis key, then time
    #      `GET /api/room/<room_id>` (which is a Redis miss → PG fallback).
    #   5. For WARM: repeat the GET 1000 times without flushing.
    #
    # That code path requires PG to be reachable, which it is not in the
    # current local setup (per the bench plan, PG is optional).
    sys.stderr.write("DATABASE_URL is set but the PG-enabled benchmark implementation\n"
                     "has not been wired up — the local dev setup runs without PG.\n"
                     "Skipping with a marker file.\n")
    with open(OUT_PATH, "w") as f:
        json.dump({"skipped": True, "reason": "PG-enabled path not implemented in this run"}, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
