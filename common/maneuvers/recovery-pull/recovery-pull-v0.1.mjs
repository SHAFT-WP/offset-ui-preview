import { casToTas, tasToCas } from "../../airspeed/airspeed-v0.1.mjs";
import { linearGOnset } from "../g-onset/g-onset-v0.1.mjs";

export const RECOVERY_PULL_MODEL = Object.freeze({
  id: "fst-wings-level-recovery-pull-v0.1",
  version: "0.1.0",
  integrationStepSec: 0.01,
});

const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const FT_PER_NM = 6076.11549;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
}

function validate(input) {
  for (const [name, value] of Object.entries(input)) finite(name, value);
  if (!(input.startSpeedKcas > 0)) throw new RangeError("startSpeedKcas must be > 0");
  if (!(input.startFpaDeg > -90 && input.startFpaDeg < 90)) throw new RangeError("startFpaDeg must be between -90 and 90");
  if (!(input.targetFpaDeg > input.startFpaDeg && input.targetFpaDeg < 90)) throw new RangeError("targetFpaDeg must be above startFpaDeg and below 90");
  if (!(input.recoveryG > 1 && input.recoveryG <= 9)) throw new RangeError("recoveryG must be > 1 and <= 9");
  if (!(input.gOnsetTimeSec > 0)) throw new RangeError("gOnsetTimeSec must be > 0");
  if (!(input.maneuverInitiationDelaySec >= 0)) throw new RangeError("maneuverInitiationDelaySec must be >= 0");
}

function integrateStep(state, loadFactorG, dt) {
  const velocity = state.velocityFps;
  const fpa = state.fpaRad;
  const speedRate = -G_FTPS2 * Math.sin(fpa);
  const fpaRate = (G_FTPS2 / velocity) * (loadFactorG - Math.cos(fpa));
  const midVelocity = Math.max(80, velocity + (speedRate * dt) / 2);
  const midFpa = fpa + (fpaRate * dt) / 2;
  const midSpeedRate = -G_FTPS2 * Math.sin(midFpa);
  const midFpaRate = (G_FTPS2 / midVelocity) * (loadFactorG - Math.cos(midFpa));

  state.velocityFps = Math.max(80, velocity + midSpeedRate * dt);
  state.fpaRad = fpa + midFpaRate * dt;
  state.horizontalDistanceFt += midVelocity * Math.cos(midFpa) * dt;
  state.altitudeMslFt += midVelocity * Math.sin(midFpa) * dt;
  state.pathDistanceFt += midVelocity * dt;
  state.elapsedTimeSec += dt;
  state.minAltitudeMslFt = Math.min(state.minAltitudeMslFt, state.altitudeMslFt);
}

// Opt-in time samples (2026-10-13, Offset SEM & Rejoin): the integrated state at the start, after
// the integration step that reaches each multiple of `intervalSec`, and at the termination. Recording
// never changes the integration; without `sampleIntervalSec` the result is exactly as before.
export function createRecoveryPullSampler(intervalSec, { firstSampleSec = 0 } = {}) {
  const samples = [];
  let next = firstSampleSec;
  const point = (state, loadFactorG) => ({
    elapsedTimeSec: state.elapsedTimeSec,
    horizontalDistanceFt: state.horizontalDistanceFt,
    pathDistanceFt: state.pathDistanceFt,
    altitudeMslFt: state.altitudeMslFt,
    fpaDeg: state.fpaRad * RAD_TO_DEG,
    speedKtas: state.velocityFps / KT_TO_FPS,
    loadFactorG,
  });
  return {
    samples,
    record(state, loadFactorG) {
      if (state.elapsedTimeSec < next - 1e-9) return;
      samples.push(point(state, loadFactorG));
      while (next <= state.elapsedTimeSec + 1e-9) next += intervalSec;
    },
    finish(state, loadFactorG) {
      const last = samples[samples.length - 1];
      if (last && Math.abs(last.elapsedTimeSec - state.elapsedTimeSec) <= 1e-12) samples.pop();
      samples.push(point(state, loadFactorG));
    },
  };
}

export function calculateWingsLevelRecoveryPull(rawInput) {
  const input = {
    startAltitudeMslFt: rawInput.startAltitudeMslFt,
    startSpeedKcas: rawInput.startSpeedKcas,
    startFpaDeg: rawInput.startFpaDeg,
    targetFpaDeg: rawInput.targetFpaDeg,
    recoveryG: rawInput.recoveryG ?? 5,
    gOnsetTimeSec: rawInput.gOnsetTimeSec ?? 2,
    maneuverInitiationDelaySec: rawInput.maneuverInitiationDelaySec ?? 0,
  };
  validate(input);
  let sampler = null;
  if (rawInput.sampleIntervalSec !== undefined) {
    finite("sampleIntervalSec", rawInput.sampleIntervalSec);
    if (!(rawInput.sampleIntervalSec > 0)) throw new RangeError("sampleIntervalSec must be > 0");
    sampler = createRecoveryPullSampler(rawInput.sampleIntervalSec);
  }

  const state = {
    elapsedTimeSec: 0,
    horizontalDistanceFt: 0,
    pathDistanceFt: 0,
    altitudeMslFt: input.startAltitudeMslFt,
    minAltitudeMslFt: input.startAltitudeMslFt,
    velocityFps: casToTas(input.startSpeedKcas, input.startAltitudeMslFt) * KT_TO_FPS,
    fpaRad: input.startFpaDeg * DEG_TO_RAD,
  };
  const targetFpaRad = input.targetFpaDeg * DEG_TO_RAD;
  const baselineG = Math.cos(state.fpaRad);
  let delayElapsed = 0;
  let onsetElapsed = 0;
  let steadyElapsed = 0;
  let lastLoadFactorG = baselineG;
  sampler?.record(state, baselineG);

  while (delayElapsed < input.maneuverInitiationDelaySec - 1e-12) {
    const dt = Math.min(RECOVERY_PULL_MODEL.integrationStepSec, input.maneuverInitiationDelaySec - delayElapsed);
    integrateStep(state, baselineG, dt);
    delayElapsed += dt;
    sampler?.record(state, baselineG);
  }

  while (state.fpaRad < targetFpaRad && onsetElapsed < input.gOnsetTimeSec - 1e-12) {
    const dt = Math.min(RECOVERY_PULL_MODEL.integrationStepSec, input.gOnsetTimeSec - onsetElapsed);
    const midpointElapsed = onsetElapsed + dt / 2;
    const loadFactorG = linearGOnset({
      baselineG,
      targetG: input.recoveryG,
      gOnsetTimeSec: input.gOnsetTimeSec,
      elapsedTimeSec: midpointElapsed,
    }).loadFactorG;
    const previousFpa = state.fpaRad;
    const previous = { ...state };
    integrateStep(state, loadFactorG, dt);
    onsetElapsed += dt;
    lastLoadFactorG = loadFactorG;
    if (state.fpaRad >= targetFpaRad) {
      const fraction = (targetFpaRad - previousFpa) / (state.fpaRad - previousFpa || 1);
      if (fraction >= 0 && fraction <= 1) {
        state.elapsedTimeSec = previous.elapsedTimeSec + dt * fraction;
        state.horizontalDistanceFt = previous.horizontalDistanceFt + (state.horizontalDistanceFt - previous.horizontalDistanceFt) * fraction;
        state.pathDistanceFt = previous.pathDistanceFt + (state.pathDistanceFt - previous.pathDistanceFt) * fraction;
        state.altitudeMslFt = previous.altitudeMslFt + (state.altitudeMslFt - previous.altitudeMslFt) * fraction;
        state.velocityFps = previous.velocityFps + (state.velocityFps - previous.velocityFps) * fraction;
        state.fpaRad = targetFpaRad;
        state.minAltitudeMslFt = Math.min(previous.minAltitudeMslFt, state.altitudeMslFt);
        onsetElapsed -= dt * (1 - fraction);
      }
      break;
    }
    sampler?.record(state, loadFactorG);
  }

  let guard = 0;
  while (state.fpaRad < targetFpaRad && guard < 60000) {
    const dt = RECOVERY_PULL_MODEL.integrationStepSec;
    const previousFpa = state.fpaRad;
    const previous = { ...state };
    integrateStep(state, input.recoveryG, dt);
    steadyElapsed += dt;
    guard += 1;
    lastLoadFactorG = input.recoveryG;
    if (state.fpaRad >= targetFpaRad) {
      const fraction = (targetFpaRad - previousFpa) / (state.fpaRad - previousFpa || 1);
      if (fraction >= 0 && fraction <= 1) {
        state.elapsedTimeSec = previous.elapsedTimeSec + dt * fraction;
        state.horizontalDistanceFt = previous.horizontalDistanceFt + (state.horizontalDistanceFt - previous.horizontalDistanceFt) * fraction;
        state.pathDistanceFt = previous.pathDistanceFt + (state.pathDistanceFt - previous.pathDistanceFt) * fraction;
        state.altitudeMslFt = previous.altitudeMslFt + (state.altitudeMslFt - previous.altitudeMslFt) * fraction;
        state.velocityFps = previous.velocityFps + (state.velocityFps - previous.velocityFps) * fraction;
        state.fpaRad = targetFpaRad;
        state.minAltitudeMslFt = Math.min(previous.minAltitudeMslFt, state.altitudeMslFt);
        steadyElapsed -= dt * (1 - fraction);
      }
      break;
    }
    sampler?.record(state, input.recoveryG);
  }
  if (guard >= 60000) throw new Error("target FPA was not reached");

  const terminationTasKt = state.velocityFps / KT_TO_FPS;
  sampler?.finish(state, lastLoadFactorG);
  return {
    model: { ...RECOVERY_PULL_MODEL },
    inputs: input,
    elapsedTimeSec: state.elapsedTimeSec,
    horizontalDistanceNm: state.horizontalDistanceFt / FT_PER_NM,
    pathDistanceNm: state.pathDistanceFt / FT_PER_NM,
    altitudeChangeFt: state.altitudeMslFt - input.startAltitudeMslFt,
    minAltitudeMslFt: state.minAltitudeMslFt,
    terminationAltitudeMslFt: state.altitudeMslFt,
    terminationSpeedKcas: tasToCas(terminationTasKt, state.altitudeMslFt),
    terminationSpeedKtas: terminationTasKt,
    terminationFpaDeg: state.fpaRad * RAD_TO_DEG,
    phaseTimeSec: {
      initiationDelay: delayElapsed,
      gOnset: onsetElapsed,
      steadyRecovery: steadyElapsed,
    },
    ...(sampler ? { path: { sampleIntervalSec: rawInput.sampleIntervalSec, samples: sampler.samples } } : {}),
  };
}
