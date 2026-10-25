import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// BOX OUT Maneuver v0.1 — the BOX Rev1.5 OUT (Recovery + CLIMB) ported to a pure V2 BE module
// (user decision 2026-09-29: "박스는 1.5봐봐라" → Rev1.5 OUT is used until OUT moves to the V2
// CLIMB SEM / CSEM boundary; AG/bombing/box-pattern/SPEC.md "OUT Maneuver — Rev1.5 port").
// Inputs, units, defaults, constants and equations follow Rev1.5 `calcOut` / the OUT panel
// (bombing/box-pattern/box-pattern.html); the values come from the V2 BDP result instead of the
// embedded profile. One deliberate change (user decision 2026-09-29): the Level-off Altitude subtracts
// the pull-out altitude loss R·(1 − cosθ), where Rev1.5 added it.
// 0.1.1 (2026-09-29): Level-off sign fix, Rev1.5 name `Climb Pitch`, the Rev1.5 `recalc` OUT closure
// (calculateBoxOutClosureV0_1) and the recovery terms in the output.

export const BOX_OUT_MANEUVER_MODEL_V0_1 = Object.freeze({
  id: "box-out-maneuver-v0.1",
  version: "0.1.1",
  status: "Work / Rev1.5-equivalent OUT (Level-off sign corrected) / Not Official",
  legacyOracle: "BOX Rev1.5 · R_20260831 calcOut / recalc",
});

const FT_PER_NM = 6076.11549;
const M_PER_NM = 1852;
const KT_TO_FPS = 1.687809857;
const KT_TO_MPS = 0.514444;
const G_FPS2 = 32.174;
const G_MPS2 = 9.80665;
const OUT_MODES = Object.freeze(["CLIMB", "LEVEL"]);

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// Rev1.5 OUT inputs (panel `OUT Maneuver`) and `syncOutDefaults`:
//   OUT Mode        CLIMB | LEVEL                     default CLIMB
//   OUT Speed       kcas                              default Release Speed
//   Recovery G      G                                 default 5.0
//   Climb Pitch     deg                               default max(0, Dive Angle − 10)
//   Climb G         G                                 default Recovery G / 2
//   Level-off Speed kcas                              default Initial KCAS
// An override replaces its default; Climb G's default follows the (possibly overridden) Recovery G.
export function resolveBoxOutInputsV0_1(bombDeliveryResult, options = {}) {
  const input = bombDeliveryResult.canonicalInputs;
  const pub = bombDeliveryResult.public;
  const mode = options.outMode ?? "CLIMB";
  if (!OUT_MODES.includes(mode)) throw new RangeError("outMode must be CLIMB or LEVEL");
  const recoveryG = finite("outRecoveryG", options.outRecoveryG ?? 5);
  return {
    mode,
    outSpeedKcas: finite("outSpeedKcas", options.outSpeedKcas ?? input.releaseSpeedKcas),
    recoveryG,
    climbPitchDeg: finite("outClimbPitchDeg", options.outClimbPitchDeg ?? Math.max(0, input.diveAngleDeg - 10)),
    climbG: finite("outClimbG", options.outClimbG ?? recoveryG / 2),
    levelOffSpeedKcas: finite("outLevelOffSpeedKcas", options.outLevelOffSpeedKcas ?? pub.resolvedInitialSpeedKcas),
  };
}

export function calculateBoxOutManeuverV0_1(bombDeliveryResult, options = {}) {
  return truncateBeOutput(calculateBoxOutManeuverV0_1Full(bombDeliveryResult, options));
}

// options: the OUT overrides of resolveBoxOutInputsV0_1, plus outTurnRadiusNm (the BOX OUT Turn
// radius, which Rev1.5 takes from the Roll-in side of the pattern) for the OUT Turn bank.
// Rev1.5 lower bounds are kept as Rev1.5 applies them: OUT / Level-off Speed ≥ 1 kcas, Recovery G and
// Climb G ≥ 1.01 G, Climb Pitch ≥ 0°.
export function calculateBoxOutManeuverV0_1Full(bombDeliveryResult, options = {}) {
  if (!bombDeliveryResult?.public || !bombDeliveryResult?.canonicalInputs) {
    throw new TypeError("bombDeliveryResult must be a Bomb Delivery Planner v0.3 result");
  }
  const input = bombDeliveryResult.canonicalInputs;
  const pub = bombDeliveryResult.public;
  const out = resolveBoxOutInputsV0_1(bombDeliveryResult, options);
  // θ: the Dive Angle in radians (the release flight-path angle below the horizon).
  const theta = (finite("diveAngleDeg", input.diveAngleDeg) * Math.PI) / 180;
  const releaseMslFt = finite("effectiveReleaseAltitudeMslFt", pub.effectiveReleaseAltitudeMslFt);
  const initialMslFt = finite("resolvedInitialAltitudeMslFt", pub.resolvedInitialAltitudeMslFt);

  // Recovery: Maneuver Initiation Delay straight, then a constant-G pull to level at Recovery G.
  // V in ft/s (TAS kt × 1.687809857), g = 32.174 ft/s², so the pull radius R is in ft.
  const outTasKt = casToTas(Math.max(1, out.outSpeedKcas), releaseMslFt);
  const speedFps = outTasKt * KT_TO_FPS;
  const delaySec = Math.max(0, finite("maneuverInitiationDelaySec", input.maneuverInitiationDelaySec));
  const recoveryLoadFactor = Math.max(1.01, out.recoveryG);
  const delayHorizontalFt = speedFps * Math.cos(theta) * delaySec;
  const delayAltitudeLossFt = speedFps * Math.sin(theta) * delaySec;
  const recoveryRadiusFt = (speedFps * speedFps) / (G_FPS2 * Math.max(0.01, recoveryLoadFactor - Math.cos(theta)));
  const pullHorizontalFt = recoveryRadiusFt * Math.sin(theta);
  const pullAltitudeLossFt = recoveryRadiusFt * (1 - Math.cos(theta));
  // Level-off Altitude = Release Altitude − delay altitude loss − R·(1 − cosθ) (user decision
  // 2026-09-29; Rev1.5 added the pull term). Recovery Distance does not use it.
  const levelOffAltitudeMslFt = releaseMslFt - delayAltitudeLossFt - pullAltitudeLossFt;
  const recoveryDistanceFt = delayHorizontalFt + pullHorizontalFt;

  // CLIMB: pitch-up arc to the Climb Pitch at Climb G, then a straight climb from the Level-off
  // Altitude to the Initial altitude.
  const errors = [];
  let climbDistanceFt = 0;
  let climbArcHorizontalFt = 0;
  let climbArcGainFt = 0;
  if (out.mode === "CLIMB") {
    const pitch = (Math.max(0, out.climbPitchDeg) * Math.PI) / 180;
    if (initialMslFt > levelOffAltitudeMslFt + 1 && pitch <= 1e-9) {
      errors.push("CLIMB mode cannot reach the Initial altitude with Climb Pitch 0°.");
    } else if (initialMslFt > levelOffAltitudeMslFt + 1) {
      const endTasKt = casToTas(Math.max(1, out.levelOffSpeedKcas), initialMslFt);
      const averageFps = ((outTasKt + endTasKt) / 2) * KT_TO_FPS;
      const climbLoadFactor = Math.max(1.01, out.climbG);
      const arcRadiusFt = (averageFps * averageFps) / (G_FPS2 * Math.max(0.01, climbLoadFactor - Math.cos(pitch / 2)));
      climbArcHorizontalFt = arcRadiusFt * Math.sin(pitch);
      climbArcGainFt = arcRadiusFt * (1 - Math.cos(pitch));
      const remainingFt = Math.max(0, initialMslFt - (levelOffAltitudeMslFt + climbArcGainFt));
      climbDistanceFt = climbArcHorizontalFt + remainingFt / Math.tan(pitch);
    }
  }

  // OUT Turn bank for the given OUT Turn radius at the mean OUT / Level-off horizontal speed.
  let outTurnBankDeg = null;
  if (Number.isFinite(options.outTurnRadiusNm)) {
    const pitchRad = ((out.mode === "CLIMB" ? Math.max(0, out.climbPitchDeg) : 0) * Math.PI) / 180;
    const endTasKt = casToTas(Math.max(1, out.levelOffSpeedKcas), initialMslFt);
    const horizontalMps = ((outTasKt + endTasKt) / 2) * KT_TO_MPS * Math.cos(pitchRad);
    const radiusM = Math.max(1, options.outTurnRadiusNm * M_PER_NM);
    outTurnBankDeg = (Math.atan2(horizontalMps * horizontalMps, G_MPS2 * radiusM) * 180) / Math.PI;
  }

  const recoveryDistanceNm = recoveryDistanceFt / FT_PER_NM;
  const releaseToTargetNm = Math.max(0, finite("bombRangeNm", pub.bombRangeNm));
  const recoveryEndTargetNm = recoveryDistanceNm - releaseToTargetNm;
  const climbDistanceNm = climbDistanceFt / FT_PER_NM;
  return {
    model: { ...BOX_OUT_MANEUVER_MODEL_V0_1 },
    inputs: out,
    outTasKt,
    recovery: {
      radiusFt: recoveryRadiusFt,
      delayAltitudeLossFt,
      pullAltitudeLossFt,
      delayHorizontalFt,
      pullHorizontalFt,
    },
    climb: { arcHorizontalFt: climbArcHorizontalFt, arcGainFt: climbArcGainFt },
    recoveryDistanceNm,
    levelOffAltitudeMslFt,
    climbDistanceNm,
    releaseToTargetNm,
    recoveryEndTargetNm,
    // OUT Turn Start before the geometry minimum (Rev1.5 `baseOut`): past the Target, never before it.
    outDistanceNm: Math.max(0, recoveryEndTargetNm),
    outTurnBankDeg,
    totalHorizontalNm: recoveryDistanceNm + climbDistanceNm,
    validation: { valid: errors.length === 0, errors },
  };
}

// Rev1.5 `recalc` OUT closure and `getCrossMin`:
//   OUT Turn Start      = max(OUT distance, Crosswind Turn Radius − OUT Turn Radius)   (auto extension)
//   straight climb      = max(0, OUT Turn Start − (Recovery Distance − Bomb Range))
//   Crosswind climb min = CLIMB ? max(0, Climb Distance − straight climb − π·OUT Turn Radius / 2) : 0
//   Crosswind Leg min   = max(0, Base Turn Radius − Crosswind Turn Radius, Crosswind climb min)
// With Climb Pitch 0° and a climb still needed, Climb Distance is 0 (an OUT error), so no Crosswind
// Leg length is added for it.
export function calculateBoxOutClosureV0_1({ out, outTurnRadiusNm, crossTurnRadiusNm, baseTurnRadiusNm }) {
  finite("outTurnRadiusNm", outTurnRadiusNm);
  finite("crossTurnRadiusNm", crossTurnRadiusNm);
  finite("baseTurnRadiusNm", baseTurnRadiusNm);
  const outTurnStartMinimumNm = Math.max(0, crossTurnRadiusNm - outTurnRadiusNm);
  const outAutoExtensionNm = Math.max(0, outTurnStartMinimumNm - out.outDistanceNm);
  const effectiveOutNm = out.outDistanceNm + outAutoExtensionNm;
  const straightClimbBeforeTurnNm = Math.max(0, effectiveOutNm - out.recoveryEndTargetNm);
  const remainingClimbNm = Math.max(0, out.climbDistanceNm - straightClimbBeforeTurnNm);
  const climbCrossMinNm = out.inputs.mode === "CLIMB" ? Math.max(0, remainingClimbNm - (Math.PI * outTurnRadiusNm) / 2) : 0;
  const turnCrossMinNm = Math.max(0, baseTurnRadiusNm - crossTurnRadiusNm);
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
