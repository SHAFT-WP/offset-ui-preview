// POP-UP dependency sweep worker (Design tab graph, owner 2026-11-18): answers { id, base, assignments } with
// { id, point } — one direct Flight solve of the sweep (popup-dependency-sweep-v0.1). Several run side by side.
import { POPUP_DEPENDENCY_SWEEP_V0_1, sweepPoint } from "./popup-dependency-sweep-v0.1.mjs?v=0.1.1";

export const POPUP_DEPENDENCY_WORKER_V0_1 = Object.freeze({ id: "popup-dependency-worker-v0.1", version: "0.1.1", sweep: POPUP_DEPENDENCY_SWEEP_V0_1.version });

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (event) => {
    const { id, base, assignments } = event.data ?? {};
    let point;
    try { point = sweepPoint(base, assignments); } catch (error) { point = { status: "FAILED", messages: [error.message], y: {} }; }
    self.postMessage({ id, point });
  };
}
