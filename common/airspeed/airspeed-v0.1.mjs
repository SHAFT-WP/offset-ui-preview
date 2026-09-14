import { standardAtmosphere } from "../atmosphere/standard-atmosphere-v0.1.mjs";

export const AIRSPEED_MODEL = Object.freeze({
  id: "fst-compressible-airspeed-v0.1",
  version: "0.1.0",
});

const SEA_LEVEL_PRESSURE_PA = 101325;
const SEA_LEVEL_SOUND_SPEED_KT = 661.4788;

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function requireNonNegative(name, value) {
  requireFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be >= 0`);
}

export function casToTas(casKt, altitudeMslFt) {
  requireNonNegative("casKt", casKt);
  requireFinite("altitudeMslFt", altitudeMslFt);
  const atmosphere = standardAtmosphere(altitudeMslFt);
  const seaLevelMach = casKt / SEA_LEVEL_SOUND_SPEED_KT;
  const impactPressure =
    SEA_LEVEL_PRESSURE_PA * (Math.pow(1 + 0.2 * seaLevelMach * seaLevelMach, 3.5) - 1);
  const mach = Math.sqrt(
    5 * (Math.pow(impactPressure / atmosphere.pressurePa + 1, 2 / 7) - 1),
  );
  return mach * atmosphere.soundSpeedKt;
}

export function tasToCas(tasKt, altitudeMslFt) {
  requireNonNegative("tasKt", tasKt);
  requireFinite("altitudeMslFt", altitudeMslFt);
  const atmosphere = standardAtmosphere(altitudeMslFt);
  const mach = tasKt / atmosphere.soundSpeedKt;
  const impactPressure =
    atmosphere.pressurePa * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  const seaLevelMach = Math.sqrt(
    5 * (Math.pow(impactPressure / SEA_LEVEL_PRESSURE_PA + 1, 2 / 7) - 1),
  );
  return seaLevelMach * SEA_LEVEL_SOUND_SPEED_KT;
}

export function machToTas(mach, altitudeMslFt) {
  requireNonNegative("mach", mach);
  requireFinite("altitudeMslFt", altitudeMslFt);
  return mach * standardAtmosphere(altitudeMslFt).soundSpeedKt;
}

export function tasToMach(tasKt, altitudeMslFt) {
  requireNonNegative("tasKt", tasKt);
  requireFinite("altitudeMslFt", altitudeMslFt);
  return tasKt / standardAtmosphere(altitudeMslFt).soundSpeedKt;
}
