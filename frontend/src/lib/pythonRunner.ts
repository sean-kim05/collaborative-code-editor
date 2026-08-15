/**
 * Python execution, in the browser.
 *
 * Replaces the old `POST /api/run`, which shelled out to `python3` on our
 * server: that gave anyone who could reach the API arbitrary code execution as
 * the server user, with our environment variables, database and network in
 * reach. No amount of hardening fixes the shape of that — the fix is to not run
 * user code on our infrastructure at all.
 *
 * Pyodide is CPython compiled to WebAssembly, so the snippet runs in the user's
 * own tab against an in-memory virtual filesystem. It cannot see our server, and
 * it cannot see the user's real files either. This also makes the two languages
 * consistent: JavaScript already ran client-side (see `handleRun` in Room.tsx).
 *
 * It runs in a Web Worker rather than on the main thread, which buys something
 * the JavaScript path still lacks: a real timeout. `while True: pass` cannot be
 * interrupted cooperatively, but a worker can be terminated outright, so an
 * infinite loop costs the user one worker instead of freezing the editor — and
 * in a collaborative editor, freezing the tab would also stall their socket.
 */

const PYODIDE_VERSION = '0.29.0';
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** Wall-clock budget for the snippet itself, once the interpreter is warm. */
const EXEC_TIMEOUT_MS = 5_000;
/** Separate, much longer budget for the one-off interpreter download (~6MB). */
const BOOT_TIMEOUT_MS = 90_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  elapsed_ms: number;
}

/**
 * The worker body, kept as a string and loaded from a Blob so it needs no
 * separate entry in the build pipeline. It is a classic worker, so it can pull
 * Pyodide in with importScripts.
 */
const WORKER_SOURCE = String.raw`
let pyodidePromise = null;
const decoder = new TextDecoder();
let outBuf = '';
let errBuf = '';

async function boot() {
  if (!pyodidePromise) {
    importScripts('${PYODIDE_BASE}pyodide.js');
    pyodidePromise = loadPyodide({ indexURL: '${PYODIDE_BASE}' }).then(async (py) => {
      // Capture with 'write' rather than 'batched': batched only fires on a
      // newline, so sys.stdout.write("no newline") would be silently dropped.
      py.setStdout({ write: (bytes) => { outBuf += decoder.decode(bytes); return bytes.length; } });
      py.setStderr({ write: (bytes) => { errBuf += decoder.decode(bytes); return bytes.length; } });
      // Without write_through, Python block-buffers and a partial write does
      // not reach us until the NEXT run flushes it — output appearing in the
      // wrong panel. Push every write straight through instead.
      await py.runPythonAsync(
        'import sys\n' +
        'sys.stdout.reconfigure(line_buffering=True, write_through=True)\n' +
        'sys.stderr.reconfigure(line_buffering=True, write_through=True)\n'
      );
      return py;
    });
  }
  return pyodidePromise;
}

/**
 * Drop Pyodide's own frames from a traceback. They sit between the "Traceback"
 * header and the user's frames, and reference /lib/pythonXXX.zip/_pyodide/,
 * which is noise the person who wrote the snippet cannot act on.
 */
function cleanTraceback(text) {
  const lines = String(text).split('\n');
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    const frame = /^\s{2}File "([^"]*)"/.exec(line);
    if (frame) {
      skipping = !frame[1].startsWith('<exec>');
      if (!skipping) kept.push(line.replace('"<exec>"', '"your code"'));
      continue;
    }
    if (skipping) {
      // Continuation lines belonging to a dropped frame.
      if (/^\s{4}/.test(line) || /^\s*\.\.\./.test(line)) continue;
      skipping = false;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

self.onmessage = async (event) => {
  const { code } = event.data;
  const wasWarm = pyodidePromise !== null;

  let pyodide;
  try {
    pyodide = await boot();
  } catch (err) {
    self.postMessage({ type: 'done', stdout: '', stderr: 'Could not load the Python runtime: ' + String(err) });
    return;
  }
  if (!wasWarm) self.postMessage({ type: 'booted' });

  outBuf = '';
  errBuf = '';
  try {
    await pyodide.runPythonAsync(code);
  } catch (e) {
    if (errBuf && !errBuf.endsWith('\n')) errBuf += '\n';
    errBuf += cleanTraceback((e && e.message) || e);
  }
  // Flush anything Python is still holding before we report.
  try {
    await pyodide.runPythonAsync('import sys\nsys.stdout.flush()\nsys.stderr.flush()');
  } catch (_) { /* nothing left to flush */ }

  self.postMessage({
    type: 'done',
    stdout: outBuf.replace(/\n$/, ''),
    stderr: errBuf.replace(/\n$/, ''),
  });
};
`;

let worker: Worker | null = null;
let workerUrl: string | null = null;
/** Set once the interpreter has actually finished downloading in `worker`. */
let booted = false;

function spawnWorker(): Worker {
  if (worker) return worker;
  const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
  workerUrl = URL.createObjectURL(blob);
  worker = new Worker(workerUrl);
  booted = false;
  return worker;
}

/** Drop the worker so the next run starts from a clean interpreter. */
function discardWorker() {
  if (worker) worker.terminate();
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  worker = null;
  workerUrl = null;
  booted = false;
}

/** True once the interpreter is downloaded, so callers can warn about the first-run wait. */
export function isPythonWarm(): boolean {
  return booted;
}

/**
 * Run `code` and resolve with its captured output.
 *
 * Never rejects: a timeout, a crashed worker or a failed CDN load all come back
 * as a RunResult with something useful in `stderr`, so the caller renders them
 * the same way it renders a Python traceback.
 *
 * `onBoot` fires when the interpreter has finished downloading on a cold start,
 * which is the point where a multi-second wait turns into normal execution.
 */
export function runPython(
  code: string,
  opts: { onBoot?: () => void } = {},
): Promise<RunResult> {
  const start = performance.now();

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let timer: number | undefined;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    const elapsed = () => Math.round(performance.now() - start);

    // Capture warmth *before* spawning: after it, a worker always exists.
    const wasWarm = booted;

    let active: Worker;
    try {
      active = spawnWorker();
    } catch (err) {
      finish({ stdout: '', stderr: `Could not start the Python runtime: ${String(err)}`, elapsed_ms: elapsed() });
      return;
    }

    // Until the interpreter reports itself booted, the clock is measuring a
    // download rather than the snippet, so it gets the longer budget.
    const arm = (ms: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = window.setTimeout(() => {
        discardWorker();
        finish({
          stdout: '',
          stderr: ms === EXEC_TIMEOUT_MS
            ? `Execution timed out (${EXEC_TIMEOUT_MS / 1000}s limit)`
            : 'Timed out downloading the Python runtime. Check your connection and try again.',
          elapsed_ms: elapsed(),
        });
      }, ms);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.type === 'booted') {
        booted = true;
        opts.onBoot?.();
        // The download is done; from here the clock measures the snippet.
        arm(EXEC_TIMEOUT_MS);
        return;
      }
      if (data.type === 'done') {
        active.removeEventListener('message', onMessage);
        active.removeEventListener('error', onError);
        finish({ stdout: data.stdout ?? '', stderr: data.stderr ?? '', elapsed_ms: elapsed() });
      }
    };

    const onError = (event: ErrorEvent) => {
      discardWorker();
      finish({ stdout: '', stderr: event.message || 'The Python runtime stopped unexpectedly.', elapsed_ms: elapsed() });
    };

    active.addEventListener('message', onMessage);
    active.addEventListener('error', onError);

    // A warm interpreter sends no 'booted' message, so the execution budget
    // applies immediately; a cold one gets the download budget until it does.
    arm(wasWarm ? EXEC_TIMEOUT_MS : BOOT_TIMEOUT_MS);
    active.postMessage({ code });
  });
}
