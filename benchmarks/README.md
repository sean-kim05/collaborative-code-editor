# CollabCode Benchmarks

Three benchmark scripts that exercise the local Flask-SocketIO server end-to-end.

## Prerequisites

- Backend running locally: `cd backend && source venv/bin/activate && python app.py`  (listens on `:5001`)
- Redis up: `brew services start redis`
- Bench deps installed in the backend venv (already present): `pip install -r benchmarks/requirements.txt`

## Run

```bash
# Sync latency: client A → client B propagation, sweeps room sizes
python benchmarks/bench_sync_latency.py

# Throughput: how many code_change events/sec the server processes
python benchmarks/bench_throughput.py

# Persistence: Redis warm vs PG cold reads (skipped unless DATABASE_URL is set)
python benchmarks/bench_persistence.py
```

Each script prints a summary table to stdout and writes a JSON file under
`benchmarks/results/`. See `RESULTS.md` for the headline numbers from the last run.

## Notes

- Scripts use python-socketio's default threading mode (one background thread
  per client). Eventlet was tried first but its kqueue hub conflicts with
  websocket-client on macOS.
- Sync-latency timing uses `time.perf_counter_ns()` baked into the message
  content; sender + receivers share the clock because they run in one process.
- Don't run against the Render-deployed backend — public-internet RTT swamps the
  numbers you actually care about.
