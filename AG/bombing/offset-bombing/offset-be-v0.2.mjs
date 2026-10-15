import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { calculateBombDeliveryV0_4Full as calculateBombDeliveryV0_4, ROLL_IN_ONSET_DEFAULTS } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { ONSET_LEVEL_TURN_MODEL_V0_1, calculateOnsetLevelTurn } from "../../../common/maneuvers/turn-performance/onset-level-turn-v0.1.mjs";
import {
  angleOffFromOffsetHeading,
  buildOffsetCandidate,
  buildReferenceState,
  candidateFailureCause,
  directionRule,
  offsetAngleFromAngleOff,
  offsetHeadingFromOffset,
  resolveReferenceInputs,
  scanOffsetAngleRoot,
  validateOffsetCandidate,
} from "./offset-geometry-v0.2.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// 0.2.7 (2026-10-01): true wind (profile.windDirectionTrueDeg), solver failures name their cause,
// a VRP-held Action Point no longer reports as a user LOCK conflict.
// 0.2.8 (2026-10-12): Offset Speed must give a finite TAS > 0 (F5); a non-finite timing/geometry
// is never VALID; with Angle-Off held and Attack Heading free the Offset Angle scan is not cut by the
// entered Attack Heading (F4) and uses the shared scanOffsetAngleRoot.
// 0.2.9 (2026-10-12): profile.trackingTimeStepSec passes through to BDP (Offset enters 0.1 s).
// 0.2.10 (2026-10-15, owner): delivery by BDP v0.4 (technique B Roll-in, linear rate onsets): the Roll-in
// Bank is solved by BDP (not a profile input); the onset rates pass through.
// 0.2.11 (2026-10-15, owner, BDP update R2.1): the Offset turn is an onset level turn (Common
// onset-level-turn-v0.1) with the profile's three onset rates: Action Point and Turn End sit T_in / T_out from
// the corner, Offset Turn time is the flown time.
// 0.2.12 (2026-10-15, owner R3): BDP v0.4.1 SEM path / fragment outputs come with every profile;
// profile.fragmentMarginAppliesTo (developer option) passes through.
// 0.2.13 (2026-10-15, owner): small Offset Angles fly a smaller level turn, G and bank lowered together
// (onset-level-turn 0.1.1).
export const OFFSET_BE_V0_2 = Object.freeze({ id: "offset-be-v0.2", version: "0.2.13", status: "work", deliveryAuthority: "bomb-delivery-planner-v0.4", offsetTurnModel: `${ONSET_LEVEL_TURN_MODEL_V0_1.id} ${ONSET_LEVEL_TURN_MODEL_V0_1.version}` });

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

// Offset input boundary (F5, 2026-10-12): the Offset leg flies a constant TAS, so its speed must give
// a finite TAS > 0 whichever turn value drives. The general airspeed converters keep accepting 0.
function offsetTasKt(input) {
  const altitudeMslFt = finite("offsetAltitudeMslFt", input.offsetAltitudeMslFt);
  const speedValue = finite("offsetSpeedValue", input.offsetSpeedValue);
  const speedMode = input.offsetSpeedMode ?? "CAS";
  if (speedMode !== "CAS" && speedMode !== "MACH") throw new RangeError("Offset Speed mode must be CAS or MACH");
  if (!(speedValue > 0)) throw new RangeError(`Offset Speed must be > 0 ${speedMode === "MACH" ? "Mach" : "KCAS"}`);
  const tasKt = speedToTas(speedValue, speedMode, altitudeMslFt);
  if (!(Number.isFinite(tasKt) && tasKt > 0)) throw new RangeError("Offset Speed must give a finite TAS > 0 kt");
  return tasKt;
}

// Values a VALID/WARNING result must carry as finite numbers (optional N/A fields stay null).
export function nonFiniteResultFields(fields) {
  return Object.entries(fields).filter(([, value]) => !Number.isFinite(value)).map(([name]) => name);
}

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
  const tasKt = offsetTasKt(input);
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

// Offset turn with onsets (R2.1): the same three rates as the Roll-in (one onset set, plan Q3), BDP defaults
// when the profile leaves them out.
export function offsetOnsetTurn(input, turn, offsetAngleDeg) {
  const profile = input.profile ?? {};
  const rate = (key) => (profile[key] === undefined || profile[key] === null ? ROLL_IN_ONSET_DEFAULTS[key] : finite(key, profile[key]));
  return calculateOnsetLevelTurn({
    tasKt: turn.offsetTasKt,
    loadFactorG: turn.offsetG,
    headingChangeDeg: offsetAngleDeg,
    rollInRollRateDegSec: rate("rollInRollRateDegSec"),
    rollOutRollRateDegSec: rate("rollOutRollRateDegSec"),
    gOnsetRateGSec: rate("gOnsetRateGSec"),
  });
}

// BDP takes wind relative to the Attack Heading (0 = headwind). `profile.windDirectionTrueDeg`
// (true FROM direction, Offset FE since 2026-10-01) is converted per candidate Attack Heading, so the
// real wind stays fixed while the solve moves the Attack Heading; without it the legacy
// attack-axis `windDirectionDeg` passes through unchanged.
export function bdpWindDirectionDeg(profile, attackHeadingDeg) {
  if (profile.windDirectionTrueDeg === undefined || profile.windDirectionTrueDeg === null) return profile.windDirectionDeg ?? 0;
  return norm(finite("windDirectionTrueDeg", profile.windDirectionTrueDeg) - finite("attackHeadingDeg", attackHeadingDeg));
}

function canonicalProfileInput(input, angleOffDeg, attackHeadingDeg) {
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
    windDirectionDeg: bdpWindDirectionDeg(profile, attackHeadingDeg),
    windSpeedKt: profile.windSpeedKt ?? 0,
    initialSpeedValue: finite("initialSpeedValue", profile.initialSpeedValue),
    initialSpeedMode: profile.initialSpeedMode ?? "CAS",
    initialAltitudeMslFt: finite("initialAltitudeMslFt", profile.initialAltitudeMslFt),
    solveMode: profile.solveMode ?? "height",
    allowNegativeTrackingTime: profile.allowNegativeTrackingTime === true,
    trackingTimeSec: profile.trackingTimeSec ?? 0,
    trackingTimeStepSec: profile.trackingTimeStepSec,
    releaseAltitudeMslFt: finite("releaseAltitudeMslFt", profile.releaseAltitudeMslFt),
    angleOffDeg,
    rollInG: finite("rollInG", profile.rollInG),
    // Developer option (BDP v0.4.1): the Fragment Height Margin on the radius too (default) or on the height only.
    fragmentMarginAppliesTo: profile.fragmentMarginAppliesTo,
    // BDP v0.4 Roll-in onset rates (absent: the BDP defaults).
    ...Object.fromEntries(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"].filter((key) => profile[key] !== undefined && profile[key] !== null).map((key) => [key, finite(key, profile[key])])),
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
  const solved = scanOffsetAngleRoot({ targetValue, evaluate, metric, minAngleDeg: minOffsetAngleDeg, maxAngleDeg: maxOffsetAngleDeg, tolerance, refineIterations: 40 });
  return { candidate: solved.candidate, residualNm: solved.residual, exact: solved.exact, failureCause: solved.failureCause };
}

// Offset Angle scan range (F4, 2026-10-12). With the Attack Heading fixed (LOCK or entered and held)
// the Angle-Off of a candidate grows with its Offset Angle, so the range ends where Angle-Off would
// pass 179.4°. With the Angle-Off held and the Attack Heading free, each candidate derives its own
// Attack Heading (and is checked for the fixed side), so the entered Attack Heading must not cut the
// range: the full 120° scan applies.
export function offsetAngleScanMaxDeg({ locks = {}, driver, direction }) {
  const attackDerived = !locks.attackHeadingDeg && (!!locks.angleOffDeg || driver === "angleOffDeg");
  return attackDerived ? 120 : Math.max(0.1, Math.min(120, 179.4 - Math.abs(direction.deltaDeg)));
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
// Public entrypoints return BE output truncated to 5 decimals (docs/FE-BE-RULES.md); the *Full
// variants keep full precision for BE-to-BE composition and internal re-solves.
export function calculateOffsetWithVrpStart(input) {
  return truncateBeOutput(calculateOffsetWithVrpStartFull(input));
}

export function calculateOffsetWithVrpStartFull(input) {
  const locks = { ...input.locks };
  const vrpDriven = ["vrpRangeNm", "vrpBearingDeg"].includes(input.driver);
  const holdVrp = !!locks.vrpReference || vrpDriven;
  // VRP LOCK only holds VRP; a linked IP keeps following it (2026-09-26). Only an IP LOCK freezes IP.
  const linked = input.ipLinkedToVrp === true && !locks.ipReference;
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
  const actionRangeHeldAtVrp = holdVrp && !locks.actionRangeNm;
  if (holdVrp) locks.actionRangeNm = true;
  const candidateInput = {
    ...input,
    locks,
    actionRangeHeldAtVrp,
    runInHeadingDeg: runIn,
    driver: vrpDriven ? "actionRangeNm" : input.driver,
    actionRangeNm: holdVrp ? input.vrpRangeNm : input.actionRangeNm,
    ipRangeNm: linked && holdVrp ? input.vrpRangeNm + ipLinkLeadNm : input.ipRangeNm,
  };
  const first = calculateOffsetV0_2Full(candidateInput);
  // VRP must stay at or inside IP (Target-referenced ranges). An unlocked independent IP that the
  // solved Action Point has passed is pushed back out by re-linking it (IP = VRP + lead); only a
  // locked IP can be passed, and that result stays INVALID but fully drawn (no clamping).
  const relinked = !linked && !locks.ipReference && first.resolved.actionRangeNm > candidateInput.ipRangeNm + 0.001;
  const ipLinkedToVrp = linked || relinked;
  // A second, bounded composition changes reference/IP metadata only. The
  // delivery and turn solution is unchanged; linked IP follows the solved AP.
  const result = calculateOffsetV0_2Full({
    ...candidateInput,
    ipRangeNm: ipLinkedToVrp ? first.resolved.actionRangeNm + ipLinkLeadNm : candidateInput.ipRangeNm,
    vrpBearingDeg: holdVrp ? input.vrpBearingDeg : norm(runIn + 180),
    vrpRangeNm: holdVrp ? input.vrpRangeNm : first.resolved.actionRangeNm,
  });
  result.locks = { ...input.locks };
  result.referencePolicy = "VRP_ACTION_START";
  result.ipLinkedToVrp = ipLinkedToVrp;
  result.ipRelinked = relinked;
  result.ipLinkLeadNm = ipLinkLeadNm;
  return result;
}

export function calculateOffsetV0_2(input) {
  return truncateBeOutput(calculateOffsetV0_2Full(input));
}

export function calculateOffsetV0_2Full(input) {
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
    const profile = calculateBombDeliveryV0_4(canonicalProfileInput(input, headings.angleOffDeg, headings.attackHeadingDeg));
    return buildOffsetCandidate({
      runInHeadingDeg,
      attackHeadingDeg: headings.attackHeadingDeg,
      offsetAngleDeg,
      offsetRadiusNm: turn.offsetRadiusNm,
      offsetTurn: offsetOnsetTurn(input, turn, offsetAngleDeg),
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
    const maxAngle = offsetAngleScanMaxDeg({ locks, driver, direction });
    const metric = range.kind === "approach" ? (item) => item.approachRangeNm : (item) => item.actionRangeNm;
    const solved = solveOffsetAngleForMetric({ targetValue: range.targetRangeNm, evaluate, metric, maxOffsetAngleDeg: maxAngle, tolerance: 0.002 });
    candidate = solved.candidate;
    residualNm = solved.residualNm;
    exact = solved.exact;
    if (!candidate) throw new Error(`No valid Offset Angle candidate for requested ${range.kind === "approach" ? "Approach Range" : "Action Range"}${solved.failureCause ? ` (cause: ${solved.failureCause})` : ""}`);
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
  // A VRP hold (calculateOffsetWithVrpStart) fixes the Action Point internally; that is not a LOCK
  // the user set, so it reports the real cause.
  if (locks.actionRangeNm && !near(input.actionRangeNm, candidate.actionRangeNm, 0.002)) {
    errors.push(input.actionRangeHeldAtVrp ? "VRP Range cannot be satisfied (Action Point held at VRP)" : "LOCK conflict: Action Range cannot be satisfied");
  }
  if ((locks.approachRangeNm) && !near(approachRangeInput(input), candidate.approachRangeNm, 0.002)) errors.push("LOCK conflict: Approach Range cannot be satisfied");

  const candidateValidation = validateOffsetCandidate(candidate, { referenceMode, ipRangeNm });
  errors.push(...candidateValidation.errors);
  warnings.push(...candidateValidation.warnings);
  const reference = buildReferenceState(candidate, { ...input, referenceMode, ipRangeNm });
  errors.push(...reference.errors);
  warnings.push(...reference.warnings);

  const speedFps = turn.offsetTasKt * KT_TO_FPS;
  // Signed IP -> Action Point leg: negative when the Action Point lies beyond IP (the turn starts
  // before IP). That geometry is INVALID, but its real timing is reported instead of a clamped 0.
  const ingressDistanceNm = ipRangeNm - candidate.actionRangeNm;
  const ingressSec = ingressDistanceNm * FT_PER_NM / speedFps;
  const turnSec = candidate.offsetTurn.timeSec;
  const approachRangeNm = candidate.approachRangeNm;
  const approachSec = Math.max(0, approachRangeNm) * FT_PER_NM / speedFps;
  const rollToReleaseSec = candidate.profile.public.rollInTimeSec + candidate.profile.public.trackingTimeSec;
  const offsetIpToReleaseSec = ingressSec + turnSec + approachSec + rollToReleaseSec;
  const legacyDirectIpTargetSec = ipRangeNm * FT_PER_NM / speedFps;
  const nonFinite = nonFiniteResultFields({ actionRangeNm: candidate.actionRangeNm, approachRangeNm, ingressSec, turnSec, approachSec, rollToReleaseSec, offsetIpToReleaseSec, rollStartX: candidate.points.rollStart.x, rollStartY: candidate.points.rollStart.y });
  if (nonFinite.length) errors.push(`Offset result is not finite (${nonFinite.join(", ")})`);

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
