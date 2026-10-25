import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { ONSET_LEVEL_TURN_MODEL_V0_1, calculateOnsetLevelTurn } from "../../../common/maneuvers/turn-performance/onset-level-turn-v0.1.mjs";
import { calculateBoxOutManeuverV0_1Full } from "./box-out-maneuver-v0.1.mjs";
import { buildBoxPatternGeometryV0_3 } from "./box-pattern-geometry-v0.3.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// BOX v0.3 composition (BOX handoff 2026-10-23, G02; owner decisions 2026-10-23/25). BOX keeps its own BE: the
// 90° Angle-Off, the racetrack, Abeam, OUT and Crosswind Leg policy. It shares the calculations that are the same:
// - BDP v0.4 (Roll-in model B; Roll-in Bank is the BDP's result, not a BOX input);
// - the Common onset level turn for the Crosswind and Base Turns, with the aircraft's one set of onset rates, the
//   same rates its BDP Roll-in flies (owner 2026-10-25: option A, the Offset Turn's rule);
// - the pattern flown at the BDP's Initial TAS at full precision (v0.2 rounded it to 0.1 kt).
// It returns the BDP result it used, the turns, the route with its validation, and the DED OA1 / OA2.
// BOX v0.2 (box-v2-composition-v0.2.mjs) stays as it was for the V2 BDP + BOX shell.
export const BOX_V2_COMPOSITION_MODEL_V0_3 = Object.freeze({
  id: "box-v2-composition-v0.3",
  // 0.3.1 (2026-10-25, BOX page): the result names the Base Leg heading into OA1 (baseLegHeadingDeg) for the BDP views.
  version: "0.3.1",
  status: "Work / Pure Composition / Not Official",
  bombDeliverySource: BOMB_DELIVERY_PLANNER_MODEL_V0_4.id,
  turnSource: ONSET_LEVEL_TURN_MODEL_V0_1.id,
  outSource: "box-out-maneuver-v0.1 (Rev1.5 OUT)",
  routeSource: "box-pattern-geometry-v0.3 (stations, paths, Rev1.5 validation)",
  fixedAngleOffDeg: 90,
  turnHeadingChangeDeg: 90,
  // DED OA2 (owner 2026-10-23/25, BOX only): OA1 + this distance along the travel direction at OA1.
  dedOa2AheadNm: 10,
});

const CROSS_LEG_SOURCES = Object.freeze(["USER", "DEFAULT"]);
const ONSET_KEYS = Object.freeze(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);
const FT_PER_NM = 6076.11549;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

// A 90° Common onset level turn, kept with the two distances the racetrack needs: `advance` along the entry heading
// and `transfer` along the exit heading (for 90° these are the turn's entry / exit distances to its corner).
function patternTurn(name, { tasKt, loadFactorG, onset }) {
  if (!(loadFactorG > 1)) throw new RangeError(`${name} G must be > 1`);
  const turn = calculateOnsetLevelTurn({ tasKt, loadFactorG, headingChangeDeg: BOX_V2_COMPOSITION_MODEL_V0_3.turnHeadingChangeDeg, ...onset });
  return { ...turn, advanceNm: turn.end.forwardNm, transferNm: turn.end.turnSideNm };
}

// Rev1.5 `recalc` OUT closure on the onset quantities:
//   OUT Turn Start      = max(OUT distance, Crosswind Turn transfer − OUT Turn Radius)   (the Downwind starts at or
//                         past the Target abeam line)
//   Crosswind climb min = as Rev1.5 (the OUT Turn is still the Roll-in mirror arc)
//   Crosswind Leg min   = max(0, Base Turn transfer − Crosswind Turn advance, Crosswind climb min)   (Base Leg ≥ 0)
function outClosureOf({ out, outTurnRadiusNm, cross, base }) {
  const outTurnStartMinimumNm = Math.max(0, cross.transferNm - outTurnRadiusNm);
  const outAutoExtensionNm = Math.max(0, outTurnStartMinimumNm - out.outDistanceNm);
  const effectiveOutNm = out.outDistanceNm + outAutoExtensionNm;
  const straightClimbBeforeTurnNm = Math.max(0, effectiveOutNm - out.recoveryEndTargetNm);
  const remainingClimbNm = Math.max(0, out.climbDistanceNm - straightClimbBeforeTurnNm);
  const climbCrossMinNm = out.inputs.mode === "CLIMB" ? Math.max(0, remainingClimbNm - (Math.PI * outTurnRadiusNm) / 2) : 0;
  const turnCrossMinNm = Math.max(0, base.transferNm - cross.advanceNm);
  return {
    outTurnRadiusNm,
    outTurnStartMinimumNm,
    outAutoExtensionNm,
    effectiveOutNm,
    straightClimbBeforeTurnNm,
    remainingClimbNm,
    climbCrossMinNm,
    turnCrossMinNm,
    crossLegMinimumNm: Math.max(turnCrossMinNm, climbCrossMinNm),
  };
}

// DED points (owner 2026-10-23/25, BOX only; the former OA2 = iBT is retired): OA1 is the Roll-in point; OA2 is
// 10 NM past OA1 along the travel direction there (the pre-roll-in heading, −side in the attack frame). Each page
// gives the Target → point true bearing, the horizontal range and, as the Offset DED does for OA1, the Roll-in
// altitude.
function dedPoint({ alongNm, sideNm }, attackHeadingDeg, elevationFt) {
  const rangeNm = Math.hypot(alongNm, sideNm);
  return {
    bearingDeg: normalizeDeg(attackHeadingDeg + (Math.atan2(sideNm, alongNm) * 180) / Math.PI),
    rangeNm,
    rangeFt: rangeNm * FT_PER_NM,
    elevationFt,
  };
}

// Public entrypoint: result truncated to 5 decimals (docs/FE-BE-RULES.md). BE-to-BE composition uses
// calculateBoxPatternV0_3Full, which keeps full precision.
export function calculateBoxPatternV0_3(input) {
  return truncateBeOutput(calculateBoxPatternV0_3Full(input));
}

export function calculateBoxPatternV0_3Full({
  bombDeliveryInput,
  attackHeadingDeg,
  baseTurnG,
  crossTurnG,
  crossLegExtensionNm,
  crossLegExtensionSource = "USER",
  out: outOptions = {},
}) {
  if (!bombDeliveryInput || typeof bombDeliveryInput !== "object") throw new TypeError("bombDeliveryInput must be an object");
  finite("attackHeadingDeg", attackHeadingDeg);
  finite("baseTurnG", baseTurnG);
  finite("crossTurnG", crossTurnG);
  finite("crossLegExtensionNm", crossLegExtensionNm);
  if (!CROSS_LEG_SOURCES.includes(crossLegExtensionSource)) throw new RangeError("crossLegExtensionSource must be USER or DEFAULT");

  // BDP v0.4 at the BOX's fixed Angle-Off; it refuses a Roll-in Bank input (it solves it).
  const bombDelivery = calculateBombDeliveryV0_4Full({ ...bombDeliveryInput, angleOffDeg: BOX_V2_COMPOSITION_MODEL_V0_3.fixedAngleOffDeg });
  const pub = bombDelivery.public;
  const baseDistanceNm = finite("public.baseDistanceNm", pub.baseDistanceNm);
  const rollInLongitudinalDistanceNm = finite("public.rollInDisplacement.forwardNm", pub.rollInDisplacement?.forwardNm);
  const patternTasKt = finite("diagnostics.initialTasKt", bombDelivery.diagnostics?.initialTasKt);

  // One set of onset rates per aircraft: the BDP Roll-in's (entered, else the BDP defaults).
  const onset = Object.fromEntries(ONSET_KEYS.map((key) => [
    key,
    bombDeliveryInput[key] === undefined || bombDeliveryInput[key] === null ? ROLL_IN_ONSET_DEFAULTS[key] : finite(key, bombDeliveryInput[key]),
  ]));
  const base = patternTurn("Base Turn", { tasKt: patternTasKt, loadFactorG: baseTurnG, onset });
  const cross = patternTurn("Crosswind Turn", { tasKt: patternTasKt, loadFactorG: crossTurnG, onset });

  // Rev1.5 OUT; its turn mirrors the Roll-in side of the pattern (OUT Turn radius = Roll-in Long. D).
  const out = calculateBoxOutManeuverV0_1Full(bombDelivery, { ...outOptions, outTurnRadiusNm: rollInLongitudinalDistanceNm });
  const outClosure = outClosureOf({ out, outTurnRadiusNm: rollInLongitudinalDistanceNm, cross, base });
  const minimumNm = outClosure.crossLegMinimumNm;
  // Rev1.5 raises a non-custom Crosswind Leg only when it is short by more than 0.5 m; a USER leg is kept.
  const autoExtended = crossLegExtensionSource === "DEFAULT" && crossLegExtensionNm * 1852 + 0.5 < minimumNm * 1852;
  const effectiveNm = autoExtended ? minimumNm : crossLegExtensionNm;
  const crossLeg = {
    source: crossLegExtensionSource,
    requestedNm: crossLegExtensionNm,
    minimumNm,
    effectiveNm,
    autoExtended,
    belowMinimum: effectiveNm * 1852 + 0.5 < minimumNm * 1852,
  };

  // The racetrack: Abeam Extension = Base Distance − Base Turn advance; Pattern Width = Roll-in Long. D + Crosswind
  // Leg + Crosswind Turn advance; Base Leg = Pattern Width − Base Turn transfer − Roll-in Long. D.
  const abeamExtensionDistanceNm = baseDistanceNm - base.advanceNm;
  const patternWidthNm = rollInLongitudinalDistanceNm + effectiveNm + cross.advanceNm;
  const legTimeSec = (distanceNm) => (distanceNm * 3600) / patternTasKt;
  const pattern = {
    baseDistanceNm,
    rollInLongitudinalDistanceNm,
    patternTasKt,
    patternSpeedKcas: pub.resolvedInitialSpeedKcas,
    abeamExtensionDistanceNm,
    // Abeam (owner 2026-10-23): the time flown on past the Target abeam (Target at 90°) before the Base Turn.
    abeamExtensionTimeSec: legTimeSec(abeamExtensionDistanceNm),
    crossLegExtensionNm: effectiveNm,
    crossLegTimeSec: legTimeSec(effectiveNm),
    patternWidthNm,
    baseLegNm: patternWidthNm - base.transferNm - rollInLongitudinalDistanceNm,
  };

  const result = {
    model: { ...BOX_V2_COMPOSITION_MODEL_V0_3 },
    fixedAngleOffDeg: BOX_V2_COMPOSITION_MODEL_V0_3.fixedAngleOffDeg,
    attackHeadingDeg: normalizeDeg(attackHeadingDeg),
    // RIGHT pattern: the Base Leg flies into OA1 at Attack Heading − 90° and the Roll-in turns right onto the attack run.
    baseLegHeadingDeg: normalizeDeg(attackHeadingDeg - 90),
    rollDirection: "RIGHT",
    bombDelivery,
    onset,
    turns: { base, cross },
    pattern,
    out,
    outClosure,
    crossLeg,
  };
  result.geometry = buildBoxPatternGeometryV0_3(result);
  const oa1 = result.geometry.stations.oa1;
  const rollInAltitudeFt = pub.resolvedInitialAltitudeMslFt;
  result.ded = {
    oa1: dedPoint(oa1, result.attackHeadingDeg, rollInAltitudeFt),
    oa2: dedPoint({ alongNm: oa1.alongNm, sideNm: oa1.sideNm - BOX_V2_COMPOSITION_MODEL_V0_3.dedOa2AheadNm }, result.attackHeadingDeg, rollInAltitudeFt),
  };
  return result;
}
