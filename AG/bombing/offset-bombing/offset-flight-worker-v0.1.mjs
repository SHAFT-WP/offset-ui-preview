// Same cache token as the page controller (one module instance in the in-thread fallback).
import { OFFSET_FLIGHT_V0_1, createOffsetFlightSession } from "./offset-flight-v0.1.mjs?v=2026-10-12d";

// Offset Flight calculation host (Offset BE performance addendum 2026-10-12, P4). The BE owns the
// calculation and its reuse; this host only runs it off the page's main thread.
//
// As a module Worker (new Worker(url, { type: "module" })) it answers every
//   { type: "calculate", requestId, input }
// with
//   { type: "result", requestId, output, error, stats }
// where output is calculateOffsetFlightFull's contract (from one editing session, P3), error is a
// message when the input could not be read at all, and stats are the session's diagnostics (which
// aircraft were solved or reused, BDP / SEM / trajectory counts, BE time). No DOM is used.
// Requests are answered one at a time, in arrival order; the page decides which answer is current.
// After posting an answer the host solves the state it just returned once more (prepareIdle), because
// the page sends that state back next. It runs only after the answer is out; a request that arrives
// while it runs waits for it (one Flight re-solve at most, its sub-solves mostly reused).
//
// The same module is the page's in-thread fallback when a module Worker cannot start.

export const OFFSET_FLIGHT_WORKER_V0_1 = Object.freeze({ id: "offset-flight-worker-v0.1", version: "0.1.1", flight: OFFSET_FLIGHT_V0_1.version });

export function createOffsetFlightHost() {
  const session = createOffsetFlightSession();
  let handled = 0;
  let prepared = null;
  return {
    handle(message) {
      if (message?.type !== "calculate") return { type: "error", requestId: message?.requestId ?? null, error: `unsupported message ${message?.type}` };
      handled += 1;
      prepared = null;
      const startedAt = performance.now();
      try {
        const output = session.calculate(message.input);
        const stats = session.lastStats();
        // The returned state comes back as the next input; prepare it when nothing else is waiting.
        if (Object.values(stats.solveLog).includes("solved")) prepared = { after: handled, nextInput: output.nextInput };
        return { type: "result", requestId: message.requestId, output, error: null, stats: { ...stats, hostMs: performance.now() - startedAt } };
      } catch (error) {
        return { type: "result", requestId: message.requestId, output: null, error: error.message, stats: { hostMs: performance.now() - startedAt } };
      }
    },
    // Idle step after an answer: solves the returned state once so the page's next request (a
    // commit, an edit elsewhere) reuses it. Skipped when a newer request was handled meanwhile.
    prepareIdle() {
      if (!prepared || prepared.after !== handled) return null;
      const { nextInput } = prepared;
      prepared = null;
      try {
        return session.prepare(nextInput);
      } catch {
        return null;
      }
    },
  };
}

// Worker entry: only inside a dedicated worker scope (never on the page itself).
if (typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const host = createOffsetFlightHost();
  self.addEventListener("message", (event) => {
    self.postMessage(host.handle(event.data));
    setTimeout(() => host.prepareIdle(), 0);
  });
  self.postMessage({ type: "ready", worker: OFFSET_FLIGHT_WORKER_V0_1 });
}
