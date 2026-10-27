// Same cache token as the page controller (one module instance in the in-thread fallback).
import { POPUP_FLIGHT_V0_1, createPopupFlightSession } from "./popup-flight-v0.1.mjs?v=0.1.0";
import { createFlightHost, serveFlightWorker } from "../../../flight/flight-bombing-tactics/flight-worker-host-v0.1.mjs";

// POP-UP Flight calculation host (the Offset Flight host's contract, offset-flight-worker-v0.1): it answers
// { type: "calculate", requestId, input } with { type: "result", requestId, output, error, stats }, output being
// calculatePopupFlightFull's (from one editing session). The same module is the page's in-thread fallback.
export const POPUP_FLIGHT_WORKER_V0_1 = Object.freeze({ id: "popup-flight-worker-v0.1", version: "0.1.0", flight: POPUP_FLIGHT_V0_1.version });

export function createPopupFlightHost() {
  return createFlightHost(createPopupFlightSession());
}

serveFlightWorker(createPopupFlightHost, POPUP_FLIGHT_WORKER_V0_1);
