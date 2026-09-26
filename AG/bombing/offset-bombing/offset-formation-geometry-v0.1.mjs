import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { calculateBombDeliveryV0_3 } from "../bomb-delivery-planner/bomb-delivery-planner-v0.3.mjs";
import { resolveOffsetTurn } from "./offset-be-v0.2.mjs";
import {
  add,
  angleOffFromOffsetHeading,
  directionRule,
  dot,
  left,
  lineIntersection,
  mul,
  offsetAngleFromAngleOff,
  offsetHeadingFromOffset,
  right,
  solveOffsetAngleForActionRange,
  sub,
  transformLocal,
  vecHeading,
} from "./offset-geometry-v0.2.mjs";

export const OFFSET_FORMATION_GEOMETRY_V0_1 = Object.freeze({
  id: "offset-formation-geometry-v0.1",
  version: "0.1.1",
  status: "work",
  purpose:
    "Off-axis Offset geometry for a Flight follower whose IP is displaced from the shared Target-through Run-In axis by its Formation position, while Target and Run-In heading stay shared with its element lead. Reuses offset-geometry-v0.2.mjs's pure heading/vector helpers without modifying offset-be-v0.2.mjs or offset-geometry-v0.2.mjs's own single-aircraft (on-axis) contract.",
});

const FT_PER_NM = 6076.11549;
const KT_TO_FPS = 1.687809857;
const rad = (deg) => (deg * Math.PI) / 180;
const norm = (deg) => ((deg % 360) + 360) % 360;
const near = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function finitePoint(name, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new TypeError(`${name} must be a finite {x,y} point`);
  return point;
}

function speedToTas(speedValue, speedMode, altitudeMslFt) {
  return speedMode === "MACH" ? machToTas(speedValue, altitudeMslFt) : casToTas(speedValue, altitudeMslFt);
}

function canonicalProfileInput(input, angleOffDeg) {
  const profile = input.profile ?? {};
  const diveAngleDeg = finite("diveAngleDeg", profile.diveAngleDeg ?? input.diveAngleDeg);
  return {
    weaponId: profile.weaponId ?? "M82",
    targetElevationMslFt: finite("targetElevationMslFt", profile.targetElevationMslFt),
    releaseSpeedKcas: finite("releaseSpeedKcas", profile.releaseSpeedKcas),
    speedOvershootKcas: profile.speedOvershootKcas ?? 50,
    fragmentHeightMarginPercent: profile.fragmentHeightMarginPercent ?? 20,
    recoveryG: profile.recoveryG ?? 5,
    gOnsetTimeSec: profile.gOnsetTimeSec ?? 2,
    diveAngleDeg,
    releaseFpaDeg: -diveAngleDeg,
    windDirectionDeg: profile.windDirectionDeg ?? 0,
    windSpeedKt: profile.windSpeedKt ?? 0,
    initialSpeedValue: finite("initialSpeedValue", profile.initialSpeedValue),
    initialSpeedMode: profile.initialSpeedMode ?? "CAS",
    initialAltitudeMslFt: finite("initialAltitudeMslFt", profile.initialAltitudeMslFt),
    solveMode: profile.solveMode ?? "height",
    trackingTimeSec: profile.trackingTimeSec ?? 0,
    releaseAltitudeMslFt: finite("releaseAltitudeMslFt", profile.releaseAltitudeMslFt),
    angleOffDeg,
    rollInBankAngleDeg: finite("rollInBankAngleDeg", profile.rollInBankAngleDeg),
    rollInG: finite("rollInG", profile.rollInG),
    ballisticModelId: profile.ballisticModelId,
  };
}

function attackHeadingFromOffsetAndAngleOff(runInHeadingDeg, offsetAngleDeg, angleOffDeg, direction) {
  const offsetHeadingDeg = offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  return norm(direction.rollDirection === "RIGHT" ? offsetHeadingDeg + angleOffDeg : offsetHeadingDeg - angleOffDeg);
}

function resolveHeadingForOffset({ input, locks, driver, direction, runInHeadingDeg, offsetAngleDeg }) {
  const inputAttackHeadingDeg = norm(finite("attackHeadingDeg", input.attackHeadingDeg));
  const inputAngleOffDeg = Math.abs(finite("angleOffDeg", input.angleOffDeg));
  const holdAngleOff = !!locks.angleOffDeg || (!locks.attackHeadingDeg && driver === "angleOffDeg");
  if (holdAngleOff && !locks.attackHeadingDeg) {
    const attackHeadingDeg = attackHeadingFromOffsetAndAngleOff(runInHeadingDeg, offsetAngleDeg, inputAngleOffDeg, direction);
    return { attackHeadingDeg, angleOffDeg: inputAngleOffDeg };
  }
  const attackHeadingDeg = inputAttackHeadingDeg;
  const offsetHeadingDeg = offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  return { attackHeadingDeg, angleOffDeg: angleOffFromOffsetHeading(offsetHeadingDeg, attackHeadingDeg, direction) };
}

// Mirrors offset-geometry-v0.2.mjs's buildOffsetCandidate, but the Run-In line is anchored at
// `ipPoint` (which may be off the Target axis) instead of being forced through Target. Roll-in
// Start / Track Point / Attack Track are derived exactly as in the single-aircraft model (they
// depend only on offsetHeadingDeg and the BDP profile, never on IP position) — the only real
// change is which point the Run-In line's line-intersection is anchored at.
export function buildOffAxisOffsetCandidate(input) {
  const { attackHeadingDeg, offsetAngleDeg, offsetRadiusNm, profile } = input;
  const runInHeadingDeg = norm(finite("runInHeadingDeg", input.runInHeadingDeg));
  const ipPoint = finitePoint("ipPoint", input.ipPoint);
  [
    ["attackHeadingDeg", attackHeadingDeg], ["offsetAngleDeg", offsetAngleDeg], ["offsetRadiusNm", offsetRadiusNm],
  ].forEach(([name, value]) => finite(name, value));
  if (!(offsetAngleDeg > 0 && offsetAngleDeg < 179.5)) throw new RangeError("Offset Angle must be > 0 and < 179.5 deg");
  if (!(offsetRadiusNm > 0)) throw new RangeError("Offset Radius must be > 0 NM");
  if (!profile?.public || !profile?.diagnostics || !profile?.visualization) throw new TypeError("profile must be a BDP semantic result");

  const direction = directionRule(runInHeadingDeg, attackHeadingDeg);
  if (direction.ambiguous) throw new Error("Run-In / Attack relation is directionally ambiguous");
  const offsetHeadingDeg = offsetHeadingFromOffset(runInHeadingDeg, offsetAngleDeg, direction);
  const angleOffDeg = angleOffFromOffsetHeading(offsetHeadingDeg, attackHeadingDeg, direction);
  if (!(angleOffDeg > 0 && angleOffDeg < 179.5)) throw new RangeError("Angle-Off is outside the supported range");

  const targetLocal = { forward: profile.diagnostics.targetForwardNm, turnSide: profile.diagnostics.targetTurnSideNm };
  const targetVector = transformLocal(targetLocal, offsetHeadingDeg, direction.rollDirection);
  const rollStart = mul(targetVector, -1);
  const rollDisplacementGlobal = transformLocal({
    forward: profile.public.rollInDisplacement.forwardNm,
    turnSide: profile.public.rollInDisplacement.turnSideNm,
  }, offsetHeadingDeg, direction.rollDirection);
  const trackPoint = add(rollStart, rollDisplacementGlobal);
  const offsetVector = vecHeading(offsetHeadingDeg);
  const runVector = vecHeading(runInHeadingDeg);

  const temporaryActionPoint = lineIntersection(ipPoint, mul(runVector, -1), rollStart, offsetVector);
  if (!temporaryActionPoint) throw new Error("Run-In and Offset lines are parallel");

  const turnRadiusCorrectionNm = offsetRadiusNm * Math.tan(rad(offsetAngleDeg) / 2);
  const realActionPoint = sub(temporaryActionPoint, mul(runVector, turnRadiusCorrectionNm));
  const turnEnd = add(temporaryActionPoint, mul(offsetVector, turnRadiusCorrectionNm));
  // IP-referenced Action Range: distance from the follower's own IP to its Action Point along
  // the Run-In direction. Replaces the single-aircraft Target-referenced Action Range, which has
  // no meaning once the Run-In line no longer passes through Target.
  const actionRangeFromIpNm = dot(sub(realActionPoint, ipPoint), runVector);
  const approachRangeNm = dot(sub(rollStart, turnEnd), offsetVector);
  const offsetNormal = direction.offsetDirection === "LEFT" ? left(runVector) : right(runVector);
  const offsetCenter = add(realActionPoint, mul(offsetNormal, offsetRadiusNm));

  const rollInRadiusNm = profile.public.rollInRadiusNm;
  const rollNormal = direction.rollDirection === "RIGHT" ? right(offsetVector) : left(offsetVector);
  const rollCenter = Number.isFinite(rollInRadiusNm) ? add(rollStart, mul(rollNormal, rollInRadiusNm)) : null;

  const rollInTrajectorySamples = profile.visualization.rollInTrajectorySamples.map((sample) => {
    const transformed = transformLocal({ forward: sample.forwardNm, turnSide: sample.turnSideNm }, offsetHeadingDeg, direction.rollDirection);
    return add(rollStart, transformed);
  });

  const target = { x: 0, y: 0 };

  return {
    runInHeadingDeg,
    attackHeadingDeg,
    offsetHeadingDeg,
    offsetAngleDeg,
    angleOffDeg,
    direction,
    turnRadiusCorrectionNm,
    actionRangeFromIpNm,
    approachRangeNm,
    rollInRangeNm: profile.public.rollInRangeNm,
    rollInRadiusNm,
    groundRangeNm: profile.public.groundRangeNm,
    points: { target, ip: ipPoint, rollStart, trackPoint, temporaryActionPoint, realActionPoint, turnEnd, offsetCenter, rollCenter },
    vectors: { runVector, offsetVector },
    rollInTrajectorySamples,
    profile,
  };
}

export function validateOffAxisOffsetCandidate(candidate) {
  const errors = [];
  const warnings = [];
  if (candidate.approachRangeNm < 0) errors.push("Offset Turn End has passed Roll-in Start");
  else if (candidate.approachRangeNm < 0.25) warnings.push("Approach Range is very short");
  if (candidate.offsetAngleDeg >= 120) warnings.push("Offset Angle is 120 deg or greater");
  if (candidate.actionRangeFromIpNm < -0.001) errors.push("Action Point must not be behind this aircraft's own IP");
  return { errors, warnings };
}

// Composes buildOffAxisOffsetCandidate with BDP and the offset turn, mirroring
// offset-be-v0.2.mjs's calculateOffsetV0_2 result shape (resolved/timing/geometry/profile) so
// existing single-aircraft FE rendering (Top View, drop-order deltas, field sync) can consume
// either result interchangeably.
export function calculateOffAxisOffset(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  const locks = input.locks ?? {};
  const errors = [];
  const warnings = [];
  const runInHeadingDeg = norm(finite("runInHeadingDeg", input.runInHeadingDeg));
  const ipPoint = finitePoint("ipPoint", input.ipPoint);
  const enteredAttackHeadingDeg = finite("attackHeadingDeg", input.attackHeadingDeg);
  const enteredAngleOffDeg = Math.abs(finite("angleOffDeg", input.angleOffDeg));
  const driver = input.driver ?? "angleOffDeg";
  const direction = directionRule(runInHeadingDeg, enteredAttackHeadingDeg);
  if (direction.ambiguous) throw new Error("Run-In / Attack relation is directionally ambiguous");

  const turn = resolveOffsetTurn(input, locks, input.turnDriver ?? "offsetG");
  errors.push(...turn.errors);
  warnings.push(...turn.warnings);

  const evaluate = (offsetAngleDeg) => {
    const headings = resolveHeadingForOffset({ input, locks, driver, direction, runInHeadingDeg, offsetAngleDeg });
    if (!(headings.angleOffDeg > 0 && headings.angleOffDeg < 179.5)) throw new Error("Angle-Off outside supported range");
    const derivedDirection = directionRule(runInHeadingDeg, headings.attackHeadingDeg);
    if (derivedDirection.ambiguous || derivedDirection.attackSide !== direction.attackSide) throw new Error("Heading solve would switch the fixed Offset/Roll-in side");
    const profile = calculateBombDeliveryV0_3(canonicalProfileInput(input, headings.angleOffDeg));
    return buildOffAxisOffsetCandidate({
      runInHeadingDeg,
      ipPoint,
      attackHeadingDeg: headings.attackHeadingDeg,
      offsetAngleDeg,
      offsetRadiusNm: turn.offsetRadiusNm,
      profile,
    });
  };

  let initialOffsetAngleDeg;
  if (locks.offsetAngleDeg || driver === "offsetAngleDeg") initialOffsetAngleDeg = Math.abs(finite("offsetAngleDeg", input.offsetAngleDeg));
  else initialOffsetAngleDeg = offsetAngleFromAngleOff(runInHeadingDeg, enteredAttackHeadingDeg, enteredAngleOffDeg, direction);

  const rangeFixed = !!locks.actionRangeFromIpNm || driver === "actionRangeFromIpNm";
  const rangeTargetNm = rangeFixed ? finite("actionRangeFromIpNm", input.actionRangeFromIpNm) : null;
  const offsetCanVary = !locks.offsetAngleDeg && driver !== "offsetAngleDeg" && !(locks.attackHeadingDeg && locks.angleOffDeg);
  let candidate = null;
  let residualNm = null;
  let exact = true;

  if (rangeFixed && offsetCanVary) {
    const maxAngle = Math.max(0.1, Math.min(120, 179.4 - Math.abs(direction.deltaDeg)));
    const solved = solveOffsetAngleForActionRange({
      targetRangeNm: rangeTargetNm,
      evaluate: (angle) => {
        const built = evaluate(angle);
        return { ...built, actionRangeNm: built.actionRangeFromIpNm };
      },
      maxOffsetAngleDeg: maxAngle,
      toleranceNm: 0.002,
    });
    candidate = solved.candidate;
    residualNm = solved.residualNm;
    exact = solved.exact;
    if (!candidate) throw new Error("No valid Offset Angle candidate for the requested Action Range");
    if (!exact) warnings.push(`Action Range root is best-effort; residual ${Number(residualNm).toFixed(3)} NM`);
  } else {
    candidate = evaluate(initialOffsetAngleDeg);
    if (rangeFixed) {
      residualNm = candidate.actionRangeFromIpNm - rangeTargetNm;
      exact = Math.abs(residualNm) <= 0.002;
      if (!exact) errors.push(`CONSTRAINT CONFLICT: Action Range residual ${residualNm.toFixed(3)} NM`);
    }
  }
  if (!candidate) throw new Error("Offset geometry was not produced");

  if (locks.attackHeadingDeg && !near(norm(input.attackHeadingDeg), norm(candidate.attackHeadingDeg), 0.02)) errors.push("LOCK conflict: Attack Heading cannot be satisfied");
  if (locks.angleOffDeg && !near(Math.abs(input.angleOffDeg), candidate.angleOffDeg, 0.02)) errors.push("LOCK conflict: Angle-Off cannot be satisfied");
  if (locks.offsetAngleDeg && !near(Math.abs(input.offsetAngleDeg), candidate.offsetAngleDeg, 0.02)) errors.push("LOCK conflict: Offset Angle cannot be satisfied");
  if (locks.actionRangeFromIpNm && !near(input.actionRangeFromIpNm, candidate.actionRangeFromIpNm, 0.002)) errors.push("LOCK conflict: Action Range cannot be satisfied");

  const candidateValidation = validateOffAxisOffsetCandidate(candidate);
  errors.push(...candidateValidation.errors);
  warnings.push(...candidateValidation.warnings);

  const speedFps = turn.offsetTasKt * KT_TO_FPS;
  const ingressDistanceNm = Math.max(0, candidate.actionRangeFromIpNm);
  const ingressSec = (ingressDistanceNm * FT_PER_NM) / speedFps;
  // Unclamped counterpart (negative when the Action Point is behind IP) for time-matching solvers.
  const signedIngressSec = (candidate.actionRangeFromIpNm * FT_PER_NM) / speedFps;
  const turnSec = (turn.offsetRadiusNm * FT_PER_NM * rad(candidate.offsetAngleDeg)) / speedFps;
  const approachRangeNm = candidate.approachRangeNm;
  const approachSec = (Math.max(0, approachRangeNm) * FT_PER_NM) / speedFps;
  const rollToReleaseSec = candidate.profile.public.rollInTimeSec + candidate.profile.public.trackingTimeSec;
  const offsetIpToReleaseSec = ingressSec + turnSec + approachSec + rollToReleaseSec;

  return {
    model: { ...OFFSET_FORMATION_GEOMETRY_V0_1 },
    state: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
    errors,
    warnings,
    locks: { ...locks },
    driver,
    turnDriver: input.turnDriver ?? "offsetG",
    resolved: {
      runInHeadingDeg,
      attackHeadingDeg: candidate.attackHeadingDeg,
      angleOffDeg: candidate.angleOffDeg,
      offsetAngleDeg: candidate.offsetAngleDeg,
      offsetHeadingDeg: candidate.offsetHeadingDeg,
      actionRangeFromIpNm: candidate.actionRangeFromIpNm,
      approachRangeNm,
      offsetAltitudeMslFt: input.offsetAltitudeMslFt,
      offsetSpeedValue: input.offsetSpeedValue,
      offsetSpeedMode: input.offsetSpeedMode ?? "CAS",
      offsetG: turn.offsetG,
      offsetBankDeg: turn.offsetBankDeg,
      offsetRadiusNm: turn.offsetRadiusNm,
      offsetTasKt: turn.offsetTasKt,
    },
    timing: {
      ingressDistanceNm,
      ingressSec,
      signedIngressSec,
      offsetTurnSec: turnSec,
      approachSec,
      rollToReleaseSec,
      offsetIpToReleaseSec,
    },
    geometry: candidate,
    profile: candidate.profile,
    solve: { residualNm, exact },
  };
}
