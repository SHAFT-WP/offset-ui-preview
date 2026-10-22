// Same cache token as the page controller (one module instance in the in-thread fallback).
import { OFFSET_FLIGHT_V0_1, createOffsetFlightSession } from "./offset-flight-v0.1.mjs?v=2026-10-12d";
// The host itself is Flight Bombing Tactics' (2026-10-22): this module gives it the Offset Flight session.
import { createFlightHost, serveFlightWorker } from "../../../flight/flight-bombing-tactics/flight-worker-host-v0.1.mjs";

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
  return createFlightHost(createOffsetFlightSession());
}

// Worker entry: only inside a dedicated worker scope (never on the page itself).
serveFlightWorker(createOffsetFlightHost, OFFSET_FLIGHT_WORKER_V0_1);
