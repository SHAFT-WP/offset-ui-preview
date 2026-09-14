export const STANDARD_ATMOSPHERE_MODEL = Object.freeze({
  id: "fst-standard-atmosphere-v0.1",
  version: "0.1.0",
});

const FT_TO_M = 0.3048;
const SEA_LEVEL_TEMPERATURE_K = 288.15;
const SEA_LEVEL_PRESSURE_PA = 101325;
const TROPOSPHERE_LAPSE_K_PER_M = 0.0065;
const TROPOSPHERE_PRESSURE_EXPONENT = 5.2558798127;
const TROPOPAUSE_M = 11000;
const STRATOSPHERE_TEMPERATURE_K = 216.65;
const TROPOPAUSE_PRESSURE_PA = 22632.06;
const GRAVITY_MPS2 = 9.80665;
const AIR_GAS_CONSTANT = 287.05287;
const GAMMA = 1.4;
const MPS_TO_KT = 1.943844492;

function requireFinite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

export function standardAtmosphere(altitudeMslFt) {
  requireFinite("altitudeMslFt", altitudeMslFt);

  const altitudeM = Math.max(-1000, altitudeMslFt) * FT_TO_M;
  let temperatureK;
  let pressurePa;

  if (altitudeM <= TROPOPAUSE_M) {
    temperatureK = SEA_LEVEL_TEMPERATURE_K - TROPOSPHERE_LAPSE_K_PER_M * altitudeM;
    pressurePa =
      SEA_LEVEL_PRESSURE_PA *
      Math.pow(temperatureK / SEA_LEVEL_TEMPERATURE_K, TROPOSPHERE_PRESSURE_EXPONENT);
  } else {
    temperatureK = STRATOSPHERE_TEMPERATURE_K;
    pressurePa =
      TROPOPAUSE_PRESSURE_PA *
      Math.exp(
        (-GRAVITY_MPS2 * (altitudeM - TROPOPAUSE_M)) /
          (AIR_GAS_CONSTANT * temperatureK),
      );
  }

  const soundSpeedKt = Math.sqrt(GAMMA * AIR_GAS_CONSTANT * temperatureK) * MPS_TO_KT;

  return {
    model: { ...STANDARD_ATMOSPHERE_MODEL },
    altitudeMslFt,
    temperatureK,
    pressurePa,
    soundSpeedKt,
  };
}
