export const OFFSET_GEOMETRY_V0_2 = Object.freeze({
  id: "offset-geometry-v0.2",
  // 0.2.6 (2026-10-12): scanOffsetAngleRoot — the shared Offset Angle root scan (F4): a rejected
  // candidate ends the bracket, the end boundary is evaluated, a rejected bisection step moves on to
  // the next bracket instead of aborting.
  // 0.2.7 (2026-10-15, owner, BDP update R2.1): placeOffsetTurn — with an onset level turn (Common
  // onset-level-turn-v0.1) the Action Point and Turn End sit T_in / T_out from the corner and the flown turn
  // path is returned; without one the instantaneous fillet R·tan(θ/2) is unchanged.
  version: "0.2.7",
  purpose: "Pure Offset Bombing heading/action-point/reference geometry independent of DOM and rendering",
});

export const DEFAULT_REFERENCE_RANGE_NM = 10;

const rad = (deg) => (deg * Math.PI) / 180;
const norm = (deg) => ((deg % 360) + 360) % 360;
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const left = (a) => ({ x: -a.y, y: a.x });
export const right = (a) => ({ x: a.y, y: -a.x });

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function vecHeading(headingDeg) {
  const a = rad(norm(headingDeg));
  return { x: Math.sin(a), y: Math.cos(a) };
}

export function signedHeadingDelta(fromDeg, toDeg) {
  return ((norm(toDeg) - norm(fromDeg) + 540) % 360) - 180;
}

export function directionRule(runInHeadingDeg, attackHeadingDeg) {
  const delta = signedHeadingDelta(runInHeadingDeg, attackHeadingDeg);
  if (Math.abs(delta) < 1e-7 || Math.abs(Math.abs(delta) - 180) < 1e-7) {
    return { ambiguous: true, deltaDeg: delta, attackSide: null, offsetDirection: null, rollDirection: null };
  }
  return delta > 0
    ? { ambiguous: false, deltaDeg: delta, attackSide: "RIGHT", offsetDirection: "LEFT", rollDirection: "RIGHT" }
    : { ambiguous: false, deltaDeg: delta, attackSide: "LEFT", offsetDirection: "RIGHT", rollDirection: "LEFT" };
}

function rightDelta(fromDeg, toDeg) { return (norm(toDeg) - norm(fromDeg) + 360) % 360; }
function leftDelta(fromDeg, toDeg) { return (norm(fromDeg) - norm(toDeg) + 360) % 360; }

export function offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  return norm(direction.offsetDirection === "LEFT" ? runInHeadingDeg - offsetAngleDeg : runInHeadingDeg + offsetAngleDeg);
}

export function angleOffFromOffsetHeading(offsetHeadingDeg, attackHeadingDeg, direction) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  return direction.rollDirection === "RIGHT"
    ? rightDelta(offsetHeadingDeg, attackHeadingDeg)
    : leftDelta(offsetHeadingDeg, attackHeadingDeg);
}

export function angleOffFromOffset(runInHeadingDeg, attackHeadingDeg, offsetAngleDeg, direction = directionRule(runInHeadingDeg, attackHeadingDeg)) {
  const offsetHeadingDeg = offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  return angleOffFromOffsetHeading(offsetHeadingDeg, attackHeadingDeg, direction);
}

export function offsetAngleFromAngleOff(runInHeadingDeg, attackHeadingDeg, angleOffDeg, direction = directionRule(runInHeadingDeg, attackHeadingDeg)) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  const offsetHeadingDeg = norm(direction.rollDirection === "RIGHT" ? attackHeadingDeg - angleOffDeg : attackHeadingDeg + angleOffDeg);
  return direction.offsetDirection === "LEFT"
    ? leftDelta(runInHeadingDeg, offsetHeadingDeg)
    : rightDelta(runInHeadingDeg, offsetHeadingDeg);
}

export function resolveReferenceInputs(input = {}) {
  const runInHeadingDeg = norm(finiteOr(input.runInHeadingDeg, 0));
  const vipToTargetBearingDeg = norm(finiteOr(input.vipToTargetBearingDeg, runInHeadingDeg));
  const vipRangeNm = finiteOr(input.vipRangeNm, DEFAULT_REFERENCE_RANGE_NM);
  const vrpBearingDeg = norm(finiteOr(input.vrpBearingDeg, runInHeadingDeg + 180));
  const vrpRangeNm = finiteOr(input.vrpRangeNm, DEFAULT_REFERENCE_RANGE_NM);
  // IP is a tactical point independent of the VIP reference (2026-09-26): an absent IP Range
  // falls back to the plain default range, never to VIP Range.
  const ipRangeNm = finiteOr(input.ipRangeNm, DEFAULT_REFERENCE_RANGE_NM);
  return { runInHeadingDeg, ipRangeNm, vipToTargetBearingDeg, vipRangeNm, vrpBearingDeg, vrpRangeNm };
}

export function lineIntersection(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-10) return null;
  return add(p, mul(d, cross(sub(q, p), e) / den));
}

export function transformLocal(local, startHeadingDeg, rollDirection) {
  const forward = vecHeading(startHeadingDeg);
  const rightVector = right(forward);
  const turnSide = rollDirection === "RIGHT" ? local.turnSide : -local.turnSide;
  return add(mul(forward, local.forward), mul(rightVector, turnSide));
}

// Offset turn placement on the Run-In / Offset Heading corner. With `offsetTurn` (an onset level turn for this
// Offset Angle) the turn starts T_in before the corner and ends T_out after it; its center is the hold arc's
// (null when the turn has no hold) and its flown path is returned with times. Without it the instantaneous
// fillet R·tan(θ/2) applies on both sides.
export function placeOffsetTurn({ temporaryActionPoint, runVector, offsetVector, direction, offsetRadiusNm, offsetAngleDeg, offsetTurn = null }) {
  const offsetNormal = direction.offsetDirection === "LEFT" ? left(runVector) : right(runVector);
  if (!offsetTurn) {
    const turnRadiusCorrectionNm = offsetRadiusNm * Math.tan(rad(offsetAngleDeg) / 2);
    const realActionPoint = sub(temporaryActionPoint, mul(runVector, turnRadiusCorrectionNm));
    return {
      turnRadiusCorrectionNm,
      turnExitDistanceNm: turnRadiusCorrectionNm,
      realActionPoint,
      turnEnd: add(temporaryActionPoint, mul(offsetVector, turnRadiusCorrectionNm)),
      offsetCenter: add(realActionPoint, mul(offsetNormal, offsetRadiusNm)),
      offsetHoldStart: null,
      offsetHoldEnd: null,
      offsetTurnPath: null,
    };
  }
  const realActionPoint = sub(temporaryActionPoint, mul(runVector, offsetTurn.entryDistanceNm));
  const toWorld = (local) => add(realActionPoint, add(mul(runVector, local.forwardNm), mul(offsetNormal, local.turnSideNm)));
  return {
    turnRadiusCorrectionNm: offsetTurn.entryDistanceNm,
    turnExitDistanceNm: offsetTurn.exitDistanceNm,
    realActionPoint,
    turnEnd: add(temporaryActionPoint, mul(offsetVector, offsetTurn.exitDistanceNm)),
    offsetCenter: offsetTurn.hold ? toWorld(offsetTurn.hold.center) : null,
    offsetHoldStart: offsetTurn.hold ? toWorld(offsetTurn.hold.start) : null,
    offsetHoldEnd: offsetTurn.hold ? toWorld(offsetTurn.hold.end) : null,
    offsetTurnPath: offsetTurn.samples.map((sample) => ({ ...toWorld(sample), tSec: sample.tSec, phase: sample.phase })),
  };
}

export function buildOffsetCandidate(input) {
  const { attackHeadingDeg, offsetAngleDeg, offsetRadiusNm, profile } = input;
  const refs = resolveReferenceInputs(input);
  const runInHeadingDeg = refs.runInHeadingDeg;
  const ipRangeNm = refs.ipRangeNm;
  [
    ["runInHeadingDeg", runInHeadingDeg], ["attackHeadingDeg", attackHeadingDeg], ["offsetAngleDeg", offsetAngleDeg],
    ["offsetRadiusNm", offsetRadiusNm], ["ipRangeNm", ipRangeNm],
  ].forEach(([name, value]) => requireFinite(name, value));
  if (!(offsetAngleDeg > 0 && offsetAngleDeg < 179.5)) throw new RangeError("Offset Angle must be > 0 and < 179.5 deg");
  if (!(offsetRadiusNm > 0)) throw new RangeError("Offset Radius must be > 0 NM");
  if (!(ipRangeNm >= 0)) throw new RangeError("IP Range must be >= 0 NM");
  if (!profile?.public || !profile?.diagnostics || !profile?.visualization) throw new TypeError("profile must be a BDP semantic result");

  const direction = directionRule(runInHeadingDeg, attackHeadingDeg);
  if (direction.ambiguous) throw new Error("Run-In / Attack relation is directionally ambiguous");
  const offsetHeadingDeg = offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  const angleOffDeg = angleOffFromOffsetHeading(offsetHeadingDeg, attackHeadingDeg, direction);
  if (!(angleOffDeg > 0 && angleOffDeg < 179.5)) throw new RangeError("Angle-Off is outside the supported range");

  const targetLocal = {
    forward: profile.diagnostics.targetForwardNm,
    turnSide: profile.diagnostics.targetTurnSideNm,
  };
  const targetVector = transformLocal(targetLocal, offsetHeadingDeg, direction.rollDirection);
  const rollStart = mul(targetVector, -1);
  const rollDisplacementGlobal = transformLocal({
    forward: profile.public.rollInDisplacement.forwardNm,
    turnSide: profile.public.rollInDisplacement.turnSideNm,
  }, offsetHeadingDeg, direction.rollDirection);
  const trackPoint = add(rollStart, rollDisplacementGlobal);
  const offsetVector = vecHeading(offsetHeadingDeg);
  const runVector = vecHeading(runInHeadingDeg);
  const temporaryActionPoint = lineIntersection({ x: 0, y: 0 }, mul(runVector, -1), rollStart, offsetVector);
  if (!temporaryActionPoint) throw new Error("Run-In and Offset lines are parallel");

  const temporaryActionRangeNm = len(temporaryActionPoint);
  const offsetTurn = input.offsetTurn ?? null;
  const placed = placeOffsetTurn({ temporaryActionPoint, runVector, offsetVector, direction, offsetRadiusNm, offsetAngleDeg, offsetTurn });
  const { turnRadiusCorrectionNm, turnExitDistanceNm, realActionPoint, turnEnd, offsetCenter, offsetHoldStart, offsetHoldEnd } = placed;
  const actionRangeNm = len(realActionPoint);
  const approachRangeNm = dot(sub(rollStart, turnEnd), offsetVector);

  const rollInRadiusNm = profile.public.rollInRadiusNm;
  const rollNormal = direction.rollDirection === "RIGHT" ? right(offsetVector) : left(offsetVector);
  const rollCenter = Number.isFinite(rollInRadiusNm) ? add(rollStart, mul(rollNormal, rollInRadiusNm)) : null;

  const rollInTrajectorySamples = profile.visualization.rollInTrajectorySamples.map((sample) => {
    const transformed = transformLocal({ forward: sample.forwardNm, turnSide: sample.turnSideNm }, offsetHeadingDeg, direction.rollDirection);
    return add(rollStart, transformed);
  });

  const target = { x: 0, y: 0 };
  const ipPoint = mul(runVector, -ipRangeNm);
  const vipPoint = sub(target, mul(vecHeading(refs.vipToTargetBearingDeg), refs.vipRangeNm));
  const vrpPoint = add(target, mul(vecHeading(refs.vrpBearingDeg), refs.vrpRangeNm));

  return {
    runInHeadingDeg,
    attackHeadingDeg,
    offsetHeadingDeg,
    offsetAngleDeg,
    angleOffDeg,
    direction,
    temporaryActionRangeNm,
    turnRadiusCorrectionNm,
    turnExitDistanceNm,
    actionRangeNm,
    approachRangeNm,
    rollInRangeNm: profile.public.rollInRangeNm,
    rollInRadiusNm,
    groundRangeNm: profile.public.groundRangeNm,
    referenceInputs: refs,
    points: { target, ip: ipPoint, vip: vipPoint, vrp: vrpPoint, rollStart, trackPoint, temporaryActionPoint, realActionPoint, turnEnd, offsetCenter, offsetHoldStart, offsetHoldEnd, rollCenter },
    vectors: { runVector, offsetVector },
    offsetTurn,
    offsetTurnPath: placed.offsetTurnPath,
    rollInTrajectorySamples,
    profile,
  };
}

export function buildReferenceState(candidate, input = {}) {
  const mode = input.referenceMode === "VIP" ? "VIP" : "VRP";
  const warnings = [];
  const errors = [];
  const refs = candidate.referenceInputs ?? resolveReferenceInputs({ ...input, runInHeadingDeg: candidate.runInHeadingDeg });

  if (mode === "VIP") {
    const requestedRangeNm = refs.vipRangeNm;
    if (requestedRangeNm < 0) errors.push("VIP Range must be >= 0 NM");
    const displayRangeNm = Math.max(0, requestedRangeNm);
    const point = requestedRangeNm >= 0 ? { ...candidate.points.vip } : { ...candidate.points.target };
    return {
      mode,
      linked: false,
      requestedRangeNm,
      displayRangeNm,
      bearingDeg: refs.vipToTargetBearingDeg,
      point,
      clampedAtTarget: requestedRangeNm < 0,
      clampedAtIp: false,
      errors,
      warnings,
    };
  }

  const requestedRangeNm = refs.vrpRangeNm;
  if (requestedRangeNm < 0) errors.push("VRP Range must be >= 0 NM");
  const displayRangeNm = Math.max(0, requestedRangeNm);
  const point = requestedRangeNm >= 0
      ? add(candidate.points.target, mul(vecHeading(refs.vrpBearingDeg), displayRangeNm))
      : { ...candidate.points.target };
  return {
    mode,
    linked: false,
    requestedRangeNm,
    displayRangeNm,
    bearingDeg: refs.vrpBearingDeg,
    point,
    clampedAtTarget: requestedRangeNm < 0,
    clampedAtIp: false,
    errors,
    warnings,
  };
}

export function validateOffsetCandidate(candidate, input = {}) {
  const errors = [];
  const warnings = [];
  const approachRangeNm = candidate.approachRangeNm;
  if (approachRangeNm < 0) errors.push("Offset Turn End has passed Roll-in Start");
  else if (approachRangeNm < 0.25) warnings.push("Approach Range is very short");
  if (candidate.offsetAngleDeg >= 120) warnings.push("Offset Angle is 120 deg or greater");

  const actionPointRunRangeNm = -dot(candidate.points.realActionPoint, candidate.vectors.runVector);
  if (actionPointRunRangeNm < -0.001) {
    errors.push("Action Point must be between IP and Target; Action Point has passed Target");
  } else if (Number.isFinite(input.ipRangeNm) && actionPointRunRangeNm > input.ipRangeNm + 0.001) {
    errors.push("Action Point must be between IP and Target; Action Point has passed IP");
  }
  return { errors, warnings };
}

// Names the most frequent reason scanned candidates were rejected (Map message -> count), so a
// failed solve reports its cause (e.g. the BDP error) instead of only "no candidate".
export function candidateFailureCause(errors) {
  let top = null;
  for (const [message, count] of errors) if (!top || count > top.count) top = { message, count };
  return top?.message ?? null;
}

// Offset Angle root scan shared by the single-aircraft (offset-be-v0.2.mjs) and off-axis
// (offset-formation-geometry-v0.1.mjs) solves. `evaluate(angle)` returns a candidate or throws for a
// rejected one; `metric(candidate)` is compared with `targetValue`. 1° scan from `minAngleDeg`, the
// end boundary `maxAngleDeg` included; a sign change between two successive accepted candidates is a
// bracket (a rejected candidate between them is a gap, never bridged); each bracket is bisected and
// the first one whose bisection reaches `tolerance` wins. A bisection step that is rejected abandons
// that bracket and the scan continues after it. Without a match the closest accepted candidate is
// returned (`exact` false) with the most frequent rejection cause.
export function scanOffsetAngleRoot({ targetValue, evaluate, metric, minAngleDeg = 0.05, maxAngleDeg = 120, tolerance, refineIterations }) {
  requireFinite("targetValue", targetValue);
  requireFinite("tolerance", tolerance);
  if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
  if (typeof metric !== "function") throw new TypeError("metric must be a function");
  const errors = new Map();
  const reject = (error) => errors.set(error.message, (errors.get(error.message) ?? 0) + 1);
  const sample = (angle) => {
    try {
      const candidate = evaluate(angle);
      return { angle, candidate, residual: metric(candidate) - targetValue };
    } catch (error) {
      reject(error);
      return null;
    }
  };
  const angles = [];
  for (let angle = minAngleDeg; angle <= maxAngleDeg + 1e-9; angle += 1) angles.push(angle);
  if (!angles.length || angles[angles.length - 1] < maxAngleDeg - 1e-9) angles.push(maxAngleDeg);

  let best = null;
  const keep = (item) => { if (item && Number.isFinite(item.residual) && (!best || Math.abs(item.residual) < Math.abs(best.residual))) best = item; };
  let previous = null;
  for (const angle of angles) {
    const current = sample(angle);
    keep(current);
    if (!current || !Number.isFinite(current.residual)) { previous = null; continue; }
    if (previous && previous.residual * current.residual <= 0) {
      let lo = previous.angle;
      let hi = current.angle;
      let flo = previous.residual;
      let match = null;
      for (let index = 0; index < refineIterations; index += 1) {
        const mid = sample((lo + hi) / 2);
        if (!mid || !Number.isFinite(mid.residual)) { match = null; break; }
        keep(mid);
        if (Math.abs(mid.residual) <= tolerance) { match = mid; break; }
        if (flo * mid.residual <= 0) hi = mid.angle;
        else { lo = mid.angle; flo = mid.residual; }
        match = mid;
      }
      if (match) return { candidate: match.candidate, residual: match.residual, exact: Math.abs(match.residual) <= tolerance, failureCause: null };
    }
    previous = current;
  }
  return { candidate: best?.candidate ?? null, residual: best?.residual ?? null, exact: !!best && Math.abs(best.residual) <= tolerance, failureCause: candidateFailureCause(errors) };
}

export function solveOffsetAngleForActionRange({ targetRangeNm, evaluate, minOffsetAngleDeg = 0.05, maxOffsetAngleDeg = 120, toleranceNm = 0.002 }) {
  requireFinite("targetRangeNm", targetRangeNm);
  const solved = scanOffsetAngleRoot({
    targetValue: targetRangeNm,
    evaluate,
    metric: (candidate) => candidate.actionRangeNm,
    minAngleDeg: minOffsetAngleDeg,
    maxAngleDeg: maxOffsetAngleDeg,
    tolerance: toleranceNm,
    refineIterations: 36,
  });
  return { candidate: solved.candidate, residualNm: solved.residual, exact: solved.exact, failureCause: solved.failureCause };
}
