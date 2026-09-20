import { calculateBombDeliveryV0_2 } from "./bomb-delivery-planner-v0.2.mjs";
import { buildBombDeliveryVisualizationState } from "./visualization-state-v0.1.mjs";

export const BOMB_DELIVERY_PLANNER_MODEL_V0_3 = Object.freeze({
  id: "bomb-delivery-planner-v0.3-js-facade",
  version: "0.3.7",
  calculationSource: "bomb-delivery-planner-v0.2-sem-nlt",
  officialOracle: "Bomb Profile REV.1.9 · R_20260830",
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
  "rollInBankAngleDeg",
  "rollInG",
]);

function requireCanonicalInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object") throw new TypeError("rawInput must be an object");
  for (const field of REQUIRED_CANONICAL_FIELDS) {
    if (rawInput[field] === undefined || rawInput[field] === null) {
      throw new TypeError(`${field} is required by the BDP v0.3 canonical input contract`);
    }
  }
  const solveMode = rawInput.solveMode ?? "height";
  if (solveMode === "time" && rawInput.trackingTimeSec === undefined) {
    throw new TypeError("trackingTimeSec is required when solveMode is time");
  }
}

function canonicalInput(rawInput) {
  requireCanonicalInput(rawInput);
  if (rawInput.windSpeedMps !== undefined || rawInput.windSpeed !== undefined) {
    throw new TypeError("BDP v0.3 wind input uses windSpeedKt only; m/s wind aliases are not supported");
  }
  const windSpeedKt = rawInput.windSpeedKt ?? 0;
  return {
    weaponId: rawInput.weaponId ?? "M82",
    fragmentHeightMarginPercent: rawInput.fragmentHeightMarginPercent ?? 20,
    targetElevationMslFt: rawInput.targetElevationMslFt,
    releaseSpeedKcas: rawInput.releaseSpeedKcas,
    speedOvershootKcas: rawInput.speedOvershootKcas ?? 50,
    maneuverInitiationDelaySec: rawInput.maneuverInitiationDelaySec ?? 0,
    recoveryG: rawInput.recoveryG ?? 5,
    gOnsetTimeSec: rawInput.gOnsetTimeSec ?? 2,
    diveAngleDeg: rawInput.diveAngleDeg,
    releaseFpaDeg: rawInput.releaseFpaDeg ?? -rawInput.diveAngleDeg,
    windDirectionDeg: rawInput.windDirectionDeg ?? 0,
    windSpeedKt,
    initialSpeedValue: rawInput.initialSpeedValue,
    initialSpeedMode: rawInput.initialSpeedMode,
    initialAltitudeMslFt: rawInput.initialAltitudeMslFt,
    solveMode: rawInput.solveMode ?? "height",
    trackingTimeSec: rawInput.trackingTimeSec ?? 0,
    releaseAltitudeMslFt: rawInput.releaseAltitudeMslFt,
    angleOffDeg: rawInput.angleOffDeg,
    rollInBankAngleDeg: rawInput.rollInBankAngleDeg,
    rollInG: rawInput.rollInG,
    ballisticModelId: rawInput.ballisticModelId,
  };
}

export function calculateBombDeliveryV0_3(rawInput) {
  const input = canonicalInput(rawInput);
  const calculation = calculateBombDeliveryV0_2(input);
  const state = buildBombDeliveryVisualizationState(calculation);

  return {
    model: { ...BOMB_DELIVERY_PLANNER_MODEL_V0_3 },
    canonicalInputs: input,
    public: calculation.public,
    local: calculation.local,
    safety: calculation.safety,
    states: state.stations,
    visualization: {
      ...calculation.visualization,
      semanticState: state,
    },
    diagnostics: {
      ...calculation.diagnostics,
      calculationModel: calculation.model,
    },
  };
}

export const calculateBombDelivery = calculateBombDeliveryV0_3;
