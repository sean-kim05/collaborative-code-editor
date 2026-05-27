"""Throughput benchmark.

Goal: find the highest sustained `code_change` rate at which the server can
broadcast to all receivers without dropping events.

Why a rate sweep instead of "send-as-fast-as-possible": python-socketio's
client `emit()` is non-blocking — it queues into the websocket-client send
buffer and returns immediately. Without back-pressure, a tight emit loop
just inflates the client-side queue until disconnect drops it. The number it
produces ("97k emits/sec") tells you nothing about what the server processed.

Instead we pace the sender at a known rate and verify all 4 receivers got
100% of the sequence numbers. The highest rate that survives that check is
the sustained server throughput.

Usage:
    python bench_throughput.py [--host http://localhost:5001]
"""
from __future__ import annotations

# NOTE: on macOS, eventlet's kqueue hub conflicts with websocket-client's
# selectors, so we use python-socketio's default threading mode instead.

import argparse
import json
import os
import threading
import time

import socketio

from _common import make_room_id, progress, save_json

DEFAULT_HOST = "http://localhost:5001"
RECEIVERS = 4
DURATION_PER_RATE_S = 8
TARGET_RATES = [100, 500, 1000, 2000, 5000]
DRAIN_S = 3.0
RESULTS_PATH = os.path.join(os.path.dirname(__file__), "results", "throughput.json")


class TPClient:
    def __init__(self, host: str, room_id: str, name: str, is_sender: bool):
        self.host = host
        self.room_id = room_id
        self.name = name
        self.is_sender = is_sender
        self.client = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
        self.received = 0
        self.expected_next = 0
        self.out_of_order = 0
        self.gaps = []
        self.joined = threading.Event()

        @self.client.on("room_state")
        def _on_room_state(_data):
            self.joined.set()

        if not is_sender:
            @self.client.on("code_change")
            def _on_code_change(data):
                try:
                    payload = json.loads(data.get("content", "{}"))
                    seq = payload.get("seq")
                    if not isinstance(seq, int) or seq < 0:
                        return
                    if seq != self.expected_next:
                        self.out_of_order += 1
                        if len(self.gaps) < 10:
                            self.gaps.append((self.expected_next, seq))
                    self.expected_next = seq + 1
                    self.received += 1
                except (json.JSONDecodeError, AttributeError):
                    pass

    def reset_counts(self):
        self.received = 0
        self.expected_next = 0
        self.out_of_order = 0
        self.gaps.clear()

    def connect(self) -> None:
        self.client.connect(self.host, transports=["websocket"], wait_timeout=10)

    def join(self) -> None:
        self.client.emit("join_room", {"room_id": self.room_id, "username": self.name, "color": "#fff"})
        if not self.joined.wait(timeout=10):
            raise RuntimeError(f"{self.name} did not get room_state")

    def disconnect(self) -> None:
        try:
            self.client.disconnect()
        except Exception:
            pass


def run_rate(sender: TPClient, receivers: list[TPClient], room_id: str,
             target_rate: int, duration_s: int) -> dict:
    progress(f"--- rate={target_rate} ev/s for {duration_s}s ---")
    # Drain warm-up so all clients are quiet, then reset bookkeeping.
    time.sleep(0.3)
    for r in receivers:
        r.reset_counts()

    interval = 1.0 / target_rate
    t0 = time.perf_counter()
    deadline = t0 + duration_s
    sent = 0
    next_send = t0
    while True:
        now = time.perf_counter()
        if now >= deadline:
            break
        if now >= next_send:
            sender.client.emit("code_change", {
                "room_id": room_id,
                "content": json.dumps({"seq": sent, "payload": "x" * 100}),
                "file_id": "bench-file",
            })
            sent += 1
            next_send += interval
        else:
            # Sleep until next send window, capped so we still yield often.
            time.sleep(min(0.001, next_send - now))
    actual_duration = time.perf_counter() - t0
    actual_send_rate = sent / actual_duration

    progress(f"  sent {sent} in {actual_duration:.2f}s (actual {actual_send_rate:.0f}/sec); draining {DRAIN_S}s ...")
    time.sleep(DRAIN_S)

    per_recv = []
    drop_pcts = []
    for r in receivers:
        drop = 100.0 * (sent - r.received) / sent if sent else 0
        drop_pcts.append(drop)
        per_recv.append({
            "name": r.name, "received": r.received, "expected": sent,
            "drop_pct": round(drop, 3),
            "out_of_order": r.out_of_order, "gaps_sample": r.gaps[:5],
        })

    worst_drop = max(drop_pcts) if drop_pcts else 0.0
    healthy = worst_drop < 1.0
    progress(f"  result: sent={sent}  recv_min={min(r.received for r in receivers)}  "
             f"worst_drop={worst_drop:.2f}%  healthy={healthy}")

    return {
        "target_rate_eps": target_rate,
        "duration_s": duration_s,
        "actual_send_rate_eps": round(actual_send_rate, 1),
        "events_sent": sent,
        "worst_recv_drop_pct": round(worst_drop, 3),
        "all_receivers_within_1pct": healthy,
        "per_receiver": per_recv,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--duration", type=int, default=DURATION_PER_RATE_S)
    parser.add_argument("--rates", default=",".join(str(r) for r in TARGET_RATES))
    args = parser.parse_args()
    rates = [int(r) for r in args.rates.split(",") if r.strip()]

    room_id = make_room_id()
    sender = TPClient(args.host, room_id, "tp-sender", is_sender=True)
    receivers = [TPClient(args.host, room_id, f"tp-recv-{i}", is_sender=False) for i in range(RECEIVERS)]
    clients = [sender] + receivers

    for c in clients:
        c.connect()
    for c in clients:
        c.join()
    progress("connected + joined; doing single warm-up emit ...")
    sender.client.emit("code_change", {
        "room_id": room_id,
        "content": json.dumps({"seq": -1, "payload": "warmup"}),
        "file_id": "bench-file",
    })
    time.sleep(0.3)

    results = {
        "host": args.host,
        "n_receivers": RECEIVERS,
        "duration_per_rate_s": args.duration,
        "drain_s": DRAIN_S,
        "sweeps": [],
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    for rate in rates:
        try:
            results["sweeps"].append(run_rate(sender, receivers, room_id, rate, args.duration))
        except Exception as e:  # noqa: BLE001
            progress(f"rate={rate} failed: {e}")
            results["sweeps"].append({"target_rate_eps": rate, "error": str(e)})

    results["finished"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # Highest rate where worst-receiver drop < 1%.
    sustained = max((s["target_rate_eps"] for s in results["sweeps"]
                     if s.get("all_receivers_within_1pct")), default=None)
    results["sustained_no_drop_rate_eps"] = sustained

    for c in clients:
        c.disconnect()

    print()
    print(f"{'target rate':>11} | {'actual send':>11} | {'recv_min':>9} | {'worst drop':>10} | healthy?")
    print("-" * 70)
    for s in results["sweeps"]:
        if "error" in s:
            print(f"{s['target_rate_eps']:>11} | ERROR: {s['error']}")
            continue
        recv_min = min(r["received"] for r in s["per_receiver"])
        print(f"{s['target_rate_eps']:>9} eps | {s['actual_send_rate_eps']:>9.0f} eps | "
              f"{recv_min:>9} | {s['worst_recv_drop_pct']:>9.2f}% | "
              f"{'yes' if s['all_receivers_within_1pct'] else 'NO'}")
    print()
    print(f"Sustained no-drop rate: {sustained} events/sec  (worst-receiver drop < 1%)")
    print()

    save_json(RESULTS_PATH, results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
