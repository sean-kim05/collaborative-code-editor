"""Shared helpers for the benchmark scripts."""
from __future__ import annotations

import json
import statistics
import sys
import time
import uuid


def stats(samples_ns: list[int]) -> dict:
    """Convert a list of nanosecond latency samples to summary stats (in ms)."""
    if not samples_ns:
        return {"count": 0}
    samples_ms = [s / 1_000_000 for s in samples_ns]
    samples_ms_sorted = sorted(samples_ms)

    def pct(p: float) -> float:
        idx = int(round((p / 100.0) * (len(samples_ms_sorted) - 1)))
        return samples_ms_sorted[idx]

    return {
        "count": len(samples_ms),
        "mean_ms": round(statistics.fmean(samples_ms), 3),
        "p50_ms": round(pct(50), 3),
        "p95_ms": round(pct(95), 3),
        "p99_ms": round(pct(99), 3),
        "min_ms": round(min(samples_ms), 3),
        "max_ms": round(max(samples_ms), 3),
    }


def make_room_id() -> str:
    return f"bench-{uuid.uuid4().hex[:10]}"


def progress(msg: str) -> None:
    """Flushed stderr write so a piped tail shows progress in real time."""
    sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    sys.stderr.flush()


def save_json(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    progress(f"saved {path}")
