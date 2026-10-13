// Same cache token as the page's S&R controller (one module instance in the in-thread fallback).
import { SEM_REJOIN_V0_1, createSemRejoinSession } from "./sem-rejoin-be-v0.1.mjs?v=0.1.0";

// Offset SEM & Rejoin calculation host (SPEC "Requests"). The BE owns the calculation and its reuse;
// this host only runs it off the page's main thread, with the Offset Flight host's message contract:
//   { type: "calculate", requestId, input }  →  { type: "result", requestId, output, error, stats }
// output is calculateSemRejoinFull's contract from one editing session; error is a message when the
// input could not be read at all. Requests are answered one at a time, in arrival order; the page
// decides which answer is current. The same module is the page's in-thread fallback.

export const SEM_REJOIN_WORKER_V0_1 = Object.freeze({ id: "sem-rejoin-worker-v0.1", version: "0.1.0", be: SEM_REJOIN_V0_1.version });

export function createSemRejoinHost() {
  const session = createSemRejoinSession();
  return {
    handle(message) {
      if (message?.type !== "calculate") return { type: "error", requestId: message?.requestId ?? null, error: `unsupported message ${message?.type}` };
      const startedAt = performance.now();
      try {
        const output = session.calculate(message.input);
        return { type: "result", requestId: message.requestId, output, error: null, stats: { ...session.lastStats(), hostMs: performance.now() - startedAt } };
      } catch (error) {
        return { type: "result", requestId: message.requestId, output: null, error: error.message, stats: { hostMs: performance.now() - startedAt } };
      }
    },
    // The transport calls this after each answer; the S&R session has nothing to prepare.
    prepareIdle() {
      return null;
    },
  };
}

// Worker entry: only inside a dedicated worker scope (never on the page itself).
if (typeof self !== "undefined" && typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const host = createSemRejoinHost();
  self.addEventListener("message", (event) => {
    self.postMessage(host.handle(event.data));
  });
  self.postMessage({ type: "ready", worker: SEM_REJOIN_WORKER_V0_1 });
}
