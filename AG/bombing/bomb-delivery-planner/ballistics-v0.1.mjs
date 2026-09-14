const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;

export const ACTIVE_BALLISTIC_MODEL_ID = "bms-4.38-acmi-v1";

export const FREEFALCON_LEGACY_V1_CONFIG = Object.freeze({
  modelId: "freefalcon-legacy-v1",
  modelVersion: "1.0.0",
  timeStep: 0.01,
  maxSteps: 18002,
  sampleInterval: 0.1,
  dragConstantFps2: 140,
  lowDragScale: 0.2,
  highDragEffective: 0.9,
  highDragGravityFactor: 1.0,
  separationTwoGSeconds: 0.25,
  dragDelaySeconds: 2,
});

export const BMS_438_ACMI_V1_CONFIG = Object.freeze({
  modelId: "bms-4.38-acmi-v1",
  modelVersion: "1.0.0",
  timeStep: 0.01,
  maxSteps: 18002,
  sampleInterval: 0.1,
  dragConstantFps2: 160,
  lowDragScale: 0.2,
  highDragEffective: 0.88,
  highDragGravityFactor: 0.65,
  separationTwoGSeconds: 0,
  dragDelaySeconds: 1,
});

export const BMS_438_ACMI_VALIDATION = Object.freeze({
  recorder: "Falcon BMS 4.38.1 / Tacview ACMI 2.1",
  releaseCount: 7,
  weapons: "Mk-82 ×3 · Mk-82 AIR ×2 · Mk-84 ×2",
  medianRangeErrorFt: 4.58,
  medianTofErrorSeconds: 0.001,
});

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function simulateFixedHorizontalDrag({ params, weapon, releaseTasKt, config }) {
  function effectiveDrag(raw) {
    return raw < 1 ? raw * config.lowDragScale : config.highDragEffective;
  }

  const angle = (params.diveAngleDeg * Math.PI) / 180;
  const speed = releaseTasKt * KT_TO_FPS;
  const drag = effectiveDrag(weapon.drag);
  const highDrag = weapon.drag >= 1;
  const windAngle = (params.windDirectionDeg * Math.PI) / 180;
  const windFps = params.windSpeedMps * 3.280839895;
  const windAlong = -windFps * Math.cos(windAngle);
  const windCross = -windFps * Math.sin(windAngle);
  let state = {
    t: 0,
    x: 0,
    down: 0,
    vx: speed * Math.cos(angle),
    vd: speed * Math.sin(angle),
  };
  const samples = [{ xFt: 0, altitudeAglFt: params.releaseAglFt }];
  let nextSample = config.sampleInterval;

  for (let i = 0; i < config.maxSteps; i += 1) {
    const old = { ...state };
    const nextTime = state.t + config.timeStep;
    let newVx = state.vx;
    let newVd = state.vd;

    if (config.separationTwoGSeconds > 0 && nextTime <= config.separationTwoGSeconds + 1e-12) {
      newVd += 2 * G_FTPS2 * config.timeStep;
    } else if (nextTime <= config.dragDelaySeconds + 1e-12) {
      newVd += G_FTPS2 * config.timeStep;
    } else {
      newVx = Math.max(0, state.vx - drag * config.dragConstantFps2 * config.timeStep);
      newVd += G_FTPS2 * (highDrag ? config.highDragGravityFactor : 1) * config.timeStep;
    }

    state = {
      t: nextTime,
      x: state.x + (state.vx + windAlong) * config.timeStep,
      down: state.down + state.vd * config.timeStep,
      vx: newVx,
      vd: newVd,
    };

    if (state.down >= params.releaseAglFt) {
      const delta = state.down - old.down;
      let fraction = delta === 0 ? 1 : (params.releaseAglFt - old.down) / delta;
      fraction = clamp(fraction, 0, 1);
      const impactX = old.x + (state.x - old.x) * fraction;
      const impactT = old.t + (state.t - old.t) * fraction;
      samples.push({ xFt: impactX, altitudeAglFt: 0 });
      const levelDelivery = Math.abs(params.diveAngleDeg) < 1e-9;
      const losRangeFt = levelDelivery ? null : params.releaseAglFt / Math.tan(angle);
      return {
        modelId: config.modelId,
        modelVersion: config.modelVersion,
        bombRangeFt: impactX,
        bombTofSec: impactT,
        losRangeFt,
        aimOffDistanceFt: levelDelivery ? null : losRangeFt - impactX,
        windAlongFps: windAlong,
        windCrossFps: windCross,
        windDriftFt: windCross * impactT,
        samples,
      };
    }

    if (state.t >= nextSample) {
      samples.push({ xFt: state.x, altitudeAglFt: Math.max(0, params.releaseAglFt - state.down) });
      nextSample += config.sampleInterval;
    }
  }

  throw new Error("Bomb impact was not reached within the configured integration limit");
}

export function calculateBombTrajectory({ params, weapon, releaseTasKt, modelId = ACTIVE_BALLISTIC_MODEL_ID }) {
  const config = modelId === "freefalcon-legacy-v1" ? FREEFALCON_LEGACY_V1_CONFIG : BMS_438_ACMI_V1_CONFIG;
  if (config.modelId !== modelId) throw new RangeError(`Unsupported ballistic model: ${modelId}`);
  return simulateFixedHorizontalDrag({ params, weapon, releaseTasKt, config });
}
