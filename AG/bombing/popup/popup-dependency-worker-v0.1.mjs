// POP-UP dependency sweep worker (Design tab graph, owner 2026-11-18): answers { id, base, assignments } with
// { id, point } — one direct Flight solve of the sweep (popup-dependency-sweep-v0.1). Several run side by side.
import { POPUP_DEPENDENCY_SWEEP_V0_1, sweepPoint } from "./popup-dependency-sweep-v0.1.mjs?v=0.1.3";
import { regionTask } from "./popup-offset-region-v0.1.mjs?v=0.1.3";
import { fineTune } from "./popup-fine-tune-v0.1.mjs?v=0.1.1";

// 0.1.2 (owner 2026-11-20, DESIGN-STEPS.md S3): { kind: "region", base, assignments: { angleOffDeg } } answers one
// step-3 region point (popup-offset-region-v0.1) instead; { kind: "fineTune", base, assignments: request } one step-4
// Fine tune (popup-fine-tune-v0.1, a few Flight solves in a row).
// 0.1.3 (owner 2026-11-24, the 2 s tracking band): "region" answers regionTask (the point and its 2 s point).
export const POPUP_DEPENDENCY_WORKER_V0_1 = Object.freeze({ id: "popup-dependency-worker-v0.1", version: "0.1.3", sweep: POPUP_DEPENDENCY_SWEEP_V0_1.version });

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (event) => {
    const { id, base, assignments, kind } = event.data ?? {};
    let point;
    try { point = kind === "region" ? regionTask(base, assignments) : kind === "fineTune" ? fineTune(base, assignments) : sweepPoint(base, assignments); } catch (error) { point = { status: "FAILED", messages: [error.message], y: {} }; }
    self.postMessage({ id, point });
  };
}
