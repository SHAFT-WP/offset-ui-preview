import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { calculateBombDeliveryV0_3 } from "../bomb-delivery-planner/bomb-delivery-planner-v0.3.mjs";
import {
  angleOffFromOffsetHeading,
  buildOffsetCandidate,
  buildReferenceState,
  directionRule,
  offsetAngleFromAngleOff,
  offsetHeadingFromOffset,
  resolveReferenceInputs,
  validateOffsetCandidate,
} from "./offset-geometry-v0.2.mjs";

export const OFFSET_BE_V0_2 = Object.freeze({ id: "offset-be-v0.2", version: "0.2.5", status: "work", deliveryAuthority: "bomb-delivery-planner-v0.3" });

const FT_PER_NM = 6076.11549;
const KT_TO_FPS = 1.687809857;
const G = 32.174;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (radians) => (radians * 180) / Math.PI;
const norm = (headingDeg) => ((headingDeg % 360) + 360) % 360;
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

function solveOffsetAngleForMetric({ targetValue, evaluate, metric, minOffsetAngleDeg = 0.05, maxOffsetAngleDeg = 120, tolerance = 0.002 }) {
  finite("targetValue", targetValue);
  if (!(targetValue >= 0)) throw new RangeError("Range constraint must be >= 0 NM");
  let previous = null;
  let best = null;
  let bracket = null;
  for (let angle = minOffsetAngleDeg; angle <= maxOffsetAngleDeg + 1e-9; angle += 1) {
    try {
      const candidate = evaluate(angle);
      const residual = metric(candidate) - targetValue;
      if (!best || Math.abs(residual) < Math.abs(best.residual)) best = { candidate, residual, angle };
      if (previous && previous.residual * residual <= 0) { bracket = { lo: previous.angle, hi: angle, flo: previous.residual }; break; }
      previous = { angle, residual };
    } catch (_) {}
  }
  if (!bracket) return { candidate: best?.candidate ?? null, residualNm: best?.residual ?? null, exact: !!best && Math.abs(best.residual) <= tolerance };

  let lo = bracket.lo;
  let hi = bracket.hi;
  let flo = bracket.flo;
  let candidate = null;
  let residual = null;
  for (let index = 0; index < 40; index += 1) {
    const mid = (lo + hi) / 2;
    candidate = evaluate(mid);
    residual = metric(candidate) - targetValue;
    if (Math.abs(residual) <= tolerance) break;
    if (flo * residual <= 0) hi = mid;
    else { lo = mid; flo = residual; }
  }
  return { candidate, residualNm: residual, exact: !!candidate && Math.abs(residual) <= tolerance };
}

function approachRangeInput(input) {
  return finite("approachRangeNm", input.approachRangeNm);
}

function chooseRangeConstraint(input, locks, driver) {
  const actionLocked = !!locks.actionRangeNm;
  const approachLocked = !!locks.approachRangeNm;
  const approachDriven = driver === "approachRangeNm";

  if (actionLocked) return { fixed: true, kind: "action", targetRangeNm: finite("actionRangeNm", input.actionRangeNm), source: "locked-action-range" };
  if (approachLocked) return { fixed: true, kind: "approach", targetRangeNm: approachRangeInput(input), source: "locked-approach-range" };
  if (approachDriven) return { fixed: true, kind: "approach", targetRangeNm: approachRangeInput(input), source: "driver-approach-range" };
  if (driver === "actionRangeNm") return { fixed: true, kind: "action", targetRangeNm: finite("actionRangeNm", input.actionRangeNm), source: "driver-action-range" };
  return { fixed: false, kind: null, targetRangeNm: null, source: null };
}

// Current app policy. The original entrypoint below remains the independent-
// reference compatibility contract used by existing calculation consumers.
export function calculateOffsetWithVrpStart(input) {
  const locks = { ...input.locks };
  const vrpDriven = ["vrpRangeNm", "vrpBearingDeg"].includes(input.driver);
  const holdVrp = !!locks.vrpReference || vrpDriven;
  const linked = input.ipLinkedToVrp === true && !locks.ipReference && !locks.vrpReference;
  // A linked IP sits this far beyond VRP on the Run-In axis (IP = VRP + lead). 0 keeps the
  // original coincident IP=VRP policy; the Offset app passes 3 NM.
  const ipLinkLeadNm = input.ipLinkLeadNm === undefined ? 0 : finite("ipLinkLeadNm", input.ipLinkLeadNm);
  if (!(ipLinkLeadNm >= 0)) throw new RangeError("ipLinkLeadNm must be >= 0 NM");
  const vrpRunIn = norm(finite("vrpBearingDeg", input.vrpBearingDeg) + 180);
  const runIn = holdVrp ? vrpRunIn : norm(input.runInHeadingDeg);
  const headingNear = (a, b) => Math.abs(((a - b + 540) % 360) - 180) < 0.02;
  if (locks.runInHeadingDeg && !headingNear(runIn, norm(input.runInHeadingDeg))) {
    throw new Error("CONSTRAINT CONFLICT: VRP would move locked Run-In Heading");
  }
  if (locks.ipReference && !headingNear(runIn, finite("ipLockHeadingDeg", input.ipLockHeadingDeg))) {
    throw new Error("CONSTRAINT CONFLICT: locked IP bearing and VRP must share the Run-In axis");
  }
  if (locks.vrpReference && !vrpDriven && !headingNear(norm(input.runInHeadingDeg), vrpRunIn)) {
    throw new Error("CONSTRAINT CONFLICT: Run-In Heading would move locked VRP");
  }
  if (holdVrp && locks.actionRangeNm && !near(input.actionRangeNm, input.vrpRangeNm, 0.002)) {
    throw new Error("CONSTRAINT CONFLICT: locked Action Range differs from VRP Range");
  }
  if (holdVrp) locks.actionRangeNm = true;
  const candidateInput = {
    ...input,
    locks,
    runInHeadingDeg: runIn,
    driver: vrpDriven ? "actionRangeNm" : input.driver,
    actionRangeNm: holdVrp ? input.vrpRangeNm : input.actionRangeNm,
    ipRangeNm: linked && holdVrp ? input.vrpRangeNm + ipLinkLeadNm : input.ipRangeNm,
  };
  const first = calculateOffsetV0_2(candidateInput);
  // A second, bounded composition changes reference/IP metadata only. The
  // delivery and turn solution is unchanged; linked IP follows the solved AP.
  const result = calculateOffsetV0_2({
    ...candidateInput,
    ipRangeNm: linked ? first.resolved.actionRangeNm + ipLinkLeadNm : candidateInput.ipRangeNm,
    vrpBearingDeg: holdVrp ? input.vrpBearingDeg : norm(runIn + 180),
    vrpRangeNm: holdVrp ? input.vrpRangeNm : first.resolved.actionRangeNm,
  });
  result.locks = { ...input.locks };
  result.referencePolicy = "VRP_ACTION_START";
  result.ipLinkedToVrp = linked;
  result.ipLinkLeadNm = ipLinkLeadNm;
  return result;
}

export function calculateOffsetV0_2(input) {
  if (!input || typeof input !== "object") throw new TypeError("input must be an object");
  const locks = input.locks ?? {};
  if (input.offsetRangeNm !== undefined || locks.offsetRangeNm !== undefined || input.driver === "offsetRangeNm") {
    throw new TypeError("Offset input/driver/LOCK uses approachRangeNm only; migrate old saved input at the FE boundary");
  }
  const errors = [];
  const warnings = [];
  const referenceMode = input.referenceMode === "VIP" ? "VIP" : "VRP";
  const driver = input.driver ?? "angleOffDeg";
  const runInHeadingDeg = norm(finite("runInHeadingDeg", input.runInHeadingDeg));
  const enteredAttackHeadingDeg = finite("attackHeadingDeg", input.attackHeadingDeg);
  const enteredAngleOffDeg = Math.abs(finite("angleOffDeg", input.angleOffDeg));
  const referenceInputs = resolveReferenceInputs({ ...input, runInHeadingDeg });
  const ipRangeNm = referenceInputs.ipRangeNm;
  if (!(ipRangeNm >= 0)) throw new RangeError("IP Range must be >= 0 NM");
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
    return buildOffsetCandidate({
      runInHeadingDeg,
      attackHeadingDeg: headings.attackHeadingDeg,
      offsetAngleDeg,
      offsetRadiusNm: turn.offsetRadiusNm,
      ipRangeNm,
      vipToTargetBearingDeg: referenceInputs.vipToTargetBearingDeg,
      vipRangeNm: referenceInputs.vipRangeNm,
      vrpBearingDeg: referenceInputs.vrpBearingDeg,
      vrpRangeNm: referenceInputs.vrpRangeNm,
      profile,
    });
  };

  let initialOffsetAngleDeg;
  if (locks.offsetAngleDeg || driver === "offsetAngleDeg") initialOffsetAngleDeg = Math.abs(finite("offsetAngleDeg", input.offsetAngleDeg));
  else initialOffsetAngleDeg = offsetAngleFromAngleOff(runInHeadingDeg, enteredAttackHeadingDeg, enteredAngleOffDeg, direction);

  const range = chooseRangeConstraint(input, locks, driver);
  const offsetCanVary = !locks.offsetAngleDeg && driver !== "offsetAngleDeg" && !(locks.attackHeadingDeg && locks.angleOffDeg);
  let candidate = null;
  let residualNm = null;
  let exact = true;

  if (range.fixed && offsetCanVary) {
    const maxAngle = Math.max(0.1, Math.min(120, 179.4 - Math.abs(direction.deltaDeg)));
    const metric = range.kind === "approach" ? (item) => item.approachRangeNm : (item) => item.actionRangeNm;
    const solved = solveOffsetAngleForMetric({ targetValue: range.targetRangeNm, evaluate, metric, maxOffsetAngleDeg: maxAngle, tolerance: 0.002 });
    candidate = solved.candidate;
    residualNm = solved.residualNm;
    exact = solved.exact;
    if (!candidate) throw new Error(`No valid Offset Angle candidate for requested ${range.kind === "approach" ? "Approach Range" : "Action Range"}`);
    if (!exact) warnings.push(`${range.kind === "approach" ? "Approach Range" : "Action Range"} root is best-effort; residual ${Number(residualNm).toFixed(3)} NM`);
  } else {
    candidate = evaluate(initialOffsetAngleDeg);
    if (range.fixed) {
      const actual = range.kind === "approach" ? candidate.approachRangeNm : candidate.actionRangeNm;
      residualNm = actual - range.targetRangeNm;
      exact = Math.abs(residualNm) <= 0.002;
      if (!exact) errors.push(`CONSTRAINT CONFLICT: ${range.kind === "approach" ? "Approach Range" : "Action Range"} residual ${residualNm.toFixed(3)} NM`);
    }
  }
  if (!candidate) throw new Error("Offset geometry was not produced");

  if (locks.attackHeadingDeg && !near(norm(input.attackHeadingDeg), norm(candidate.attackHeadingDeg), 0.02)) errors.push("LOCK conflict: Attack Heading cannot be satisfied");
  if (locks.angleOffDeg && !near(Math.abs(input.angleOffDeg), candidate.angleOffDeg, 0.02)) errors.push("LOCK conflict: Angle-Off cannot be satisfied");
  if (locks.offsetAngleDeg && !near(Math.abs(input.offsetAngleDeg), candidate.offsetAngleDeg, 0.02)) errors.push("LOCK conflict: Offset Angle cannot be satisfied");
  if (locks.actionRangeNm && !near(input.actionRangeNm, candidate.actionRangeNm, 0.002)) errors.push("LOCK conflict: Action Range cannot be satisfied");
  if ((locks.approachRangeNm) && !near(approachRangeInput(input), candidate.approachRangeNm, 0.002)) errors.push("LOCK conflict: Approach Range cannot be satisfied");

  const candidateValidation = validateOffsetCandidate(candidate, { referenceMode, ipRangeNm });
  errors.push(...candidateValidation.errors);
  warnings.push(...candidateValidation.warnings);
  const reference = buildReferenceState(candidate, { ...input, referenceMode, ipRangeNm });
  errors.push(...reference.errors);
  warnings.push(...reference.warnings);

  const speedFps = turn.offsetTasKt * KT_TO_FPS;
  const ingressDistanceNm = Math.max(0, ipRangeNm - candidate.actionRangeNm);
  const ingressSec = ingressDistanceNm * FT_PER_NM / speedFps;
  const turnSec = turn.offsetRadiusNm * FT_PER_NM * rad(candidate.offsetAngleDeg) / speedFps;
  const approachRangeNm = candidate.approachRangeNm;
  const approachSec = Math.max(0, approachRangeNm) * FT_PER_NM / speedFps;
  const rollToReleaseSec = candidate.profile.public.rollInTimeSec + candidate.profile.public.trackingTimeSec;
  const offsetIpToReleaseSec = ingressSec + turnSec + approachSec + rollToReleaseSec;
  const legacyDirectIpTargetSec = ipRangeNm * FT_PER_NM / speedFps;

  return {
    model: { ...OFFSET_BE_V0_2 },
    state: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
    errors, warnings, locks: { ...locks }, driver, turnDriver: input.turnDriver ?? "offsetG", referenceMode,
    resolved: {
      runInHeadingDeg,
      ipToTargetBearingDeg: runInHeadingDeg,
      attackHeadingDeg: candidate.attackHeadingDeg,
      angleOffDeg: candidate.angleOffDeg,
      offsetAngleDeg: candidate.offsetAngleDeg,
      offsetHeadingDeg: candidate.offsetHeadingDeg,
      actionRangeNm: candidate.actionRangeNm,
      approachRangeNm,
      ipRangeNm,
      vipToTargetBearingDeg: candidate.referenceInputs.vipToTargetBearingDeg,
      vipRangeNm: candidate.referenceInputs.vipRangeNm,
      vrpBearingDeg: reference.mode === "VRP" ? reference.bearingDeg : candidate.referenceInputs.vrpBearingDeg,
      vrpRangeNm: reference.mode === "VRP" ? reference.displayRangeNm : candidate.referenceInputs.vrpRangeNm,
      offsetAltitudeMslFt: input.offsetAltitudeMslFt, offsetSpeedValue: input.offsetSpeedValue, offsetSpeedMode: input.offsetSpeedMode ?? "CAS",
      offsetG: turn.offsetG, offsetBankDeg: turn.offsetBankDeg, offsetRadiusNm: turn.offsetRadiusNm, offsetTasKt: turn.offsetTasKt,
    },
    timing: {
      ingressDistanceNm,
      ingressSec,
      offsetTurnSec: turnSec,
      approachSec,
      rollToReleaseSec,
      offsetIpToReleaseSec,
      legacyDirectIpTargetSec,
      legacyDeltaTosSec: offsetIpToReleaseSec - legacyDirectIpTargetSec,
    },
    geometry: candidate, reference, profile: candidate.profile,
    solve: { rangeSource: range.source, residualNm, exact },
  };
}
