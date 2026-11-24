// Offset dependency sweep worker (Offset Design tab graph, owner 2026-11-23): answers { id, base, assignments } with
// { id, point } — one direct Offset Flight solve of the sweep (offset-dependency-sweep-v0.1). Several run side by side.
import { OFFSET_DEPENDENCY_SWEEP_V0_1, sweepPoint } from "./offset-dependency-sweep-v0.1.mjs?v=0.1.0";
import { angleOffCandidate, heldAltitudeSolutions, regionPoint } from "./offset-design-region-v0.1.mjs?v=0.2.0";
import { fineTune } from "./offset-fine-tune-v0.1.mjs?v=0.1.0";
import { solveFollowerReleaseTime } from "./offset-follower-time-v0.1.mjs?v=0.1.3";

// 0.1.1 (owner 2026-11-23, the planning steps): { kind: "region", base, assignments: { angleOffDeg } } answers one
// step-2 region point (offset-design-region-v0.1); { kind: "fineTune", base, assignments: request } one step-3 Fine tune
// (offset-fine-tune-v0.1, a few Flight solves in a row).
// 0.1.2 (owner 2026-11-23, #2 step S1): { kind: "followerTime", base (the whole Flight input), assignments: { number,
// request } } answers one release-time solve of a follower (offset-follower-time-v0.1).
// 0.1.6 (owner 2026-11-24, step 3 Angle Off range): "region" with assignments.offsetAngleDeg answers angleOffCandidate
// (set Offset Angle, Roll-in Altitude held or searched); "regionHeld" { points, offsetAngleDeg } the held-altitude
// solutions (heldAltitudeSolutions).
export const OFFSET_DEPENDENCY_WORKER_V0_1 = Object.freeze({ id: "offset-dependency-worker-v0.1", version: "0.1.6", sweep: OFFSET_DEPENDENCY_SWEEP_V0_1.version });

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (event) => {
    const { id, base, assignments, kind } = event.data ?? {};
    let point;
    try {
      point = kind === "region" ? (Number.isFinite(assignments.offsetAngleDeg) ? angleOffCandidate(base, assignments.angleOffDeg, assignments) : regionPoint(base, assignments.angleOffDeg))
        : kind === "regionHeld" ? heldAltitudeSolutions(base, assignments.points, assignments.offsetAngleDeg)
        : kind === "fineTune" ? fineTune(base, assignments)
          : kind === "followerTime" ? solveFollowerReleaseTime(base, assignments.number, assignments.request)
            : sweepPoint(base, assignments);
    } catch (error) { point = { status: "FAILED", messages: [error.message], y: {} }; }
    self.postMessage({ id, point });
  };
}
