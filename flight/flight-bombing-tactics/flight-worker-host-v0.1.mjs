// Flight calculation host (Flight Bombing Tactics, since 2026-10-22, from the Offset Flight Worker host; Offset BE
// performance addendum 2026-10-12, P4). The pattern's session owns the calculation and its reuse; the host only
// runs it off the page's main thread.
//
// handle({ type: "calculate", requestId, input }) answers
//   { type: "result", requestId, output, error, stats }
// with output from session.calculate(input), error a message when the input could not be read at all, and stats the
// session's diagnostics plus the host time. Requests are answered one at a time, in arrival order; the page decides
// which answer is current. After posting an answer the host solves the state it just returned once more
// (prepareIdle), because the page sends that state back next. It runs only after the answer is out; a request that
// arrives while it runs waits for it. No DOM is used.

export const FLIGHT_WORKER_HOST_V0_1 = Object.freeze({ id: "flight-worker-host-v0.1", version: "0.1.0", status: "work" });

// session: { calculate(input), lastStats() → { solveLog, ... }, prepare(nextInput) } (createFlightSession).
export function createFlightHost(session) {
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
    // Idle step after an answer: solves the returned state once so the page's next request (a commit, an edit
    // elsewhere) reuses it. Skipped when a newer request was handled meanwhile.
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

// Worker entry: only inside a dedicated worker scope (never on the page itself). Answers each message, then runs the
// idle step, and announces { type: "ready", worker } once.
export function serveFlightWorker(createHost, worker) {
  if (!(typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope)) return false;
  const host = createHost();
  self.addEventListener("message", (event) => {
    self.postMessage(host.handle(event.data));
    setTimeout(() => host.prepareIdle(), 0);
  });
  self.postMessage({ type: "ready", worker });
  return true;
}
