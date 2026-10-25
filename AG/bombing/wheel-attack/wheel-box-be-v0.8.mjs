import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { ONSET_LEVEL_TURN_MODEL_V0_1, calculateOnsetLevelTurn } from "../../../common/maneuvers/turn-performance/onset-level-turn-v0.1.mjs";
import { calculateOrbitHoldingTurnV0_3, calculateWheelTurnV0_3 } from "./wheel-orbit-turn-v0.3.mjs";
import { WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1, evaluateWheelOrbitPerformanceValidityV0_1 } from "./wheel-orbit-performance-validity-v0.1.mjs";
import { buildWheelBoxGeometryV0_6 } from "./wheel-box-geometry-v0.6.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// Wheel-BOX v0.8 composition (owner 2026-10-25: "Wheel도 작업하자"; Wheel-BOX (V2), a separate page as BOX, the BE
// based as BOX v0.3). Wheel keeps its own BE: the Wheel circle (Min Wheel Radius = Base Distance, Wheel Radius at or
// above it), the Downwind Angle, Abeam, Abeam Extension, Base Turn, Base Leg and RIGHT / LEFT. It shares what is the
// same as BOX v0.3:
// - BDP v0.4 at Angle-Off 90° (Roll-in model B; Roll-in Bank is the BDP's result);
// - the Base Turn as a Common onset level turn with the aircraft's one set of onset rates (the BDP Roll-in's), so the
//   turn's `advance` / `transfer` replace v0.5's circular radius;
// - the pattern flown at the BDP Initial TAS at full precision;
// - DED OA1 = the Roll-in point, OA2 = 10 NM past OA1 along the pre-roll-in heading (iBT retired, as BOX).
// The Wheel / Orbit radius-driven turn readouts (v0.3) and the source-bounded performance validity (v0.1) are reused
// unchanged. Wheel-BOX v0.4–v0.7 stay as they were.
export const WHEEL_BOX_BE_MODEL_V0_8 = Object.freeze({
  id: "wheel-box-be-v0.8",
  version: "0.8.0",
  status: "Work / Pure Composition / Not Official",
  bombDeliverySource: BOMB_DELIVERY_PLANNER_MODEL_V0_4.id,
  turnSource: ONSET_LEVEL_TURN_MODEL_V0_1.id,
  wheelOrbitTurnSource: "fst-wheel-orbit-turn-v0.3",
  performanceValiditySource: "wheel-orbit-performance-validity-v0.1",
  routeSource: "wheel-box-geometry-v0.6 (stations, paths, validation)",
  fixedAngleOffDeg: 90,
  downwindAngleLimitDeg: 90,
  // DED OA2 (as BOX): OA1 + this distance along the travel direction at OA1.
  dedOa2AheadNm: 10,
});

const DIRECTIONS = Object.freeze(["RIGHT", "LEFT"]);
const ONSET_KEYS = Object.freeze(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;

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

// Public entrypoint: result truncated to 5 decimals (docs/FE-BE-RULES.md). BE-to-BE composition uses the Full form.
export function calculateWheelBoxV0_8(input) {
  return truncateBeOutput(calculateWheelBoxV0_8Full(input));
}

// input:
//   bombDeliveryInput        BDP v0.4 input (the composition sets Angle-Off 90°)
//   attackHeadingDeg         true
//   direction                RIGHT | LEFT (the pattern side and the Roll-in turn), default RIGHT
//   downwindAngleDeg         from the rear axis, + toward the Target, −90 < A < 90, default 0
//   wheelRadiusNm            null = MIN_WHEEL_RADIUS (follows Base Distance); a number = MANUAL
//   baseTurnG                > 1
//   wheelSpeedKcas / wheelAltitudeMslFt   Wheel turn readout overrides (default the BDP Initial state)
//   orbitRadiusNm / orbitSpeedKcas / orbitAltitudeMslFt   optional Orbit (waiting circle, not in the attack path)
export function calculateWheelBoxV0_8Full({
  bombDeliveryInput,
  attackHeadingDeg,
  direction = "RIGHT",
  downwindAngleDeg = 0,
  wheelRadiusNm = null,
  baseTurnG,
  wheelSpeedKcas = null,
  wheelAltitudeMslFt = null,
  orbitRadiusNm = null,
  orbitSpeedKcas = null,
  orbitAltitudeMslFt = null,
  performanceProfileId = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id,
}) {
  if (!bombDeliveryInput || typeof bombDeliveryInput !== "object") throw new TypeError("bombDeliveryInput must be an object");
  finite("attackHeadingDeg", attackHeadingDeg);
  if (!DIRECTIONS.includes(direction)) throw new RangeError("direction must be RIGHT or LEFT");
  finite("downwindAngleDeg", downwindAngleDeg);
  const limit = WHEEL_BOX_BE_MODEL_V0_8.downwindAngleLimitDeg;
  if (!(downwindAngleDeg > -limit && downwindAngleDeg < limit)) throw new RangeError("Downwind Angle must be > -90 and < 90 deg");
  finite("baseTurnG", baseTurnG);
  if (!(baseTurnG > 1)) throw new RangeError("Base Turn G must be > 1");
  const manualRadiusNm = optional("wheelRadiusNm", wheelRadiusNm);
  if (manualRadiusNm !== null && !(manualRadiusNm > 0)) throw new RangeError("Wheel Radius must be > 0 NM");

  const sign = direction === "RIGHT" ? 1 : -1;
  const attack = normalizeDeg(attackHeadingDeg);
  // BDP v0.4 at the Wheel-BOX Angle-Off; a blank SEM Turn Direction is the pattern side.
  const bombDelivery = calculateBombDeliveryV0_4Full({
    ...bombDeliveryInput,
    semTurnDirection: bombDeliveryInput.semTurnDirection ?? direction,
    angleOffDeg: WHEEL_BOX_BE_MODEL_V0_8.fixedAngleOffDeg,
  });
  const pub = bombDelivery.public;
  const baseDistanceNm = finite("public.baseDistanceNm", pub.baseDistanceNm);
  const patternTasKt = finite("diagnostics.initialTasKt", bombDelivery.diagnostics?.initialTasKt);
  const patternSpeedKcas = finite("public.resolvedInitialSpeedKcas", pub.resolvedInitialSpeedKcas);
  const patternAltitudeMslFt = finite("public.resolvedInitialAltitudeMslFt", pub.resolvedInitialAltitudeMslFt);

  const minWheelRadiusNm = baseDistanceNm;

  // One set of onset rates per aircraft: the BDP Roll-in's (entered, else the BDP defaults).
  const onset = Object.fromEntries(ONSET_KEYS.map((key) => [
    key,
    bombDeliveryInput[key] === undefined || bombDeliveryInput[key] === null ? ROLL_IN_ONSET_DEFAULTS[key] : finite(key, bombDeliveryInput[key]),
  ]));
  // Base Turn: from the Downwind heading to the Base Leg heading, 90° − Downwind Angle.
  const baseTurnHeadingChangeDeg = WHEEL_BOX_BE_MODEL_V0_8.fixedAngleOffDeg - downwindAngleDeg;
  const turn = calculateOnsetLevelTurn({ tasKt: patternTasKt, loadFactorG: baseTurnG, headingChangeDeg: baseTurnHeadingChangeDeg, ...onset });
  const base = { ...turn, advanceNm: turn.end.forwardNm, transferNm: turn.end.turnSideNm };

  // Attack frame (NM): alongNm along the Attack Heading from the Target, sideNm toward the pattern side. Downwind unit
  // d = (−cos A, −sin A); the Base Turn turns toward t = (sin A, −cos A) and ends on the Base Leg heading (0, −1).
  //   Abeam                = (0, Wheel Radius)
  //   Abeam Extension E    = (Base Distance + transfer · sin A) / cos A − advance   (the Base Turn ends on OA1's along)
  //   Base Turn end side   = Wheel Radius − (E + advance) · sin A − transfer · cos A
  //   Base Leg             = Base Turn end side − Roll-in Long. D
  // At A = 0 these are BOX v0.3's; with a circular turn (advance = r cos A, transfer = r (1 − sin A)) they are v0.5's.
  const a = downwindAngleDeg * DEG;
  const rollInLongitudinalDistanceNm = finite("public.rollInDisplacement.forwardNm", pub.rollInDisplacement?.forwardNm);
  const abeamExtensionSignedNm = (baseDistanceNm + base.transferNm * Math.sin(a)) / Math.cos(a) - base.advanceNm;
  // The Base Leg is Wheel Radius − this; it is the Wheel Radius for a zero Base Leg (no Wheel Radius in it).
  const wheelRadiusForZeroBaseLegNm = (abeamExtensionSignedNm + base.advanceNm) * Math.sin(a) + base.transferNm * Math.cos(a) + rollInLongitudinalDistanceNm;
  const minimumUsableWheelRadiusNm = Math.max(minWheelRadiusNm, wheelRadiusForZeroBaseLegNm);
  // Wheel Radius: MIN_WHEEL_RADIUS is the smallest radius that flies the route, max(Min Wheel Radius = Base Distance,
  // the radius for a zero Base Leg) — BOX's "a default is raised to its minimum" rule; MANUAL keeps the typed value,
  // and below a minimum it is reported (never clamped).
  const radiusMode = manualRadiusNm === null ? "MIN_WHEEL_RADIUS" : "MANUAL";
  const radiusNm = manualRadiusNm ?? minimumUsableWheelRadiusNm;
  const baseLegSignedNm = radiusNm - wheelRadiusForZeroBaseLegNm;
  const legTimeSec = (distanceNm) => (distanceNm * 3600) / patternTasKt;
  const pattern = {
    baseDistanceNm,
    rollInLongitudinalDistanceNm,
    patternTasKt,
    patternSpeedKcas,
    patternAltitudeMslFt,
    downwindAngleDeg,
    abeamExtensionSignedNm,
    abeamExtensionDistanceNm: abeamExtensionSignedNm,
    // Abeam (as BOX): the time flown on past the Wheel's Abeam before the Base Turn.
    abeamExtensionTimeSec: legTimeSec(abeamExtensionSignedNm),
    baseLegSignedNm,
    baseLegNm: baseLegSignedNm,
    baseLegTimeSec: legTimeSec(baseLegSignedNm),
  };

  // Wheel and Orbit radius-driven turn readouts and their source-bounded validity (v0.3 / v0.1, unchanged).
  const wheelTurn = calculateWheelTurnV0_3({
    initialSpeedKcas: patternSpeedKcas,
    initialAltitudeMslFt: patternAltitudeMslFt,
    minWheelRadiusNm,
    // The readout follows the radius flown (a MANUAL radius below the minimum is the route validation's error).
    wheelRadiusNm: Math.max(radiusNm, minWheelRadiusNm),
    wheelSpeedKcas: optional("wheelSpeedKcas", wheelSpeedKcas),
    wheelAltitudeMslFt: optional("wheelAltitudeMslFt", wheelAltitudeMslFt),
  });
  const weaponId = bombDelivery.canonicalInputs.weaponId;
  const wheelPerformance = evaluateWheelOrbitPerformanceValidityV0_1({
    role: "WHEEL", weaponId, speedKcas: wheelTurn.wheelSpeedKcas, altitudeMslFt: wheelTurn.wheelAltitudeMslFt, turnRadiusNm: wheelTurn.wheelRadiusNm, performanceProfileId,
  });
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
      performance: evaluateWheelOrbitPerformanceValidityV0_1({
        role: "ORBIT", weaponId, speedKcas: orbitTurn.orbitSpeedKcas, altitudeMslFt: orbitTurn.orbitAltitudeMslFt, turnRadiusNm: orbitRadius, performanceProfileId,
      }),
    };
  }

  const result = {
    model: { ...WHEEL_BOX_BE_MODEL_V0_8 },
    fixedAngleOffDeg: WHEEL_BOX_BE_MODEL_V0_8.fixedAngleOffDeg,
    attackHeadingDeg: attack,
    direction,
    turnSideSign: sign,
    // The Base Leg flies into OA1 at Attack Heading − 90° (RIGHT) / + 90° (LEFT); the Roll-in turns to the pattern side.
    baseLegHeadingDeg: normalizeDeg(attack - sign * 90),
    downwindHeadingDeg: normalizeDeg(attack + 180 + sign * downwindAngleDeg),
    rollDirection: direction,
    bombDelivery,
    onset,
    turns: { base },
    wheel: {
      role: "ATTACK_PATTERN",
      radiusMode,
      minWheelRadiusNm,
      radiusNm,
      wheelRadiusForZeroBaseLegNm,
      minimumUsableWheelRadiusNm,
      wheelSpeedKcas: wheelTurn.wheelSpeedKcas,
      wheelAltitudeMslFt: wheelTurn.wheelAltitudeMslFt,
      wheelBankAngleDeg: wheelTurn.wheelBankAngleDeg,
      wheelTurn180TimeSec: wheelTurn.wheelTurn180TimeSec,
      performance: wheelPerformance,
    },
    orbit,
    pattern,
  };
  result.geometry = buildWheelBoxGeometryV0_6(result);
  const oa1 = result.geometry.stations.oa1;
  result.ded = {
    oa1: dedPoint(oa1, attack, sign, patternAltitudeMslFt),
    oa2: dedPoint({ alongNm: oa1.alongNm, sideNm: oa1.sideNm - WHEEL_BOX_BE_MODEL_V0_8.dedOa2AheadNm }, attack, sign, patternAltitudeMslFt),
  };
  return result;
}
