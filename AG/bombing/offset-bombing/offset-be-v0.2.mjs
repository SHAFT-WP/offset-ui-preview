import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { calculateBombDeliveryV0_3 } from "../bomb-delivery-planner/bomb-delivery-planner-v0.3.mjs";
import {
  angleOffFromOffset,
  buildOffsetCandidate,
  buildReferenceState,
  directionRule,
  offsetAngleFromAngleOff,
  solveOffsetAngleForActionRange,
  validateOffsetCandidate,
} from "./offset-geometry-v0.2.mjs";

export const OFFSET_BE_V0_2 = Object.freeze({ id: "offset-be-v0.2", version: "0.2.0", status: "work", deliveryAuthority: "bomb-delivery-planner-v0.3" });

const FT_PER_NM = 6076.11549;
const KT_TO_FPS = 1.687809857;
const G = 32.174;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (radians) => (radians * 180) / Math.PI;
const near = (a, b, tolerance) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function speedToTas(speedValue, speedMode, altitudeMslFt) { return speedMode === "MACH" ? machToTas(speedValue, altitudeMslFt) : casToTas(speedValue, altitudeMslFt); }

function fromG(loadFactor, tasKt) {
  if (!(loadFactor > 1)) throw new RangeError("Offset G must be > 1 G");
  const bankDeg = deg(Math.acos(1 / loadFactor));
  const speedFps = tasKt * KT_TO_FPS;
  const radiusNm = (speedFps * speedFps) / (G * Math.tan(rad(bankDeg))) / FT_PER_NM;
  return { offsetG: loadFactor, offsetBankDeg: bankDeg, offsetRadiusNm: radiusNm };
}
function fromBank(bankDeg, tasKt) {
  if (!(bankDeg > 0 && bankDeg < 89.9)) throw new RangeError("Offset Bank must be > 0 and < 89.9 deg");
  const loadFactor = 1 / Math.cos(rad(bankDeg));
  const speedFps = tasKt * KT_TO_FPS;
  const radiusNm = (speedFps * speedFps) / (G * Math.tan(rad(bankDeg))) / FT_PER_NM;
  return { offsetG: loadFactor, offsetBankDeg: bankDeg, offsetRadiusNm: radiusNm };
}
function fromRadius(radiusNm, tasKt) {
  if (!(radiusNm > 0)) throw new RangeError("Offset Radius must be > 0 NM");
  const speedFps = tasKt * KT_TO_FPS;
  const bankRad = Math.atan((speedFps * speedFps) / (G * radiusNm * FT_PER_NM));
  return { offsetG: 1 / Math.cos(bankRad), offsetBankDeg: deg(bankRad), offsetRadiusNm: radiusNm };
}

export function resolveOffsetTurn(input, locks = {}, turnDriver = "offsetG") {
  const errors = [];
  const warnings = [];
  const altitudeMslFt = finite("offsetAltitudeMslFt", input.offsetAltitudeMslFt);
  const speedValue = finite("offsetSpeedValue", input.offsetSpeedValue);
  const tasKt = speedToTas(speedValue, input.offsetSpeedMode ?? "CAS", altitudeMslFt);
  const locked = ["offsetG", "offsetBankDeg", "offsetRadiusNm"].filter((key) => locks[key]);
  let authoritative = locked.length === 1 ? locked[0] : locked.includes(turnDriver) ? turnDriver : locked[0] ?? turnDriver;
  if (!["offsetG", "offsetBankDeg", "offsetRadiusNm"].includes(authoritative)) authoritative = "offsetG";
  const solveFrom = (key) => key === "offsetBankDeg" ? fromBank(finite(key, input[key]), tasKt) : key === "offsetRadiusNm" ? fromRadius(finite(key, input[key]), tasKt) : fromG(finite("offsetG", input.offsetG), tasKt);
  let state;
  try { state = solveFrom(authoritative); }
  catch (error) { errors.push(error.message); state = { offsetG: input.offsetG, offsetBankDeg: input.offsetBankDeg, offsetRadiusNm: input.offsetRadiusNm }; }
  if (locked.length > 1 && Number.isFinite(state.offsetG)) {
    if (locks.offsetG && !near(input.offsetG, state.offsetG, 0.003)) errors.push("LOCK conflict: Offset G is inconsistent with other locked turn values");
    if (locks.offsetBankDeg && !near(input.offsetBankDeg, state.offsetBankDeg, 0.08)) errors.push("LOCK conflict: Offset Bank is inconsistent with other locked turn values");
    if (locks.offsetRadiusNm && !near(input.offsetRadiusNm, state.offsetRadiusNm, 0.003)) errors.push("LOCK conflict: Offset Radius is inconsistent with other locked turn values");
  }
  return { ...state, offsetTasKt: tasKt, authoritative, errors, warnings };
}

function canonicalProfileInput(input, angleOffDeg) {
  const profile = input.profile ?? {};
  const diveAngleDeg = finite("diveAngleDeg", profile.diveAngleDeg ?? input.diveAngleDeg);
  return {
    weaponId: profile.weaponId ?? "M82",
    targetElevationMslFt: finite("targetElevationMslFt", profile.targetElevationMslFt),
    releaseSpeedKcas: finite("releaseSpeedKcas", profile.releaseSpeedKcas),
    speedOvershootKcas: profile.speedOvershootKcas ?? 50,
    maneuverInitiationDelaySec: profile.maneuverInitiationDelaySec ?? 2,
    recoveryG: profile.recoveryG ?? 5,
    gOnsetTimeSec: profile.gOnsetTimeSec ?? 2,
    diveAngleDeg,
    releaseFpaDeg: profile.releaseFpaDeg ?? -diveAngleDeg,
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

function chooseAngularConstraint(input, locks, driver, direction, errors) {
  const offsetLocked = !!locks.offsetAngleDeg;
  const angleLocked = !!locks.angleOffDeg;
  const fromOffset = () => Math.abs(finite("offsetAngleDeg", input.offsetAngleDeg));
  const fromAngle = () => offsetAngleFromAngleOff(input.runInHeadingDeg, input.attackHeadingDeg, Math.abs(finite("angleOffDeg", input.angleOffDeg)), direction);
  if (offsetLocked && angleLocked) {
    const offsetAngleDeg = fromOffset();
    const expectedAngleOff = angleOffFromOffset(input.runInHeadingDeg, input.attackHeadingDeg, offsetAngleDeg, direction);
    if (!near(expectedAngleOff, input.angleOffDeg, 0.02)) errors.push("LOCK conflict: Offset Angle and Angle-Off cannot both be satisfied");
    return { fixed: true, offsetAngleDeg, source: "locked-offset-angle" };
  }
  if (offsetLocked) return { fixed: true, offsetAngleDeg: fromOffset(), source: "locked-offset-angle" };
  if (angleLocked) return { fixed: true, offsetAngleDeg: fromAngle(), source: "locked-angle-off" };
  if (driver === "offsetAngleDeg") return { fixed: true, offsetAngleDeg: fromOffset(), source: "driver-offset-angle" };
  if (driver === "angleOffDeg" || driver === "diveAngleDeg" || driver === "profile") return { fixed: true, offsetAngleDeg: fromAngle(), source: "driver-angle-off" };
  return { fixed: false, offsetAngleDeg: null, source: null };
}

function chooseRangeConstraint(input, locks, driver, referenceMode, errors) {
  const actionLocked = !!locks.actionRangeNm;
  const ipLocked = !!locks.ipRangeNm;
  if (referenceMode === "VIP") {
    if (actionLocked && ipLocked && !near(input.actionRangeNm, input.ipRangeNm, 0.002)) errors.push("LOCK conflict: VIP requires locked IP Range = locked Action Range");
    if (actionLocked) return { fixed: true, targetRangeNm: finite("actionRangeNm", input.actionRangeNm), source: "locked-action-range" };
    if (ipLocked) return { fixed: true, targetRangeNm: finite("ipRangeNm", input.ipRangeNm), source: "locked-ip-range" };
    if (driver === "actionRangeNm") return { fixed: true, targetRangeNm: finite("actionRangeNm", input.actionRangeNm), source: "driver-action-range" };
    if (driver === "ipRangeNm") return { fixed: true, targetRangeNm: finite("ipRangeNm", input.ipRangeNm), source: "driver-ip-range" };
    return { fixed: false, targetRangeNm: null, source: null };
  }
  if (actionLocked || driver === "actionRangeNm") return { fixed: true, targetRangeNm: finite("actionRangeNm", input.actionRangeNm), source: actionLocked ? "locked-action-range" : "driver-action-range" };
  return { fixed: false, targetRangeNm: null, source: null };
}

export function calculateOffsetV0_2(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  const locks = input.locks ?? {};
  const errors = [];
  const warnings = [];
  const referenceMode = input.referenceMode === "VIP" ? "VIP" : "VRP";
  const driver = input.driver ?? "angleOffDeg";
  const runInHeadingDeg = finite("runInHeadingDeg", input.runInHeadingDeg);
  const attackHeadingDeg = finite("attackHeadingDeg", input.attackHeadingDeg);
  let ipRangeNm = finite("ipRangeNm", input.ipRangeNm);
  const direction = directionRule(runInHeadingDeg, attackHeadingDeg);
  if (direction.ambiguous) throw new Error("Run-In / Attack relation is directionally ambiguous");

  const turn = resolveOffsetTurn(input, locks, input.turnDriver ?? "offsetG");
  errors.push(...turn.errors);
  warnings.push(...turn.warnings);

  const evaluate = (offsetAngleDeg) => {
    const angleOffDeg = angleOffFromOffset(runInHeadingDeg, attackHeadingDeg, offsetAngleDeg, direction);
    if (!(angleOffDeg > 0 && angleOffDeg < 179.5)) throw new Error("Angle-Off outside supported range");
    const profile = calculateBombDeliveryV0_3(canonicalProfileInput(input, angleOffDeg));
    return buildOffsetCandidate({ runInHeadingDeg, attackHeadingDeg, offsetAngleDeg, offsetRadiusNm: turn.offsetRadiusNm, ipRangeNm, profile });
  };

  const angular = chooseAngularConstraint({ ...input, runInHeadingDeg, attackHeadingDeg }, locks, driver, direction, errors);
  const range = chooseRangeConstraint(input, locks, driver, referenceMode, errors);
  let candidate = null;
  let residualNm = null;
  let exact = true;

  if (angular.fixed) {
    candidate = evaluate(angular.offsetAngleDeg);
    if (range.fixed) {
      residualNm = candidate.actionRangeNm - range.targetRangeNm;
      exact = Math.abs(residualNm) <= 0.002;
      if (!exact) errors.push(`CONSTRAINT CONFLICT: locked/driver range residual ${residualNm.toFixed(3)} NM`);
    }
  } else if (range.fixed) {
    const maxAngle = Math.max(0.1, Math.min(120, 179.4 - Math.abs(direction.deltaDeg)));
    const solved = solveOffsetAngleForActionRange({ targetRangeNm: range.targetRangeNm, evaluate, maxOffsetAngleDeg: maxAngle, toleranceNm: 0.002 });
    candidate = solved.candidate;
    residualNm = solved.residualNm;
    exact = solved.exact;
    if (!candidate) throw new Error("No valid Offset Angle candidate for requested Action Range");
    if (!exact) warnings.push(`Action Range root is best-effort; residual ${Number(residualNm).toFixed(3)} NM`);
  } else {
    const fallbackOffsetAngleDeg = offsetAngleFromAngleOff(runInHeadingDeg, attackHeadingDeg, Math.abs(finite("angleOffDeg", input.angleOffDeg)), direction);
    candidate = evaluate(fallbackOffsetAngleDeg);
  }
  if (!candidate) throw new Error("Offset geometry was not produced");

  if (referenceMode === "VIP") {
    if (range.fixed) ipRangeNm = range.targetRangeNm;
    else if (locks.ipRangeNm) {
      ipRangeNm = input.ipRangeNm;
      const mismatch = candidate.actionRangeNm - ipRangeNm;
      if (Math.abs(mismatch) > 0.002) errors.push(`VIP locked IP residual ${mismatch.toFixed(3)} NM`);
    } else ipRangeNm = candidate.actionRangeNm;
    if (!near(candidate.actionRangeNm, ipRangeNm, 0.002)) errors.push("VIP mode requires IP = Action Point");
    candidate = { ...candidate, points: { ...candidate.points, ip: { ...candidate.points.realActionPoint } } };
  }

  const candidateValidation = validateOffsetCandidate(candidate, { referenceMode, ipRangeNm, vipEqualityToleranceNm: 0.002 });
  errors.push(...candidateValidation.errors);
  warnings.push(...candidateValidation.warnings);

  const reference = buildReferenceState(candidate, { referenceMode, vrpRangeNm: input.vrpRangeNm, vipRangeNm: input.vipRangeNm, vrpLinked: input.vrpLinked, vipLinked: input.vipLinked, ipRangeNm });
  errors.push(...reference.errors);
  warnings.push(...reference.warnings);

  const speedFps = turn.offsetTasKt * KT_TO_FPS;
  const ingressDistanceNm = referenceMode === "VIP" ? 0 : Math.max(0, ipRangeNm - candidate.actionRangeNm);
  const ingressSec = ingressDistanceNm * FT_PER_NM / speedFps;
  const turnSec = turn.offsetRadiusNm * FT_PER_NM * rad(candidate.offsetAngleDeg) / speedFps;
  const actionLegSec = Math.max(0, candidate.actionLegDistanceNm) * FT_PER_NM / speedFps;
  const rollToReleaseSec = candidate.profile.public.rollInTimeSec + candidate.profile.public.trackingTimeSec;
  const offsetIpToReleaseSec = ingressSec + turnSec + actionLegSec + rollToReleaseSec;
  const legacyDirectIpTargetSec = ipRangeNm * FT_PER_NM / speedFps;

  return {
    model: { ...OFFSET_BE_V0_2 },
    state: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
    errors, warnings, locks: { ...locks }, driver, turnDriver: input.turnDriver ?? "offsetG", referenceMode,
    resolved: {
      runInHeadingDeg, attackHeadingDeg, angleOffDeg: candidate.angleOffDeg, offsetAngleDeg: candidate.offsetAngleDeg,
      actionHeadingDeg: candidate.actionHeadingDeg, actionRangeNm: candidate.actionRangeNm, ipRangeNm,
      vrpRangeNm: referenceMode === "VRP" && reference.linked ? candidate.actionRangeNm : input.vrpRangeNm,
      vipRangeNm: referenceMode === "VIP" && reference.linked ? ipRangeNm : input.vipRangeNm,
      offsetAltitudeMslFt: input.offsetAltitudeMslFt, offsetSpeedValue: input.offsetSpeedValue, offsetSpeedMode: input.offsetSpeedMode ?? "CAS",
      offsetG: turn.offsetG, offsetBankDeg: turn.offsetBankDeg, offsetRadiusNm: turn.offsetRadiusNm, offsetTasKt: turn.offsetTasKt,
    },
    timing: { ingressDistanceNm, ingressSec, offsetTurnSec: turnSec, actionLegSec, rollToReleaseSec, offsetIpToReleaseSec, legacyDirectIpTargetSec, legacyDeltaTosSec: offsetIpToReleaseSec - legacyDirectIpTargetSec },
    geometry: candidate, reference, profile: candidate.profile,
    solve: { angularSource: angular.source, rangeSource: range.source, residualNm, exact },
  };
}
