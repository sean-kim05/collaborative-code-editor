"""End-to-end Socket.IO sync latency benchmark.

Measures: time from a sender's `code_change` emit to other clients receiving it
through Flask-SocketIO + Redis. Sweeps room sizes in {2, 5, 10, 25, 50}.

Latency is captured by stamping `time.perf_counter_ns()` inside the message
content. Receivers parse the content and compare against their own
`perf_counter_ns()` — this works because sender + receivers run in the same
Python process, so the clock is shared.

Threading model: python-socketio's sync Client uses a background thread per
connection. On macOS, eventlet's monkey-patched kqueue hub conflicts with
websocket-client's selector, so we stick to plain threading.

Usage:
    python bench_sync_latency.py [--host http://localhost:5001]
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time

import socketio

from _common import make_room_id, progress, save_json, stats

DEFAULT_HOST = "http://localhost:5001"
MESSAGES_PER_SWEEP = 500
GAP_MS = 20
DRAIN_TIMEOUT_S = 5.0
SWEEP_SIZES = [2, 5, 10, 25, 50]
RESULTS_PATH = os.path.join(os.path.dirname(__file__), "results", "sync_latency.json")


class BenchClient:
    """Wraps a python-socketio Client with bench-specific bookkeeping."""

    def __init__(self, host: str, room_id: str, name: str, is_sender: bool):
        self.host = host
        self.room_id = room_id
        self.name = name
        self.is_sender = is_sender
        self.client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
        self.latencies_ns: list[int] = []
        self.joined = threading.Event()
        self.dropped = 0

        @self.client.on("room_state")
        def _on_room_state(_data):
            self.joined.set()

        @self.client.on("join_error")
        def _on_join_error(data):
            progress(f"{self.name} join_error: {data}")

        if not is_sender:
            @self.client.on("code_change")
            def _on_code_change(data):
                now = time.perf_counter_ns()
                try:
                    payload = json.loads(data.get("content", "{}"))
                    ts = payload.get("ts_ns")
                    if isinstance(ts, int) and ts > 0:
                        self.latencies_ns.append(now - ts)
                except (json.JSONDecodeError, AttributeError):
                    self.dropped += 1

    def connect(self) -> None:
        self.client.connect(self.host, transports=["websocket"], wait_timeout=10)

    def join(self) -> None:
        self.client.emit("join_room", {"room_id": self.room_id, "username": self.name, "color": "#fff"})
        if not self.joined.wait(timeout=10):
            raise RuntimeError(f"{self.name} did not receive room_state within 10s")

    def disconnect(self) -> None:
        try:
            self.client.disconnect()
        except Exception:
            pass


def run_sweep(host: str, n_clients: int, n_messages: int) -> dict:
    progress(f"--- sweep: {n_clients} clients, {n_messages} messages ---")
    room_id = make_room_id()
    clients = [BenchClient(host, room_id, f"bench-{i}", is_sender=(i == 0)) for i in range(n_clients)]

    # Connect + join (serial to avoid thundering herd; each pause is small).
    for c in clients:
        c.connect()
    progress("all connected")
    for c in clients:
        c.join()
    progress("all joined")

    # Brief warm-up: send one untimed message and discard. The handler ignores
    # any payload with ts_ns <= 0, so it never lands in latencies_ns.
    sender = clients[0]
    sender.client.emit("code_change", {
        "room_id": room_id,
        "content": json.dumps({"ts_ns": -1, "payload": "warmup"}),
        "file_id": "bench-file",
    })
    time.sleep(0.25)

    expected_per_receiver = n_messages
    receivers = clients[1:]

    progress(f"sending {n_messages} messages at {GAP_MS}ms gap ...")
    t0 = time.perf_counter()
    for i in range(n_messages):
        ts = time.perf_counter_ns()
        sender.client.emit("code_change", {
            "room_id": room_id,
            "content": json.dumps({"ts_ns": ts, "seq": i, "payload": "x" * 100}),
            "file_id": "bench-file",
        })
        if GAP_MS:
            time.sleep(GAP_MS / 1000.0)
        if i and i % 100 == 0:
            progress(f"  sent {i}/{n_messages}")
    send_elapsed = time.perf_counter() - t0
    progress(f"send loop done in {send_elapsed:.2f}s, draining for up to {DRAIN_TIMEOUT_S}s ...")

    # Drain phase.
    drain_start = time.perf_counter()
    while time.perf_counter() - drain_start < DRAIN_TIMEOUT_S:
        if all(len(c.latencies_ns) >= expected_per_receiver for c in receivers):
            break
        time.sleep(0.05)

    all_latencies = []
    received_counts = []
    for c in receivers:
        received_counts.append(len(c.latencies_ns))
        all_latencies.extend(c.latencies_ns)

    expected_total = expected_per_receiver * len(receivers)
    received_total = sum(received_counts)
    dropped_pct = 100.0 * (expected_total - received_total) / expected_total if expected_total else 0.0

    for c in clients:
        c.disconnect()

    sweep_stats = stats(all_latencies)
    sweep_stats.update({
        "n_clients": n_clients,
        "n_messages_sent": n_messages,
        "expected_per_receiver": expected_per_receiver,
        "expected_total_received": expected_total,
        "actual_total_received": received_total,
        "dropped_pct": round(dropped_pct, 3),
        "send_loop_seconds": round(send_elapsed, 3),
        "received_per_client": received_counts,
    })
    progress(f"result: mean={sweep_stats['mean_ms']}ms p50={sweep_stats['p50_ms']}ms p95={sweep_stats['p95_ms']}ms p99={sweep_stats['p99_ms']}ms dropped={sweep_stats['dropped_pct']}%")
    return sweep_stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--messages", type=int, default=MESSAGES_PER_SWEEP)
    parser.add_argument("--sizes", default=",".join(str(s) for s in SWEEP_SIZES),
                        help="Comma-separated client counts")
    args = parser.parse_args()
    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]

    all_results = {
        "host": args.host,
        "messages_per_sweep": args.messages,
        "gap_ms": GAP_MS,
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "sweeps": [],
    }
    for n in sizes:
        try:
            all_results["sweeps"].append(run_sweep(args.host, n, args.messages))
        except Exception as e:  # noqa: BLE001
            progress(f"sweep n={n} failed: {e}")
            all_results["sweeps"].append({"n_clients": n, "error": str(e)})

    all_results["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # Print pretty table to stdout.
    print()
    print(f"{'N':>4} | {'mean':>9} | {'p50':>9} | {'p95':>9} | {'p99':>9} | {'dropped':>8}")
    print("-" * 65)
    for s in all_results["sweeps"]:
        if "error" in s:
            print(f"{s['n_clients']:>4} | ERROR: {s['error']}")
            continue
        print(f"{s['n_clients']:>4} | {s['mean_ms']:>7.2f}ms | {s['p50_ms']:>7.2f}ms | "
              f"{s['p95_ms']:>7.2f}ms | {s['p99_ms']:>7.2f}ms | {s['dropped_pct']:>7.2f}%")
    print()

    save_json(RESULTS_PATH, all_results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
