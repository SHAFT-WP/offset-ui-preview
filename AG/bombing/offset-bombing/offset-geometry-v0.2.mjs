export const OFFSET_GEOMETRY_V0_2 = Object.freeze({
  id: "offset-geometry-v0.2",
  version: "0.2.2",
  purpose: "Pure Offset Bombing heading/action-point geometry independent of DOM and rendering",
});

const rad = (deg) => (deg * Math.PI) / 180;
const norm = (deg) => ((deg % 360) + 360) % 360;
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const left = (a) => ({ x: -a.y, y: a.x });
const right = (a) => ({ x: a.y, y: -a.x });

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
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

export function actionHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  return norm(direction.offsetDirection === "LEFT" ? runInHeadingDeg - offsetAngleDeg : runInHeadingDeg + offsetAngleDeg);
}

export function angleOffFromAction(actionHeadingDeg, attackHeadingDeg, direction) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  return direction.rollDirection === "RIGHT"
    ? rightDelta(actionHeadingDeg, attackHeadingDeg)
    : leftDelta(actionHeadingDeg, attackHeadingDeg);
}

export function angleOffFromOffset(runInHeadingDeg, attackHeadingDeg, offsetAngleDeg, direction = directionRule(runInHeadingDeg, attackHeadingDeg)) {
  const actionHeadingDeg = actionHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  return angleOffFromAction(actionHeadingDeg, attackHeadingDeg, direction);
}

export function offsetAngleFromAngleOff(runInHeadingDeg, attackHeadingDeg, angleOffDeg, direction = directionRule(runInHeadingDeg, attackHeadingDeg)) {
  if (!direction || direction.ambiguous) throw new Error("direction is ambiguous");
  const actionHeadingDeg = norm(direction.rollDirection === "RIGHT" ? attackHeadingDeg - angleOffDeg : attackHeadingDeg + angleOffDeg);
  return direction.offsetDirection === "LEFT"
    ? leftDelta(runInHeadingDeg, actionHeadingDeg)
    : rightDelta(runInHeadingDeg, actionHeadingDeg);
}

function lineIntersection(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-10) return null;
  return add(p, mul(d, cross(sub(q, p), e) / den));
}

function transformLocal(local, startHeadingDeg, rollDirection) {
  const forward = vecHeading(startHeadingDeg);
  const rightVector = right(forward);
  const turnSide = rollDirection === "RIGHT" ? local.turnSide : -local.turnSide;
  return add(mul(forward, local.forward), mul(rightVector, turnSide));
}

export function buildOffsetCandidate(input) {
  const { runInHeadingDeg, attackHeadingDeg, offsetAngleDeg, offsetRadiusNm, ipRangeNm, profile } = input;
  [
    ["runInHeadingDeg", runInHeadingDeg], ["attackHeadingDeg", attackHeadingDeg], ["offsetAngleDeg", offsetAngleDeg],
    ["offsetRadiusNm", offsetRadiusNm], ["ipRangeNm", ipRangeNm],
  ].forEach(([name, value]) => requireFinite(name, value));
  if (!(offsetAngleDeg > 0 && offsetAngleDeg < 179.5)) throw new RangeError("Offset Angle must be > 0 and < 179.5 deg");
  if (!(offsetRadiusNm > 0)) throw new RangeError("Offset Radius must be > 0 NM");
  if (!(ipRangeNm >= 0)) throw new RangeError("VIP Range must be >= 0 NM");
  if (!profile?.public || !profile?.diagnostics || !profile?.visualization) throw new TypeError("profile must be a BDP semantic result");

  const direction = directionRule(runInHeadingDeg, attackHeadingDeg);
  if (direction.ambiguous) throw new Error("Run-In / Attack relation is directionally ambiguous");
  const actionHeadingDeg = actionHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  const angleOffDeg = angleOffFromAction(actionHeadingDeg, attackHeadingDeg, direction);
  if (!(angleOffDeg > 0 && angleOffDeg < 179.5)) throw new RangeError("Angle-Off is outside the supported range");

  const targetLocal = {
    forward: profile.diagnostics.targetForwardNm,
    turnSide: profile.diagnostics.targetTurnSideNm,
  };
  const targetVector = transformLocal(targetLocal, actionHeadingDeg, direction.rollDirection);
  const rollStart = mul(targetVector, -1);
  const rollDisplacementGlobal = transformLocal({
    forward: profile.public.rollInDisplacement.forwardNm,
    turnSide: profile.public.rollInDisplacement.turnSideNm,
  }, actionHeadingDeg, direction.rollDirection);
  const trackPoint = add(rollStart, rollDisplacementGlobal);
  const actionVector = vecHeading(actionHeadingDeg);
  const runVector = vecHeading(runInHeadingDeg);
  const temporaryActionPoint = lineIntersection({ x: 0, y: 0 }, mul(runVector, -1), rollStart, actionVector);
  if (!temporaryActionPoint) throw new Error("Run-In and Action lines are parallel");

  const temporaryActionRangeNm = len(temporaryActionPoint);
  const turnRadiusCorrectionNm = offsetRadiusNm * Math.tan(rad(offsetAngleDeg) / 2);
  const realActionPoint = sub(temporaryActionPoint, mul(runVector, turnRadiusCorrectionNm));
  const turnEnd = add(temporaryActionPoint, mul(actionVector, turnRadiusCorrectionNm));
  const actionRangeNm = len(realActionPoint);
  const actionLegDistanceNm = dot(sub(rollStart, turnEnd), actionVector);
  const offsetNormal = direction.offsetDirection === "LEFT" ? left(runVector) : right(runVector);
  const offsetCenter = add(realActionPoint, mul(offsetNormal, offsetRadiusNm));

  const rollInRadiusNm = profile.public.rollInRadiusNm;
  const rollNormal = direction.rollDirection === "RIGHT" ? right(actionVector) : left(actionVector);
  const rollCenter = Number.isFinite(rollInRadiusNm) ? add(rollStart, mul(rollNormal, rollInRadiusNm)) : null;

  const rollInTrajectorySamples = profile.visualization.rollInTrajectorySamples.map((sample) => {
    const transformed = transformLocal({ forward: sample.forwardNm, turnSide: sample.turnSideNm }, actionHeadingDeg, direction.rollDirection);
    return add(rollStart, transformed);
  });

  const ipPoint = mul(runVector, -ipRangeNm);
  return {
    runInHeadingDeg,
    attackHeadingDeg,
    actionHeadingDeg,
    offsetAngleDeg,
    angleOffDeg,
    direction,
    temporaryActionRangeNm,
    turnRadiusCorrectionNm,
    actionRangeNm,
    actionLegDistanceNm,
    rollInRangeNm: profile.public.rollInRangeNm,
    rollInRadiusNm,
    groundRangeNm: profile.public.groundRangeNm,
    points: { target: { x: 0, y: 0 }, ip: ipPoint, vip: ipPoint, rollStart, trackPoint, temporaryActionPoint, realActionPoint, turnEnd, offsetCenter, rollCenter },
    vectors: { runVector, actionVector },
    rollInTrajectorySamples,
    profile,
  };
}

export function buildReferenceState(candidate, input) {
  const mode = input.referenceMode === "VIP" ? "VIP" : "VRP";
  const warnings = [];
  const errors = [];
  const ipRangeNm = Number.isFinite(input.ipRangeNm) ? Math.max(0, input.ipRangeNm) : Infinity;

  if (mode === "VIP") {
    const displayRangeNm = Number.isFinite(input.ipRangeNm) ? Math.max(0, input.ipRangeNm) : 0;
    if (Number.isFinite(input.ipRangeNm) && input.ipRangeNm < 0) errors.push("VIP-to-Target range must be >= 0 NM");
    return {
      mode,
      linked: true,
      requestedRangeNm: displayRangeNm,
      displayRangeNm,
      point: { ...candidate.points.ip },
      clampedAtTarget: false,
      clampedAtIp: false,
      errors,
      warnings,
    };
  }

  const linked = input.vrpLinked !== false;
  let requestedRangeNm = linked ? candidate.actionRangeNm : input.vrpRangeNm;
  if (!Number.isFinite(requestedRangeNm)) requestedRangeNm = candidate.actionRangeNm;
  if (requestedRangeNm < 0) errors.push("VRP cannot be placed beyond Target; range must be >= 0 NM");
  if (requestedRangeNm > ipRangeNm) errors.push("VRP must be between VIP and Target; range must be <= VIP Range");
  const clampedAtTarget = requestedRangeNm < 0;
  const clampedAtIp = requestedRangeNm > ipRangeNm;
  const displayRangeNm = Math.min(ipRangeNm, Math.max(0, requestedRangeNm));
  const point = mul(candidate.vectors.runVector, -displayRangeNm);
  const projectionOnRun = dot(point, candidate.vectors.runVector);
  if (projectionOnRun > 1e-9) errors.push("VRP reference projection passed Target");
  return { mode, linked, requestedRangeNm, displayRangeNm, point, clampedAtTarget, clampedAtIp, errors, warnings };
}

export function validateOffsetCandidate(candidate, input = {}) {
  const errors = [];
  const warnings = [];
  if (candidate.actionLegDistanceNm < 0) errors.push("Offset Turn End has passed Roll-in Start");
  else if (candidate.actionLegDistanceNm < 0.25) warnings.push("Offset Turn End to Roll-in Start Approach is very short");
  if (candidate.offsetAngleDeg >= 120) warnings.push("Offset Angle is 120 deg or greater");

  const actionPointRunRangeNm = -dot(candidate.points.realActionPoint, candidate.vectors.runVector);
  if (actionPointRunRangeNm < -0.001) {
    errors.push("Action Point must be between VIP and Target; Action Point has passed Target");
  } else if (Number.isFinite(input.ipRangeNm) && actionPointRunRangeNm > input.ipRangeNm + 0.001) {
    errors.push("Action Point must be between VIP and Target; Action Point has passed VIP");
  }
  return { errors, warnings };
}

export function solveOffsetAngleForActionRange({ targetRangeNm, evaluate, minOffsetAngleDeg = 0.05, maxOffsetAngleDeg = 120, toleranceNm = 0.002 }) {
  requireFinite("targetRangeNm", targetRangeNm);
  if (typeof evaluate !== "function") throw new TypeError("evaluate must be a function");
  let previous = null;
  let best = null;
  let bracket = null;
  for (let angle = minOffsetAngleDeg; angle <= maxOffsetAngleDeg + 1e-9; angle += 1) {
    try {
      const candidate = evaluate(angle);
      const residual = candidate.actionRangeNm - targetRangeNm;
      if (!best || Math.abs(residual) < Math.abs(best.residual)) best = { candidate, residual, angle };
      if (previous && previous.residual * residual <= 0) { bracket = { lo: previous.angle, hi: angle, flo: previous.residual }; break; }
      previous = { angle, residual };
    } catch (_) {}
  }
  if (!bracket) return { candidate: best?.candidate ?? null, residualNm: best?.residual ?? null, exact: !!best && Math.abs(best.residual) <= toleranceNm };

  let lo = bracket.lo;
  let hi = bracket.hi;
  let flo = bracket.flo;
  let candidate = null;
  let residual = null;
  for (let index = 0; index < 36; index += 1) {
    const mid = (lo + hi) / 2;
    candidate = evaluate(mid);
    residual = candidate.actionRangeNm - targetRangeNm;
    if (Math.abs(residual) <= toleranceNm) break;
    if (flo * residual <= 0) hi = mid;
    else { lo = mid; flo = residual; }
  }
  return { candidate, residualNm: residual, exact: !!candidate && Math.abs(residual) <= toleranceNm };
}