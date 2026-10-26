import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { ONSET_LEVEL_TURN_MODEL_V0_1, calculateOnsetLevelTurn } from "../../../common/maneuvers/turn-performance/onset-level-turn-v0.1.mjs";
import { calculateOrbitHoldingTurnV0_3, calculateWheelTurnV0_3 } from "./wheel-orbit-turn-v0.3.mjs";
import { WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1, WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1, evaluateWheelOrbitPerformanceValidityV0_1 } from "./wheel-orbit-performance-validity-v0.1.mjs";
import { buildWheelBoxGeometryV0_7 } from "./wheel-box-geometry-v0.7.mjs";
import { truncateDecimals, truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// Wheel-BOX v0.9 composition (owner 2026-10-26, Wheel-BOX handoff "Downwind Angle 0° 고정 / MIN 재정의"; Wheel SPEC
// §18). v0.8's composition with three changes:
// - Downwind Angle fixed at 0°: the Abeam Extension flies the reciprocal of the Attack Heading and the Base Turn is a
//   90° level turn (RIGHT / LEFT). A non-zero angle is refused.
// - Base Turn G: the requested G (default 2) is flown when the Base Turn fits inside Base Distance (Abeam Extension
//   E = Base Distance − advance ≥ 0); otherwise the smallest G up to 3 G that fits (never to make MIN smaller). No G up
//   to 3 G fitting: no MIN, the route cannot connect (an error, no result).
// - Min Wheel Radius = max(geometry minimum K = transfer + Roll-in Long. D, the performance minimum radius of the Wheel
//   turn when its source limits apply). Base Distance is no longer a floor.
// Every weapon BDP supports is flown; a weapon outside the Wheel performance profile has its turn limits NOT_EVALUATED
// (owner 2026-10-26: "폭탄은 전부다 포함"), never borrowed from another weapon. v0.4–v0.8 stay as they were.
export const WHEEL_BOX_BE_MODEL_V0_9 = Object.freeze({
  id: "wheel-box-be-v0.9",
  version: "0.9.0",
  status: "Work / Pure Composition / Not Official",
  bombDeliverySource: BOMB_DELIVERY_PLANNER_MODEL_V0_4.id,
  turnSource: ONSET_LEVEL_TURN_MODEL_V0_1.id,
  wheelOrbitTurnSource: "fst-wheel-orbit-turn-v0.3",
  performanceValiditySource: "wheel-orbit-performance-validity-v0.1",
  routeSource: "wheel-box-geometry-v0.7 (stations, paths, validation)",
  fixedAngleOffDeg: 90,
  downwindAngleDeg: 0,
  baseTurnHeadingChangeDeg: 90,
  // Base Turn G: default, upper limit, and the search for the smallest G that fits (scan steps, then bisection).
  defaultBaseTurnG: 2,
  maxBaseTurnG: 3,
  baseTurnGScanStep: 0.05,
  baseTurnGTolerance: 1e-6,
  // DED OA2 (as BOX): OA1 + this distance along the travel direction at OA1.
  dedOa2AheadNm: 10,
});

const DIRECTIONS = Object.freeze(["RIGHT", "LEFT"]);
const ONSET_KEYS = Object.freeze(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;
// The BOX validation tolerance (0.5 m): a straight leg within it of 0 is 0, never a backward leg.
const EPS_NM = 0.5 / 1852;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
const optional = (name, value) => (value === undefined || value === null ? null : finite(name, value));
const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

// DED point (as BOX): the Target → point true bearing, range (NM, ft) and the Roll-in altitude. The attack frame's side
// axis is Attack Heading + 90° for RIGHT and − 90° for LEFT.
function dedPoint({ alongNm, sideNm }, attackHeadingDeg, sign, elevationFt) {
  const rangeNm = Math.hypot(alongNm, sideNm);
  return {
    bearingDeg: normalizeDeg(attackHeadingDeg + sign * (Math.atan2(sideNm, alongNm) / DEG)),
    rangeNm,
    rangeFt: rangeNm * FT_PER_NM,
    elevationFt,
  };
}

// The Wheel / Orbit turn limits: evaluated for a weapon of the source profile; NOT_EVALUATED otherwise (valid null:
// neither a pass nor a block).
const profileWeapons = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.supportedWeaponIds;
function turnPerformance({ role, weaponId, speedKcas, altitudeMslFt, turnRadiusNm, performanceProfileId }) {
  if (profileWeapons.includes(weaponId)) {
    return evaluateWheelOrbitPerformanceValidityV0_1({ role, weaponId, speedKcas, altitudeMslFt, turnRadiusNm, performanceProfileId });
  }
  return Object.freeze({
    profile: Object.freeze({ id: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id, weaponId, supportedWeaponIds: profileWeapons }),
    role,
    valid: null,
    status: "NOT_EVALUATED",
    reason: `${weaponId} is not in ${WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id} (${profileWeapons.join(", ")}); its limits are not applied by analogy`,
    limitations: WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1,
    issues: Object.freeze([]),
  });
}

// The Base Turn G flown: the requested G when the 90° Base Turn fits inside Base Distance (E ≥ 0); otherwise the
// smallest G up to the limit that fits. The E(G) of the onset turn is scanned in fixed G steps from the requested G
// (the limit included) for the first fitting step, then bisected between it and the step before to the tolerance; the
// fitting end is kept, so E ≥ 0 exactly. E is not assumed monotonic between scan steps (see SPEC).
function resolveBaseTurnG({ requestedG, baseDistanceNm, turnAt }) {
  const model = WHEEL_BOX_BE_MODEL_V0_9;
  const extensionAt = (g) => baseDistanceNm - turnAt(g).end.forwardNm;
  const first = extensionAt(requestedG);
  if (first >= -EPS_NM) return { loadFactorG: requestedG, autoRaised: false, requestedExtensionNm: first };
  let low = requestedG;
  for (let step = 1; ; step += 1) {
    const g = Math.min(requestedG + step * model.baseTurnGScanStep, model.maxBaseTurnG);
    if (extensionAt(g) >= 0) {
      let high = g;
      while (high - low > model.baseTurnGTolerance) {
        const mid = (low + high) / 2;
        if (extensionAt(mid) >= 0) high = mid;
        else low = mid;
      }
      return { loadFactorG: high, autoRaised: true, requestedExtensionNm: first };
    }
    if (g >= model.maxBaseTurnG) break;
    low = g;
  }
  const atLimit = extensionAt(model.maxBaseTurnG);
  throw new RangeError(`No Min Wheel Radius: the 90° Base Turn does not fit inside Base Distance ${truncateDecimals(baseDistanceNm, 2)} NM even at ${model.maxBaseTurnG} G (Abeam Extension ${truncateDecimals(atLimit, 2)} NM); the route cannot connect. Change the BDP (Dive Angle, Roll-in / Release conditions).`);
}

// Public entrypoint: result truncated to 5 decimals (docs/FE-BE-RULES.md). BE-to-BE composition uses the Full form.
export function calculateWheelBoxV0_9(input) {
  return truncateBeOutput(calculateWheelBoxV0_9Full(input));
}

// input:
//   bombDeliveryInput        BDP v0.4 input (the composition sets Angle-Off 90°)
//   attackHeadingDeg         true
//   direction                RIGHT | LEFT (the pattern side and the Roll-in turn), default RIGHT
//   downwindAngleDeg         0 only (fixed; omitted = 0, any other value is refused)
//   wheelRadiusNm            null = MIN_WHEEL_RADIUS (follows Min Wheel Radius); a number = MANUAL
//   baseTurnG                requested Base Turn G, > 1 and ≤ 3 (default 2); the flown G may be raised (above)
//   wheelSpeedKcas / wheelAltitudeMslFt   Wheel turn readout overrides (default the BDP Initial state)
//   orbitRadiusNm / orbitSpeedKcas / orbitAltitudeMslFt   optional Orbit (waiting circle, not in the attack path)
export function calculateWheelBoxV0_9Full({
  bombDeliveryInput,
  attackHeadingDeg,
  direction = "RIGHT",
  downwindAngleDeg = 0,
  wheelRadiusNm = null,
  baseTurnG = WHEEL_BOX_BE_MODEL_V0_9.defaultBaseTurnG,
  wheelSpeedKcas = null,
  wheelAltitudeMslFt = null,
  orbitRadiusNm = null,
  orbitSpeedKcas = null,
  orbitAltitudeMslFt = null,
  performanceProfileId = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id,
}) {
  const model = WHEEL_BOX_BE_MODEL_V0_9;
  if (!bombDeliveryInput || typeof bombDeliveryInput !== "object") throw new TypeError("bombDeliveryInput must be an object");
  finite("attackHeadingDeg", attackHeadingDeg);
  if (!DIRECTIONS.includes(direction)) throw new RangeError("direction must be RIGHT or LEFT");
  if (downwindAngleDeg !== 0) throw new RangeError("Downwind Angle is fixed at 0 deg in Wheel-BOX v0.9");
  finite("baseTurnG", baseTurnG);
  if (!(baseTurnG > 1 && baseTurnG <= model.maxBaseTurnG)) throw new RangeError(`Base Turn G must be > 1 and <= ${model.maxBaseTurnG} G`);
  const manualRadiusNm = optional("wheelRadiusNm", wheelRadiusNm);
  if (manualRadiusNm !== null && !(manualRadiusNm > 0)) throw new RangeError("Wheel Radius must be > 0 NM");

  const sign = direction === "RIGHT" ? 1 : -1;
  const attack = normalizeDeg(attackHeadingDeg);
  // BDP v0.4 at the Wheel-BOX Angle-Off; a blank SEM Turn Direction is the pattern side.
  const bombDelivery = calculateBombDeliveryV0_4Full({
    ...bombDeliveryInput,
    semTurnDirection: bombDeliveryInput.semTurnDirection ?? direction,
    angleOffDeg: model.fixedAngleOffDeg,
  });
  const pub = bombDelivery.public;
  const baseDistanceNm = finite("public.baseDistanceNm", pub.baseDistanceNm);
  const rollInLongitudinalDistanceNm = finite("public.rollInDisplacement.forwardNm", pub.rollInDisplacement?.forwardNm);
  const patternTasKt = finite("diagnostics.initialTasKt", bombDelivery.diagnostics?.initialTasKt);
  const patternSpeedKcas = finite("public.resolvedInitialSpeedKcas", pub.resolvedInitialSpeedKcas);
  const patternAltitudeMslFt = finite("public.resolvedInitialAltitudeMslFt", pub.resolvedInitialAltitudeMslFt);
  const weaponId = bombDelivery.canonicalInputs.weaponId;

  // One set of onset rates per aircraft: the BDP Roll-in's (entered, else the BDP defaults).
  const onset = Object.fromEntries(ONSET_KEYS.map((key) => [
    key,
    bombDeliveryInput[key] === undefined || bombDeliveryInput[key] === null ? ROLL_IN_ONSET_DEFAULTS[key] : finite(key, bombDeliveryInput[key]),
  ]));
  // Base Turn: from the Downwind heading (the reciprocal of the Attack Heading) to the Base Leg heading, 90°.
  const turnAt = (loadFactorG) => calculateOnsetLevelTurn({ tasKt: patternTasKt, loadFactorG, headingChangeDeg: model.baseTurnHeadingChangeDeg, ...onset });
  const resolved = resolveBaseTurnG({ requestedG: baseTurnG, baseDistanceNm, turnAt });
  const turn = turnAt(resolved.loadFactorG);
  const base = {
    ...turn,
    advanceNm: turn.end.forwardNm,
    transferNm: turn.end.turnSideNm,
    requestedLoadFactorG: baseTurnG,
    autoRaised: resolved.autoRaised,
    requestedAbeamExtensionNm: resolved.requestedExtensionNm,
  };

  // Attack frame (NM): alongNm along the Attack Heading from the Target, sideNm toward the pattern side. At 0°:
  //   Abeam (0, R) · Abeam Extension E = Base Distance − advance · Base Turn end (−Base Distance, R − transfer)
  //   OA1 (−Base Distance, Roll-in Long. D) · geometry minimum K = transfer + Roll-in Long. D · Base Leg = R − K.
  const abeamExtensionNm = Math.max(0, baseDistanceNm - base.advanceNm);
  const geometryMinWheelRadiusNm = base.transferNm + rollInLongitudinalDistanceNm;

  // The Wheel turn's own limit: the radius its source limits allow at the Wheel speed / altitude (the 5.5 G radius), or
  // none when they are NOT_EVALUATED. Mach is not a radius limit: it stays an error at any radius.
  const wheelState = calculateWheelTurnV0_3({
    initialSpeedKcas: patternSpeedKcas,
    initialAltitudeMslFt: patternAltitudeMslFt,
    minWheelRadiusNm: geometryMinWheelRadiusNm,
    wheelSpeedKcas: optional("wheelSpeedKcas", wheelSpeedKcas),
    wheelAltitudeMslFt: optional("wheelAltitudeMslFt", wheelAltitudeMslFt),
  });
  const probe = turnPerformance({ role: "WHEEL", weaponId, speedKcas: wheelState.wheelSpeedKcas, altitudeMslFt: wheelState.wheelAltitudeMslFt, turnRadiusNm: geometryMinWheelRadiusNm, performanceProfileId });
  const performanceMinWheelRadiusNm = probe.valid === null ? null : probe.checks.positiveLoadFactor.minimumRadiusAtCurrentSpeedNm;
  const minWheelRadiusNm = Math.max(geometryMinWheelRadiusNm, performanceMinWheelRadiusNm ?? 0);

  // Wheel Radius: MIN_WHEEL_RADIUS follows Min Wheel Radius; MANUAL keeps the typed value, checked against it (never
  // clamped). Every readout below uses the radius flown.
  const radiusMode = manualRadiusNm === null ? "MIN_WHEEL_RADIUS" : "MANUAL";
  const radiusNm = manualRadiusNm ?? minWheelRadiusNm;
  const baseLegSignedNm = radiusNm - geometryMinWheelRadiusNm;
  const legTimeSec = (distanceNm) => (distanceNm * 3600) / patternTasKt;
  const pattern = {
    baseDistanceNm,
    rollInLongitudinalDistanceNm,
    patternTasKt,
    patternSpeedKcas,
    patternAltitudeMslFt,
    downwindAngleDeg: model.downwindAngleDeg,
    downwindAngleFixed: true,
    abeamExtensionSignedNm: abeamExtensionNm,
    abeamExtensionDistanceNm: abeamExtensionNm,
    // Abeam (as BOX): the time flown on past the Wheel's Abeam before the Base Turn.
    abeamExtensionTimeSec: legTimeSec(abeamExtensionNm),
    baseLegSignedNm,
    baseLegNm: baseLegSignedNm,
    baseLegTimeSec: legTimeSec(baseLegSignedNm),
  };

  const wheelTurn = calculateWheelTurnV0_3({
    initialSpeedKcas: patternSpeedKcas,
    initialAltitudeMslFt: patternAltitudeMslFt,
    minWheelRadiusNm: radiusNm,
    wheelRadiusNm: radiusNm,
    wheelSpeedKcas: optional("wheelSpeedKcas", wheelSpeedKcas),
    wheelAltitudeMslFt: optional("wheelAltitudeMslFt", wheelAltitudeMslFt),
  });
  const wheelPerformance = turnPerformance({ role: "WHEEL", weaponId, speedKcas: wheelTurn.wheelSpeedKcas, altitudeMslFt: wheelTurn.wheelAltitudeMslFt, turnRadiusNm: radiusNm, performanceProfileId });
  let orbit = null;
  const orbitRadius = optional("orbitRadiusNm", orbitRadiusNm);
  if (orbitRadius !== null) {
    const orbitTurn = calculateOrbitHoldingTurnV0_3({
      initialSpeedKcas: patternSpeedKcas,
      initialAltitudeMslFt: patternAltitudeMslFt,
      orbitRadiusNm: orbitRadius,
      orbitSpeedKcas: optional("orbitSpeedKcas", orbitSpeedKcas),
      orbitAltitudeMslFt: optional("orbitAltitudeMslFt", orbitAltitudeMslFt),
    });
    orbit = {
      role: orbitTurn.role,
      orbitSpeedKcas: orbitTurn.orbitSpeedKcas,
      orbitAltitudeMslFt: orbitTurn.orbitAltitudeMslFt,
      orbitRadiusNm: orbitTurn.orbitRadiusNm,
      orbitBankAngleDeg: orbitTurn.orbitBankAngleDeg,
      orbitTurn180TimeSec: orbitTurn.orbitTurn180TimeSec,
      performance: turnPerformance({ role: "ORBIT", weaponId, speedKcas: orbitTurn.orbitSpeedKcas, altitudeMslFt: orbitTurn.orbitAltitudeMslFt, turnRadiusNm: orbitRadius, performanceProfileId }),
    };
  }

  const result = {
    model: { ...model },
    fixedAngleOffDeg: model.fixedAngleOffDeg,
    attackHeadingDeg: attack,
    direction,
    turnSideSign: sign,
    // The Base Leg flies into OA1 at Attack Heading − 90° (RIGHT) / + 90° (LEFT); the Roll-in turns to the pattern side.
    baseLegHeadingDeg: normalizeDeg(attack - sign * 90),
    downwindHeadingDeg: normalizeDeg(attack + 180),
    rollDirection: direction,
    bombDelivery,
    onset,
    turns: { base },
    wheel: {
      role: "ATTACK_PATTERN",
      radiusMode,
      minWheelRadiusNm,
      geometryMinWheelRadiusNm,
      performanceMinWheelRadiusNm,
      radiusNm,
      // v0.8 names, kept for the views: the radius for a zero Base Leg and the smallest usable radius.
      wheelRadiusForZeroBaseLegNm: geometryMinWheelRadiusNm,
      minimumUsableWheelRadiusNm: minWheelRadiusNm,
      wheelSpeedKcas: wheelTurn.wheelSpeedKcas,
      wheelAltitudeMslFt: wheelTurn.wheelAltitudeMslFt,
      wheelBankAngleDeg: wheelTurn.wheelBankAngleDeg,
      wheelTurn180TimeSec: wheelTurn.wheelTurn180TimeSec,
      performance: wheelPerformance,
    },
    orbit,
    pattern,
  };
  result.geometry = buildWheelBoxGeometryV0_7(result);
  const oa1 = result.geometry.stations.oa1;
  result.ded = {
    oa1: dedPoint(oa1, attack, sign, patternAltitudeMslFt),
    oa2: dedPoint({ alongNm: oa1.alongNm, sideNm: oa1.sideNm - model.dedOa2AheadNm }, attack, sign, patternAltitudeMslFt),
  };
  return result;
}
