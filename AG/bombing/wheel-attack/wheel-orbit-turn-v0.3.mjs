import { calculateRadiusDrivenLevelTurn } from "../../../common/maneuvers/turn-performance/radius-driven-level-turn-v0.1.mjs";

export const WHEEL_ORBIT_TURN_MODEL_V0_3 = Object.freeze({
  id: "fst-wheel-orbit-turn-v0.3",
  version: "0.3.0",
  status: "Work / Pure Calculation / Not Official",
});

const EPSILON_NM = 1e-12;

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function requirePositive(name, value) {
  requireFinite(name, value);
  if (!(value > 0)) throw new RangeError(`${name} must be > 0`);
  return value;
}

function resolveSpeedAltitude({ initialSpeedKcas, initialAltitudeMslFt, speedKcas, altitudeMslFt }) {
  requirePositive("initialSpeedKcas", initialSpeedKcas);
  requireFinite("initialAltitudeMslFt", initialAltitudeMslFt);
  const resolvedSpeedKcas = speedKcas ?? initialSpeedKcas;
  const resolvedAltitudeMslFt = altitudeMslFt ?? initialAltitudeMslFt;
  requirePositive("speedKcas", resolvedSpeedKcas);
  requireFinite("altitudeMslFt", resolvedAltitudeMslFt);
  return { speedKcas: resolvedSpeedKcas, altitudeMslFt: resolvedAltitudeMslFt };
}

export function calculateWheelTurnV0_3({
  initialSpeedKcas,
  initialAltitudeMslFt,
  minWheelRadiusNm,
  wheelRadiusNm = null,
  wheelSpeedKcas = null,
  wheelAltitudeMslFt = null,
}) {
  const minimumRadius = requirePositive("minWheelRadiusNm", minWheelRadiusNm);
  const selectedRadius = wheelRadiusNm ?? minimumRadius;
  requirePositive("wheelRadiusNm", selectedRadius);
  if (selectedRadius < minimumRadius - EPSILON_NM) {
    throw new RangeError("wheelRadiusNm must be >= minWheelRadiusNm");
  }

  const state = resolveSpeedAltitude({
    initialSpeedKcas,
    initialAltitudeMslFt,
    speedKcas: wheelSpeedKcas,
    altitudeMslFt: wheelAltitudeMslFt,
  });
  const turn = calculateRadiusDrivenLevelTurn({
    speedKcas: state.speedKcas,
    altitudeMslFt: state.altitudeMslFt,
    turnRadiusNm: selectedRadius,
  });

  return Object.freeze({
    model: Object.freeze({ ...WHEEL_ORBIT_TURN_MODEL_V0_3 }),
    role: "ATTACK_PATTERN",
    wheelRadiusMode: wheelRadiusNm === null ? "MIN_WHEEL_RADIUS" : "MANUAL",
    minWheelRadiusNm: minimumRadius,
    wheelSpeedKcas: state.speedKcas,
    wheelAltitudeMslFt: state.altitudeMslFt,
    wheelRadiusNm: selectedRadius,
    wheelBankAngleDeg: turn.bankAngleDeg,
    wheelTurn180TimeSec: turn.turn180TimeSec,
  });
}

export function calculateOrbitHoldingTurnV0_3({
  initialSpeedKcas,
  initialAltitudeMslFt,
  orbitRadiusNm,
  orbitSpeedKcas = null,
  orbitAltitudeMslFt = null,
}) {
  const selectedRadius = requirePositive("orbitRadiusNm", orbitRadiusNm);
  const state = resolveSpeedAltitude({
    initialSpeedKcas,
    initialAltitudeMslFt,
    speedKcas: orbitSpeedKcas,
    altitudeMslFt: orbitAltitudeMslFt,
  });
  const turn = calculateRadiusDrivenLevelTurn({
    speedKcas: state.speedKcas,
    altitudeMslFt: state.altitudeMslFt,
    turnRadiusNm: selectedRadius,
  });

  return Object.freeze({
    model: Object.freeze({ ...WHEEL_ORBIT_TURN_MODEL_V0_3 }),
    role: "WAITING_DECONFLICTION_TARGETING",
    includedInWheelBoxTopView: false,
    orbitSpeedKcas: state.speedKcas,
    orbitAltitudeMslFt: state.altitudeMslFt,
    orbitRadiusNm: selectedRadius,
    orbitBankAngleDeg: turn.bankAngleDeg,
    orbitTurn180TimeSec: turn.turn180TimeSec,
  });
}

export function calculateWheelAndOrbitTurnsV0_3(input) {
  return Object.freeze({
    wheel: calculateWheelTurnV0_3(input),
    orbit: calculateOrbitHoldingTurnV0_3(input),
  });
}

export const WHEEL_ORBIT_TURN_CONSTANTS_V0_3 = Object.freeze({ EPSILON_NM });
