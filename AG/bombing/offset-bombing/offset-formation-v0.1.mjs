import { vecHeading } from "./offset-geometry-v0.2.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

export const OFFSET_FORMATION_V0_1 = Object.freeze({
  id: "offset-formation-v0.1",
  version: "0.1.1",
  status: "work",
  purpose: "Flight-of-4 composition: Formation display offset, element-pair Offset Angle / Action Range options, and drop-order timing deltas, over independently solved offset-be-v0.2 results",
});

const norm = (deg) => ((deg % 360) + 360) % 360;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// Formation position offsets #2/#3/#4 from #1's nose only (AG SPEC "Formation position"); a
// follower's own Offset/BDP solve never reads this vector back. It is provided for Top View
// display composition (leader profile as background, follower profile drawn from the same Target).
export function computeFormationOffsetVector({ runInHeadingDeg, relativeBearingDeg, side, distanceNm }) {
  finite("runInHeadingDeg", runInHeadingDeg);
  finite("relativeBearingDeg", relativeBearingDeg);
  finite("distanceNm", distanceNm);
  if (!(relativeBearingDeg >= 0 && relativeBearingDeg <= 180)) {
    throw new RangeError("relativeBearingDeg must be between 0 and 180 deg");
  }
  if (side !== "LEFT" && side !== "RIGHT") throw new TypeError('side must be "LEFT" or "RIGHT"');
  if (!(distanceNm >= 0)) throw new RangeError("distanceNm must be >= 0 NM");

  const trueBearingDeg = norm(runInHeadingDeg + (side === "LEFT" ? -relativeBearingDeg : relativeBearingDeg));
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

// Driver-agnostic root-find: `evaluate(value)` builds and runs whatever offset-be-v0.2 call the
// caller needs (varying actionRangeNm, offset TAS, or any other field) and returns its result;
// this searches `value` until the result's IP-to-Action elapsed time matches `targetIngressSec`.
// Mirrors the bracket-then-bisect pattern already used by solveOffsetAngleForMetric so
// candidates that throw are skipped rather than aborting the search.
//
// The metric is the *signed* IP-to-Action time (`timing.signedIngressSec`, negative when the
// Action Point is behind IP) when the result provides it. The clamped `ingressSec` is flat at 0
// for every Action Point behind IP, which let a degenerate INVALID geometry "match" an element
// lead with zero ingress. INVALID results still take part in bracketing (the root often sits
// exactly on the Action Point = IP validity boundary) but are never returned as a match: each
// bracket is bisected until a non-INVALID result is within tolerance, and every bracket found by
// the scan is tried in order before giving up.
function ingressMetric(result) {
  return finite("result.timing.ingressSec", result?.timing?.signedIngressSec ?? result?.timing?.ingressSec);
}

export function solveIngressTimeMatch({ targetIngressSec, evaluate, minValue, maxValue, toleranceSec = 0.05, steps = 24, refineIterations = 40 }) {
  finite("targetIngressSec", targetIngressSec);
  finite("minValue", minValue);
  finite("maxValue", maxValue);
  if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
  if (!(maxValue > minValue)) throw new RangeError("maxValue must be greater than minValue");

  const tryEvaluate = (value) => {
    try {
      const result = evaluate(value);
      return { result, residual: ingressMetric(result) - targetIngressSec, value };
    } catch (_) {
      return null; // Candidate is outside the valid geometry/turn range; keep scanning.
    }
  };
  const usable = (sample) => !!sample && sample.result?.state !== "INVALID";
  const matches = (sample) => usable(sample) && Math.abs(sample.residual) <= toleranceSec;

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
    if (matches(lo)) return { result: lo.result, residualSec: lo.residual, exact: true };
    if (matches(hi)) return { result: hi.result, residualSec: hi.residual, exact: true };
    for (let index = 0; index < refineIterations; index += 1) {
      const mid = tryEvaluate((lo.value + hi.value) / 2);
      if (!mid) break;
      if (usable(mid) && (!best || Math.abs(mid.residual) < Math.abs(best.residual))) best = mid;
      if (matches(mid)) return { result: mid.result, residualSec: mid.residual, exact: true };
      if (lo.residual * mid.residual <= 0) hi = mid;
      else lo = mid;
    }
  }
  return { result: best?.result ?? null, residualSec: best?.residual ?? null, exact: matches(best) };
}

// Concrete v0.1 convenience for the common case: vary Action Range (the wingman's own
// coupled solve then re-derives everything else, same as any other Action-Range-driven call)
// until the wingman's own IP-to-Action time equals the element lead's. `evaluate(actionRangeNm)`
// is supplied by the caller so this module never imports offset-be-v0.2.mjs directly.
// `minActionRangeNm` defaults below zero because the element lead's own default (VRP-start
// policy) commonly has exactly zero ingress time; the search must bracket through 0 to reach
// that target, and the caller's own geometry validity check (not this range) is what actually
// rejects an Action Point behind IP.
export function solveElementSameTimeActionRange({ leaderResult, followerLocks = {}, evaluate, minActionRangeNm = -0.5, maxActionRangeNm, toleranceSec = 0.05 }) {
  const targetIngressSec = finite("leaderResult.timing.ingressSec", leaderResult?.timing?.ingressSec);
  assertElementSameTimeCompatible(followerLocks);
  const upperBound = finite("maxActionRangeNm", maxActionRangeNm);
  return solveIngressTimeMatch({ targetIngressSec, evaluate, minValue: minActionRangeNm, maxValue: upperBound, toleranceSec });
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
