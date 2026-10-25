import { casToTas } from "../../airspeed/airspeed-v0.1.mjs";
import {
  bankAngleDegFromTasAndRadius,
  turnRateDegSecFromTasAndBank,
  turnTimeSecFromRate,
} from "./turn-performance-v0.1.mjs";

export const RADIUS_DRIVEN_LEVEL_TURN_MODEL = Object.freeze({
  id: "fst-radius-driven-level-turn-v0.1",
  version: "0.1.0",
});

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requirePositive(name, value) {
  requireFinite(name, value);
  if (!(value > 0)) throw new RangeError(`${name} must be > 0`);
}

export function calculateRadiusDrivenLevelTurn({
  speedKcas,
  altitudeMslFt,
  turnRadiusNm,
}) {
  requirePositive("speedKcas", speedKcas);
  requireFinite("altitudeMslFt", altitudeMslFt);
  requirePositive("turnRadiusNm", turnRadiusNm);

  const tasKt = casToTas(speedKcas, altitudeMslFt);
  const bankAngleDeg = bankAngleDegFromTasAndRadius(tasKt, turnRadiusNm);
  const turnRateDegSec = turnRateDegSecFromTasAndBank(tasKt, bankAngleDeg);
  const turn180TimeSec = turnTimeSecFromRate(turnRateDegSec, 180);

  return {
    model: { ...RADIUS_DRIVEN_LEVEL_TURN_MODEL },
    bankAngleDeg,
    turn180TimeSec,
  };
}
