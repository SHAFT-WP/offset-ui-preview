import { vecHeading } from "./offset-geometry-v0.2.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

export const OFFSET_FORMATION_V0_1 = Object.freeze({
  id: "offset-formation-v0.1",
  version: "0.1.3",
  status: "work",
  purpose: "Flight-of-4 composition: Formation display offset, element-pair Offset Angle / Action Range options, and drop-order timing deltas, over independently solved offset-be-v0.2 results",
});

const norm = (deg) => ((deg % 360) + 360) % 360;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// Formation position of a wingman relative to its reference aircraft (AG SPEC "Formation
// position"). The relative bearing is measured from the reference aircraft's TAIL (user rule,
// 2026-09-28): 0 = directly behind, 90 = abeam, 180 = directly ahead, on the Left or Right side.
// The follower's own IP is the reference aircraft's IP displaced by this vector.
export function computeFormationOffsetVector({ runInHeadingDeg, relativeBearingDeg, side, distanceNm }) {
  finite("runInHeadingDeg", runInHeadingDeg);
  finite("relativeBearingDeg", relativeBearingDeg);
  finite("distanceNm", distanceNm);
  if (!(relativeBearingDeg >= 0 && relativeBearingDeg <= 180)) {
    throw new RangeError("relativeBearingDeg must be between 0 and 180 deg");
  }
  if (side !== "LEFT" && side !== "RIGHT") throw new TypeError('side must be "LEFT" or "RIGHT"');
  if (!(distanceNm >= 0)) throw new RangeError("distanceNm must be >= 0 NM");

  // Tail = reciprocal of the Run-In; Left of the tail line is further clockwise from the tail.
  const trueBearingDeg = norm(runInHeadingDeg + 180 + (side === "LEFT" ? relativeBearingDeg : -relativeBearingDeg));
  const heading = vecHeading(trueBearingDeg);
  return truncateBeOutput({ trueBearingDeg, vector: { x: heading.x * distanceNm, y: heading.y * distanceNm } });
}

// Offset Angle "Same as Element Lead": substitutes the lead's already-solved value as a
// constant driver for the wingman's own single-aircraft solve (offset-be-v0.2.mjs). Not a new
// lock type — it is mutually exclusive with a manual offsetAngleDeg LOCK on the same aircraft.
export function applyElementLeadOffsetAngle({ leaderResult, followerInput }) {
  const offsetAngleDeg = finite("leaderResult.resolved.offsetAngleDeg", leaderResult?.resolved?.offsetAngleDeg);
  if (!followerInput || typeof followerInput !== "object") throw new TypeError("followerInput is required");
  if (followerInput.locks?.offsetAngleDeg) {
    throw new Error("CONSTRAINT CONFLICT: Same-as-Element-Lead Offset Angle cannot combine with a manual Offset Angle LOCK");
  }
  return { ...followerInput, driver: "offsetAngleDeg", offsetAngleDeg };
}

// Action Range "Same Time as Element Lead" shares this guard with the Offset Angle option:
// both are mutually exclusive with a manual LOCK on the field they would otherwise drive.
export function assertElementSameTimeCompatible(followerLocks = {}) {
  if (followerLocks.actionRangeNm || followerLocks.approachRangeNm) {
    throw new Error("CONSTRAINT CONFLICT: Same-Time-as-Element-Lead Action Range cannot combine with a manual Action Range or Approach Range LOCK");
  }
}

// Driver-agnostic root-find: `evaluate(value)` builds and runs whatever offset call the caller
// needs (varying Roll-in Altitude, Tracking Time, Action Range or any other field) and returns
// its result; this searches `value` until `metric(result)` equals `target` within `tolerance`.
// Bracket-then-bisect, so candidates that throw are skipped rather than aborting the search.
// INVALID results still take part in bracketing (a root often sits on a validity boundary) but
// are never returned as a match: each bracket is bisected until a non-INVALID result is within
// tolerance, and every bracket found by the scan is tried in order before giving up.
export function solveMetricMatch({ target, metric, evaluate, minValue, maxValue, tolerance, steps = 24, refineIterations = 40 }) {
  finite("target", target);
  finite("minValue", minValue);
  finite("maxValue", maxValue);
  finite("tolerance", tolerance);
  if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
  if (typeof metric !== "function") throw new TypeError("metric must be a function");
  if (!(maxValue > minValue)) throw new RangeError("maxValue must be greater than minValue");

  const tryEvaluate = (value) => {
    try {
      const result = evaluate(value);
      return { result, residual: metric(result) - target, value };
    } catch (_) {
      return null; // Candidate is outside the valid geometry/turn/profile range; keep scanning.
    }
  };
  const usable = (sample) => !!sample && sample.result?.state !== "INVALID";
  const matches = (sample) => usable(sample) && Math.abs(sample.residual) <= tolerance;

  const stepCount = Math.max(8, Math.floor(steps));
  const stepSize = (maxValue - minValue) / stepCount;
  let previous = null;
  let best = null;
  const brackets = [];
  for (let index = 0; index <= stepCount; index += 1) {
    const sample = tryEvaluate(minValue + stepSize * index);
    if (!sample) continue;
    if (usable(sample) && (!best || Math.abs(sample.residual) < Math.abs(best.residual))) best = sample;
    if (previous && previous.residual * sample.residual <= 0) brackets.push({ lo: previous, hi: sample });
    previous = sample;
  }

  for (const bracket of brackets) {
    let lo = bracket.lo;
    let hi = bracket.hi;
    if (matches(lo)) return { result: lo.result, residual: lo.residual, value: lo.value, exact: true };
    if (matches(hi)) return { result: hi.result, residual: hi.residual, value: hi.value, exact: true };
    for (let index = 0; index < refineIterations; index += 1) {
      const mid = tryEvaluate((lo.value + hi.value) / 2);
      if (!mid) break;
      if (usable(mid) && (!best || Math.abs(mid.residual) < Math.abs(best.residual))) best = mid;
      if (matches(mid)) return { result: mid.result, residual: mid.residual, value: mid.value, exact: true };
      if (lo.residual * mid.residual <= 0) hi = mid;
      else lo = mid;
    }
  }
  return { result: best?.result ?? null, residual: best?.residual ?? null, value: best?.value ?? null, exact: matches(best) };
}

// IP-to-Action time metric. Offset results report it signed (negative when the Action Point is
// behind IP, i.e. the turn starts before IP); `signedIngressSec` is preferred when present.
function ingressMetric(result) {
  return finite("result.timing.ingressSec", result?.timing?.signedIngressSec ?? result?.timing?.ingressSec);
}

export function solveIngressTimeMatch({ targetIngressSec, evaluate, minValue, maxValue, toleranceSec = 0.05, steps = 24, refineIterations = 40 }) {
  finite("targetIngressSec", targetIngressSec);
  const solved = solveMetricMatch({ target: targetIngressSec, metric: ingressMetric, evaluate, minValue, maxValue, tolerance: toleranceSec, steps, refineIterations });
  return { result: solved.result, residualSec: solved.residual, value: solved.value, exact: solved.exact };
}

// Action Range "Same Time as Element Lead" (FE label "Time #n"): vary this aircraft's own
// IP-referenced Action Range until its own IP -> Action time equals the element lead's (signed).
// Flight aircraft cross their own IPs together and share the lead's Offset speed, so the time
// metric is linear in the IP-referenced Action Range and the lead's own IP -> Action distance is
// already the answer: this starts there and finishes with at most a few secant steps (normally
// one evaluation), instead of a bracket scan whose every candidate reruns an Offset-Angle solve.
// A matched result is returned even when INVALID (e.g. behind this aircraft's own IP because the
// lead turns before its IP) so it is drawn and its errors shown rather than hidden. When the
// secant produces no match and `minActionRangeNm`/`maxActionRangeNm` are given, the bracketed
// solveIngressTimeMatch runs as a fallback.
export function solveElementSameTimeActionRange({ leaderResult, followerLocks = {}, evaluate, initialActionRangeNm, minActionRangeNm, maxActionRangeNm, toleranceSec = 0.05, maxIterations = 8 }) {
  const targetIngressSec = finite("leaderResult.timing.ingressSec", leaderResult?.timing?.signedIngressSec ?? leaderResult?.timing?.ingressSec);
  assertElementSameTimeCompatible(followerLocks);
  if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
  const start = Number.isFinite(initialActionRangeNm) ? initialActionRangeNm : leaderResult?.timing?.ingressDistanceNm;
  const x0 = Number.isFinite(start) ? start : 0;

  const tryEvaluate = (value) => {
    try {
      const result = evaluate(value);
      return { result, value, residual: ingressMetric(result) - targetIngressSec };
    } catch (_) {
      return null;
    }
  };
  let best = null;
  const keep = (sample) => {
    if (sample && (!best || Math.abs(sample.residual) < Math.abs(best.residual))) best = sample;
    return sample;
  };
  let a = keep(tryEvaluate(x0));
  let b = a && Math.abs(a.residual) > toleranceSec ? keep(tryEvaluate(x0 + 0.5)) : null;
  for (let index = 0; a && b && Math.abs(best.residual) > toleranceSec && index < maxIterations; index += 1) {
    const slope = (b.residual - a.residual) / (b.value - a.value);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = keep(tryEvaluate(b.value - b.residual / slope));
    if (!next) break;
    a = b;
    b = next;
  }
  if (best && Math.abs(best.residual) <= toleranceSec) return { result: best.result, residualSec: best.residual, value: best.value, exact: true };
  if (Number.isFinite(minActionRangeNm) && Number.isFinite(maxActionRangeNm)) {
    return solveIngressTimeMatch({ targetIngressSec, evaluate, minValue: minActionRangeNm, maxValue: maxActionRangeNm, toleranceSec });
  }
  return { result: best?.result ?? null, residualSec: best?.residual ?? null, value: best?.value ?? null, exact: false };
}

// Bombing-sequence (drop-order) deconfliction timing, independent of element pairing: each
// aircraft n is compared against its immediate predecessor n-1 (#2 vs #1, #3 vs #2, #4 vs #3).
// Assumes every Flight aircraft crosses its own IP at the same synchronized absolute time, so
// each side's own IP-relative timing can be differenced directly; see AG SPEC "Bombing-sequence
// timing (drop-order chain)" for that working assumption.
export function computeDropOrderDelta({ predecessorResult, ownResult }) {
  const predIpToReleaseSec = finite("predecessorResult.timing.offsetIpToReleaseSec", predecessorResult?.timing?.offsetIpToReleaseSec);
  const predBombTofSec = finite("predecessorResult.profile.public.bombTofSec", predecessorResult?.profile?.public?.bombTofSec);
  const ownIpToReleaseSec = finite("ownResult.timing.offsetIpToReleaseSec", ownResult?.timing?.offsetIpToReleaseSec);
  const ownBombTofSec = finite("ownResult.profile.public.bombTofSec", ownResult?.profile?.public?.bombTofSec);

  const predIpToImpactSec = predIpToReleaseSec + predBombTofSec;
  const ownIpToImpactSec = ownIpToReleaseSec + ownBombTofSec;

  return truncateBeOutput({
    ipToReleaseDeltaSec: ownIpToReleaseSec - predIpToReleaseSec,
    ipToImpactDeltaSec: ownIpToImpactSec - predIpToImpactSec,
    predecessorImpactToOwnReleaseSec: predIpToImpactSec - ownIpToReleaseSec,
    predecessorBombTofSec: predBombTofSec,
  });
}
