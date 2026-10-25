// Same cache token as the page controller (one module instance in the in-thread fallback).
import { WHEEL_FLIGHT_V0_1, createWheelFlightSession } from "./wheel-flight-v0.1.mjs?v=0.1.0";
// The host itself is Flight Bombing Tactics': this module gives it the Wheel Flight session.
import { createFlightHost, serveFlightWorker } from "../../../flight/flight-bombing-tactics/flight-worker-host-v0.1.mjs";

// Wheel Flight calculation host: the BOX / Offset Flight Worker's contract with the Wheel Flight session. As a module
// Worker it answers every { type: "calculate", requestId, input } with { type: "result", requestId, output, error,
// stats }, one at a time in arrival order, then prepares the state it returned. The same module is the page's
// in-thread fallback when a module Worker cannot start. No DOM is used.
export const WHEEL_FLIGHT_WORKER_V0_1 = Object.freeze({ id: "wheel-flight-worker-v0.1", version: "0.1.0", flight: WHEEL_FLIGHT_V0_1.version });

export function createWheelFlightHost() {
  return createFlightHost(createWheelFlightSession());
}

// Worker entry: only inside a dedicated worker scope (never on the page itself).
serveFlightWorker(createWheelFlightHost, WHEEL_FLIGHT_WORKER_V0_1);
