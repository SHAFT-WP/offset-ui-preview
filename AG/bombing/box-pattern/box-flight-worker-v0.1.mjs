// Same cache token as the page controller (one module instance in the in-thread fallback).
import { BOX_FLIGHT_V0_1, createBoxFlightSession } from "./box-flight-v0.1.mjs?v=0.2.0";
// The host itself is Flight Bombing Tactics': this module gives it the BOX Flight session.
import { createFlightHost, serveFlightWorker } from "../../../flight/flight-bombing-tactics/flight-worker-host-v0.1.mjs";

// BOX Flight calculation host: the Offset Flight Worker's contract with the BOX Flight session. As a module Worker it
// answers every { type: "calculate", requestId, input } with { type: "result", requestId, output, error, stats },
// one at a time in arrival order, then prepares the state it returned. The same module is the page's in-thread
// fallback when a module Worker cannot start. No DOM is used.
export const BOX_FLIGHT_WORKER_V0_1 = Object.freeze({ id: "box-flight-worker-v0.1", version: "0.1.1", flight: BOX_FLIGHT_V0_1.version });

export function createBoxFlightHost() {
  return createFlightHost(createBoxFlightSession());
}

// Worker entry: only inside a dedicated worker scope (never on the page itself).
serveFlightWorker(createBoxFlightHost, BOX_FLIGHT_WORKER_V0_1);
