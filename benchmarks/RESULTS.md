# CollabCode Benchmarks

**Hardware:** macOS (darwin 25.4.0), Apple Silicon
**Date:** 2026-05-27
**Backend:** Flask-SocketIO 5.3.6 + eventlet 0.36 + Redis 7 (local) + SQLite (snapshots) — PostgreSQL not tested locally
**Loopback only** (`http://localhost:5001`) — production Render deployment intentionally excluded since public-internet RTT would swamp the numbers.

---

## Sync Latency (client A → client B propagation)

500 messages per sweep, 20 ms gap, single sender, N–1 receivers in one room.
Latency = receiver's `perf_counter_ns()` − timestamp baked into the sender's payload.

| Concurrent clients | mean | p50 | p95 | p99 | dropped |
|--:|--:|--:|--:|--:|--:|
| 2  |  8.69 ms |  8.67 ms | 13.03 ms | 19.59 ms | 0.00% |
| 5  | 11.28 ms | 11.57 ms | 14.83 ms | 16.53 ms | 0.00% |
| 10 | 12.50 ms | 12.56 ms | 16.06 ms | 19.07 ms | 0.00% |
| 25 | 11.17 ms | 11.06 ms | 16.38 ms | 17.89 ms | 0.00% |
| 50 |  8.71 ms |  8.79 ms | 12.44 ms | 13.96 ms | 0.00% |

Zero drops across all 43,500 messages received (500 senders × per-receiver counts summed across all sweeps). Latency stays flat or improves as room size grows — at N=50, fan-out is 49× but eventlet schedules send batches more efficiently per cycle so per-message median actually drops.

**Headline number:** Sustained 50 concurrent clients per room with p95 sync latency under 17 ms and zero dropped messages.

---

## Throughput (sustained server-processed rate)

1 paced sender + 4 idle receivers in one room. Each rate runs for 8 s. A sweep is "healthy" only if every receiver got ≥ 99% of the sent sequence numbers.

| Target rate | Actual send rate | Min recv count | Worst-receiver drop | Healthy? |
|--:|--:|--:|--:|:--|
|   100 ev/s |   100 ev/s |   800 |  0.00% | yes |
|   500 ev/s |   500 ev/s |  4000 |  0.00% | yes |
| 1,000 ev/s | 1,000 ev/s |  6203 | 22.46% | no  |
| 2,000 ev/s | 2,000 ev/s |  4536 | 71.65% | no  |
| 5,000 ev/s | 5,000 ev/s |  2828 | 92.93% | no  |

- Sustained no-drop rate: **500 events/sec** (fanned out to 4 receivers = 2,000 deliveries/sec)
- 0 sequence gaps observed at healthy rates
- The earlier "97k emits/sec" number from the first revision of this script measured client-side queue rate, not server processed rate — it was discarded as misleading. This pace-and-verify approach is what produced the 500 ev/s number above.

---

## Persistence (3-layer)

**Not measured.** PostgreSQL is not configured locally (no `DATABASE_URL` set). Without PG, the "cold read" path collapses to the in-memory dict fallback, which makes the cold-vs-warm comparison meaningless. Skipping by design rather than reporting fake numbers. See `bench_persistence.py` for the implementation skeleton — it requires `DATABASE_URL` to run.

---

## Raw data

JSON outputs under `benchmarks/results/`:
- `sync_latency.json` — per-sweep counts and full p50/p95/p99 tables
- `throughput.json` — per-rate counts, drops, and the computed sustained no-drop rate
- `persistence.json` — skip marker

---

## Headline (paste into resume)

Sustained 50 concurrent clients per room with p95 sync latency under 17 ms and zero dropped messages across 24,500 deliveries.
