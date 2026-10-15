import { BOMB_DELIVERY_PLANNER_MODEL_V0_2, calculateBombDeliveryV0_2 } from "./bomb-delivery-planner-v0.2.mjs";
import { cachedCalculation } from "../../../common/calculation/calculation-cache-v0.1.mjs";
import { buildBombDeliveryVisualizationState } from "./visualization-state-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
import {
  ROLL_IN_LARGE_BANK_WARNING_DEG,
  ROLL_IN_LOW_ANGLE_BOUNDARY_DEG,
  ROLL_IN_ONSET_DEFAULTS,
  ROLL_IN_V0_2_MODEL,
  RollInSolveError,
  integrateRollInV0_2,
  isLevelTurnRollIn,
} from "./roll-in-v0.2.mjs";
import { FRAGMENT_MARGIN_MODES, SEM_FRAGMENT_MODEL_V0_1, calculateSemPathAndFragment, fragmentCylinder } from "./sem-fragment-v0.1.mjs";

// BDP v0.4 (owner 2026-10-15, SPEC §5.1): the v0.3 facade with the Roll-in v0.2 model — technique B with linear
// roll / G / roll-out rate onsets and a solved Roll-in Bank. Consumed by Offset only for now; the BDP page, BOX
// and Wheel stay on v0.3 until the owner extends it.
// 0.4.1 (2026-10-15, owner R3 / R5, SPEC §6.6): SEM path, SEM minimum altitude and the fragment cylinder check
// (display and check only; MINALT and NLT unchanged); input fragmentMarginAppliesTo (developer option).
export const BOMB_DELIVERY_PLANNER_MODEL_V0_4 = Object.freeze({
  id: "bomb-delivery-planner-v0.4-model-b-roll-in",
  version: "0.4.1",
  calculationSource: "bomb-delivery-planner-v0.2-sem-nlt",
  rollInModel: ROLL_IN_V0_2_MODEL,
  semFragmentModel: SEM_FRAGMENT_MODEL_V0_1,
  officialOracle: "Bomb Profile REV.1.9 · R_20260830 (legacy path only; the v0.4 Roll-in is a new model)",
});

const REQUIRED_CANONICAL_FIELDS = Object.freeze([
  "targetElevationMslFt",
  "releaseSpeedKcas",
  "diveAngleDeg",
  "initialSpeedValue",
  "initialSpeedMode",
  "initialAltitudeMslFt",
  "releaseAltitudeMslFt",
  "angleOffDeg",
  "rollInG",
]);

const ONSET_KEYS = Object.freeze(["rollInRollRateDegSec", "rollOutRollRateDegSec", "gOnsetRateGSec"]);

function requireCanonicalInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") throw new TypeError("rawInput must be an object");
  for (const field of REQUIRED_CANONICAL_FIELDS) {
    if (rawInput[field] === undefined || rawInput[field] === null) {
      throw new TypeError(`${field} is required by the BDP v0.4 canonical input contract`);
    }
  }
  if (rawInput.rollInBankAngleDeg !== undefined && rawInput.rollInBankAngleDeg !== null) {
    throw new TypeError("rollInBankAngleDeg is solved by BDP v0.4 (technique B); it is not an input");
  }
  const solveMode = rawInput.solveMode ?? "height";
  if (solveMode === "time" && rawInput.trackingTimeSec === undefined) {
    throw new TypeError("trackingTimeSec is required when solveMode is time");
  }
}

function onsetInput(rawInput) {
  const onset = {};
  for (const key of ONSET_KEYS) {
    const value = rawInput[key] ?? ROLL_IN_ONSET_DEFAULTS[key];
    if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) throw new RangeError(`${key} must be finite and > 0`);
    onset[key] = value;
  }
  return onset;
}

// Developer option (owner Q8, 2026-10-15): the Fragment Height Margin applies to the fragment radius too
// (default) or to the height only.
function fragmentMarginMode(value) {
  const mode = value ?? "HEIGHT_AND_RADIUS";
  if (!FRAGMENT_MARGIN_MODES.includes(mode)) throw new RangeError(`fragmentMarginAppliesTo must be one of ${FRAGMENT_MARGIN_MODES.join(", ")}`);
  return mode;
}

function canonicalInput(rawInput) {
  requireCanonicalInput(rawInput);
  if (rawInput.windSpeedMps !== undefined || rawInput.windSpeed !== undefined) {
    throw new TypeError("BDP v0.4 wind input uses windSpeedKt only; m/s wind aliases are not supported");
  }
  return {
    weaponId: rawInput.weaponId ?? "M82",
    fragmentHeightMarginPercent: rawInput.fragmentHeightMarginPercent ?? 20,
    fragmentMarginAppliesTo: fragmentMarginMode(rawInput.fragmentMarginAppliesTo),
    targetElevationMslFt: rawInput.targetElevationMslFt,
    releaseSpeedKcas: rawInput.releaseSpeedKcas,
    speedOvershootKcas: rawInput.speedOvershootKcas ?? 50,
    maneuverInitiationDelaySec: rawInput.maneuverInitiationDelaySec ?? 0,
    recoveryG: rawInput.recoveryG ?? 5,
    gOnsetTimeSec: rawInput.gOnsetTimeSec ?? 2,
    diveAngleDeg: rawInput.diveAngleDeg,
    releaseFpaDeg: rawInput.releaseFpaDeg ?? -rawInput.diveAngleDeg,
    windDirectionDeg: rawInput.windDirectionDeg ?? 0,
    windSpeedKt: rawInput.windSpeedKt ?? 0,
    initialSpeedValue: rawInput.initialSpeedValue,
    initialSpeedMode: rawInput.initialSpeedMode,
    initialAltitudeMslFt: rawInput.initialAltitudeMslFt,
    solveMode: rawInput.solveMode ?? "height",
    allowNegativeTrackingTime: rawInput.allowNegativeTrackingTime === true,
    trackingTimeSec: rawInput.trackingTimeSec ?? 0,
    ...(rawInput.trackingTimeStepSec === undefined || rawInput.trackingTimeStepSec === 1 ? {} : { trackingTimeStepSec: rawInput.trackingTimeStepSec }),
    releaseAltitudeMslFt: rawInput.releaseAltitudeMslFt,
    angleOffDeg: rawInput.angleOffDeg,
    rollInG: rawInput.rollInG,
    ...onsetInput(rawInput),
    ballisticModelId: rawInput.ballisticModelId,
  };
}

// One BDP call may fly the Roll-in several times (time mode: the Initial Altitude fixed point). Each flight
// starts its bank search at the previous one's bank; the sequence is fixed by the input, so the result is too.
function rollInV0_2ForOneCall() {
  let bankHintDeg = null;
  return {
    solvesBank: true,
    integrate(params, initialAltitudeMslFt) {
      const roll = integrateRollInV0_2({ ...params, bankHintDeg }, initialAltitudeMslFt);
      bankHintDeg = roll.rollInBankAngleDeg;
      return roll;
    },
  };
}

// Full-precision result for BE-to-BE composition; calculateBombDeliveryV0_4 truncates for FEs (docs/FE-BE-RULES.md).
export function calculateBombDeliveryV0_4Full(rawInput) {
  const input = canonicalInput(rawInput);
  return cachedCalculation("bdp-v0.4", { model: BOMB_DELIVERY_PLANNER_MODEL_V0_4, core: BOMB_DELIVERY_PLANNER_MODEL_V0_2, input }, () => solveCanonical(input));
}

// SEM path, SEM minimum altitude and fragment check (§6.6) from the effective Release. Below 10° Dive the BDP is
// MINALT-only (no SEM): the cylinder values are given, the path and the check are not.
function semFragment(input, calculation) {
  const KT_TO_FPS = 1.687809857;
  const windRad = (input.windDirectionDeg * Math.PI) / 180;
  const windFps = input.windSpeedKt * KT_TO_FPS;
  if (!calculation.diagnostics.nltSupported) {
    return { applicable: false, ...fragmentCylinder({ weapon: calculation.weapon, targetElevationMslFt: input.targetElevationMslFt, fragmentHeightMarginPercent: input.fragmentHeightMarginPercent, fragmentMarginAppliesTo: input.fragmentMarginAppliesTo }) };
  }
  return {
    applicable: true,
    ...calculateSemPathAndFragment({
      weapon: calculation.weapon,
      targetElevationMslFt: input.targetElevationMslFt,
      fragmentHeightMarginPercent: input.fragmentHeightMarginPercent,
      fragmentMarginAppliesTo: input.fragmentMarginAppliesTo,
      releaseAltitudeMslFt: calculation.public.effectiveReleaseAltitudeMslFt,
      releaseSpeedKcas: input.releaseSpeedKcas,
      speedOvershootKcas: input.speedOvershootKcas,
      diveAngleDeg: input.diveAngleDeg,
      recoveryG: input.recoveryG,
      gOnsetTimeSec: input.gOnsetTimeSec,
      bombTofSec: calculation.public.bombTofSec,
      bombRangeFt: calculation.public.bombRangeNm * 6076.11549,
      // The ballistics' wind components (attack axis, FROM direction; 0 = headwind).
      windAlongFps: -windFps * Math.cos(windRad),
      windCrossFps: -windFps * Math.sin(windRad),
    }),
  };
}

function solveCanonical(input) {
  const rollInOnset = Object.fromEntries(ONSET_KEYS.map((key) => [key, input[key]]));
  const calculation = calculateBombDeliveryV0_2({ ...input, rollInOnset }, { rollIn: rollInV0_2ForOneCall() });
  const state = buildBombDeliveryVisualizationState(calculation);
  const roll = calculation.rollIn;
  const sem = semFragment(input, calculation);
  const fragment = sem.applicable ? sem.fragment : (({ applicable, ...cylinder }) => cylinder)(sem);
  return {
    model: { ...BOMB_DELIVERY_PLANNER_MODEL_V0_4 },
    canonicalInputs: input,
    public: {
      ...calculation.public,
      rollInBankAngleDeg: roll.rollInBankAngleDeg,
      rollInPhaseTimesSec: { ...roll.phaseTimesSec },
      rollInBankAtRollOutStartDeg: roll.bankAtRollOutStartDeg,
      rollInMaxDiveDeg: roll.maxDiveDeg,
      rollInLargeBankWarning: roll.largeBankWarning,
      // §6.6: display and check only.
      semMinimumAltitudeMslFt: sem.applicable ? sem.semMinimumAltitudeMslFt : null,
      semMinimumAltitudeAglFt: sem.applicable ? sem.semMinimumAltitudeAglFt : null,
      semLevelOffTimeSec: sem.applicable ? sem.semLevelOffTimeSec : null,
      fragment,
      fragmentCheck: sem.applicable ? { applicable: true, ...sem.fragmentCheck } : { applicable: false },
    },
    local: calculation.local,
    safety: calculation.safety,
    states: state.stations,
    visualization: {
      ...calculation.visualization,
      rollInTrajectorySamples: roll.samples.map((sample, i) => ({
        ...calculation.visualization.rollInTrajectorySamples[i],
        timeSec: sample.t,
        bankDeg: sample.bankDeg,
        fpaDeg: sample.fpaDeg,
        loadFactor: sample.loadFactor,
        tasKt: sample.tasKt,
        phase: sample.phase,
      })),
      semanticState: state,
      // Time from Release; ground distance along the attack axis from the Release point.
      semPathSamples: sem.applicable ? sem.samples : [],
      fragmentEnvelope: sem.applicable ? sem.fragmentEnvelope : [],
    },
    diagnostics: {
      ...calculation.diagnostics,
      calculationModel: calculation.model,
      rollInModel: roll.model,
      rollInMode: roll.mode,
      rollInOnset: { ...roll.onset },
      semFragmentModel: { ...SEM_FRAGMENT_MODEL_V0_1 },
      semLevelOffDownRangeNm: sem.applicable ? sem.semLevelOffDownRangeNm : null,
      semRecoverySpeedKcas: sem.applicable ? sem.semRecoverySpeedKcas : null,
    },
  };
}

export function calculateBombDeliveryV0_4(rawInput) {
  return truncateBeOutput(calculateBombDeliveryV0_4Full(rawInput));
}

export {
  FRAGMENT_MARGIN_MODES,
  ROLL_IN_LARGE_BANK_WARNING_DEG,
  ROLL_IN_LOW_ANGLE_BOUNDARY_DEG,
  ROLL_IN_ONSET_DEFAULTS,
  RollInSolveError,
  isLevelTurnRollIn,
};
