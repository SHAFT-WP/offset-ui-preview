import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, ROLL_IN_ONSET_DEFAULTS, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { ONSET_LEVEL_TURN_MODEL_V0_1, calculateOnsetLevelTurn } from "../../../common/maneuvers/turn-performance/onset-level-turn-v0.1.mjs";
import { BOX_OUT_MANEUVER_MODEL_V0_2, calculateBoxOutManeuverV0_2Full } from "./box-out-maneuver-v0.2.mjs";
import { buildBoxPatternGeometryV0_4 } from "./box-pattern-geometry-v0.4.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// BOX v0.4 composition (owner 2026-10-25): BOX v0.3 with the MIL OUT (box-out-maneuver-v0.2). BOX keeps its own BE:
// the 90° Angle-Off, the racetrack, Abeam, OUT and Crosswind Leg policy. It shares the calculations that are the same:
// - BDP v0.4 (Roll-in model B; Roll-in Bank is the BDP's result, not a BOX input);
// - the Common onset level turn for the Crosswind and Base Turns, with the aircraft's one set of onset rates, the
//   same rates its BDP Roll-in flies (owner 2026-10-25: option A, the Offset Turn's rule);
// - the pattern flown at the BDP's Initial TAS at full precision.
// What v0.4 changes (owner 2026-10-25):
// - OUT is flown at MIL on the PW-229 research model (unofficial adoption): Climb Pitch 25° until 350 KCAS, then the
//   OUT Turn at 90° bank / 1.5 G that goes level when the flight path reaches level; the speed holds at 300 KCAS.
//   The OUT Turn's own advance / transfer replace v0.3's Roll-in mirror arc (radius = Roll-in Long. D).
// - The Crosswind Leg is filled in automatically: the distance from the OUT Turn end to the Roll-in Altitude and
//   Roll-in speed at MIL, never below the geometry minimum. A typed leg replaces it (USER); below the geometry
//   minimum it is invalid, below the energy leg it is a warning.
// It returns the BDP result it used, the turns, the OUT, the route with its validation, and the DED OA1 / OA2.
// BOX v0.3 (box-v2-composition-v0.3.mjs) stays as it was for its entrypoint (box-be-v0.3).
export const BOX_V2_COMPOSITION_MODEL_V0_4 = Object.freeze({
  id: "box-v2-composition-v0.4",
  version: "0.4.0",
  status: "Work / Pure Composition / Not Official",
  bombDeliverySource: BOMB_DELIVERY_PLANNER_MODEL_V0_4.id,
  turnSource: ONSET_LEVEL_TURN_MODEL_V0_1.id,
  outSource: `${BOX_OUT_MANEUVER_MODEL_V0_2.id} (MIL OUT, ${BOX_OUT_MANEUVER_MODEL_V0_2.performanceModel}, unofficial adoption)`,
  routeSource: "box-pattern-geometry-v0.4 (stations, paths, validation)",
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
  const turn = calculateOnsetLevelTurn({ tasKt, loadFactorG, headingChangeDeg: BOX_V2_COMPOSITION_MODEL_V0_4.turnHeadingChangeDeg, ...onset });
  return { ...turn, advanceNm: turn.end.forwardNm, transferNm: turn.end.turnSideNm };
}

// OUT closure (v0.3's rules on the MIL OUT Turn's advance / transfer):
//   OUT Turn Start     = max(OUT distance, Crosswind Turn transfer − OUT Turn advance)   (the Downwind starts at or
//                        past the Target abeam line; an extension is flown straight before the OUT Turn)
//   Crosswind Leg min  = max(0, Base Turn transfer + Roll-in Long. D − OUT Turn transfer − Crosswind Turn advance)
//                        (Base Leg ≥ 0)
//   Crosswind Leg auto = max(Crosswind Leg min, energy leg)   (the Roll-in Altitude and speed are reached before the
//                        Crosswind Turn)
function outClosureOf({ out, rollInLongitudinalDistanceNm, cross, base }) {
  const outTurnAdvanceNm = out.turn.advanceNm;
  const outTurnTransferNm = out.turn.transferNm;
  const outTurnStartMinimumNm = Math.max(0, cross.transferNm - outTurnAdvanceNm);
  const outAutoExtensionNm = Math.max(0, outTurnStartMinimumNm - out.outDistanceNm);
  const effectiveOutNm = out.outDistanceNm + outAutoExtensionNm;
  const crossLegMinimumNm = Math.max(0, base.transferNm + rollInLongitudinalDistanceNm - outTurnTransferNm - cross.advanceNm);
  const crossLegEnergyNm = out.energyLeg.distanceNm;
  return {
    outTurnAdvanceNm,
    outTurnTransferNm,
    outTurnStartMinimumNm,
    outAutoExtensionNm,
    effectiveOutNm,
    crossLegMinimumNm,
    crossLegEnergyNm,
    crossLegAutoNm: Math.max(crossLegMinimumNm, crossLegEnergyNm),
  };
}

// Crosswind Leg time: the energy leg's own time along its length, then the pattern TAS past its end.
function crossLegTimeSec(lengthNm, energyLeg, patternTasKt) {
  const samples = energyLeg.samples;
  if (lengthNm > energyLeg.distanceNm) return energyLeg.timeSec + ((lengthNm - energyLeg.distanceNm) * 3600) / patternTasKt;
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1];
    const b = samples[index];
    if (lengthNm <= b.distanceNm) return a.timeSec + ((b.timeSec - a.timeSec) * (lengthNm - a.distanceNm)) / (b.distanceNm - a.distanceNm);
  }
  return energyLeg.timeSec;
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
// calculateBoxPatternV0_4Full, which keeps full precision.
export function calculateBoxPatternV0_4(input) {
  return truncateBeOutput(calculateBoxPatternV0_4Full(input));
}

export function calculateBoxPatternV0_4Full({
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
  const bombDelivery = calculateBombDeliveryV0_4Full({ ...bombDeliveryInput, angleOffDeg: BOX_V2_COMPOSITION_MODEL_V0_4.fixedAngleOffDeg });
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

  // MIL OUT: Recovery, Climb, OUT Turn and the energy leg to the Roll-in Altitude and speed.
  const out = calculateBoxOutManeuverV0_2Full(bombDelivery, outOptions);
  const outClosure = outClosureOf({ out, rollInLongitudinalDistanceNm, cross, base });
  // DEFAULT: the leg filled in automatically; USER: the typed leg, kept.
  const effectiveNm = crossLegExtensionSource === "DEFAULT" ? outClosure.crossLegAutoNm : crossLegExtensionNm;
  const crossLeg = {
    source: crossLegExtensionSource,
    // The typed length (USER); a DEFAULT leg does not read the value it is given.
    requestedNm: crossLegExtensionSource === "USER" ? crossLegExtensionNm : null,
    minimumNm: outClosure.crossLegMinimumNm,
    energyNm: outClosure.crossLegEnergyNm,
    autoNm: outClosure.crossLegAutoNm,
    effectiveNm,
    belowMinimum: effectiveNm * 1852 + 0.5 < outClosure.crossLegMinimumNm * 1852,
    // The Crosswind Turn starts before the Roll-in Altitude and speed are reached.
    shortOfRollInEnergy: effectiveNm * 1852 + 0.5 < outClosure.crossLegEnergyNm * 1852,
  };

  // The racetrack: Abeam Extension = Base Distance − Base Turn advance; Pattern Width = OUT Turn transfer + Crosswind
  // Leg + Crosswind Turn advance; Base Leg = Pattern Width − Base Turn transfer − Roll-in Long. D.
  const abeamExtensionDistanceNm = baseDistanceNm - base.advanceNm;
  const patternWidthNm = outClosure.outTurnTransferNm + effectiveNm + cross.advanceNm;
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
    crossLegTimeSec: crossLegTimeSec(effectiveNm, out.energyLeg, patternTasKt),
    patternWidthNm,
    baseLegNm: patternWidthNm - base.transferNm - rollInLongitudinalDistanceNm,
  };

  const result = {
    model: { ...BOX_V2_COMPOSITION_MODEL_V0_4 },
    fixedAngleOffDeg: BOX_V2_COMPOSITION_MODEL_V0_4.fixedAngleOffDeg,
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
  result.geometry = buildBoxPatternGeometryV0_4(result);
  const oa1 = result.geometry.stations.oa1;
  const rollInAltitudeFt = pub.resolvedInitialAltitudeMslFt;
  result.ded = {
    oa1: dedPoint(oa1, result.attackHeadingDeg, rollInAltitudeFt),
    oa2: dedPoint({ alongNm: oa1.alongNm, sideNm: oa1.sideNm - BOX_V2_COMPOSITION_MODEL_V0_4.dedOa2AheadNm }, result.attackHeadingDeg, rollInAltitudeFt),
  };
  return result;
}
