import { tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { ADOPTED_ACCELERATION_GRID_V0_1, adoptedAccelerationGrid } from "../../../flight/aircraft-performance/adopted-acceleration-grid-v0.1.mjs";
import { groundSpeedAlongPath } from "./flight-path-wind-v0.1.mjs";
import { capTasTable } from "./speed-cap-v0.1.mjs";
import { ROLL_IN_MIL_PREMISES } from "./roll-in-v0.2.mjs";

// Tracking at MIL v0.1 (owner 2026-11-19, POP-UP: "다이브할 때 military power를 쓸 것이다 … release 당시의 속도를
// 예측할 수 있다. 지정된 속도에 도달하면 그 속도를 유지한다"). The Track (Roll-out → Release) is flown on the
// ground-referenced Dive Angle line (BDP SPEC §8) at MIL: TAS is integrated with the adopted performance model,
// dV/dt = (T − D)/m at 1 G·cos(gamma) − g·sin(gamma) (gamma the air-path angle, from the ground speed along the line),
// with the Roll-in's MIL premises. With `capKcas` the speed, once it reaches that KCAS, follows it (power off as
// needed); a Track that starts above it holds its speed. The Release speed is the result. RK4, equal steps of at most 0.05 s.
export const DIVE_TRACK_MIL_V0_1 = Object.freeze({
  id: "bdp-dive-track-mil-v0.1",
  version: "0.1.0",
  powerSetting: "MIL",
  accelerationGrid: `${ADOPTED_ACCELERATION_GRID_V0_1.id} ${ADOPTED_ACCELERATION_GRID_V0_1.version}`,
  maxStepSec: 0.05,
});

const KT_TO_FPS = 1.687809857;
const G_FTPS2 = 32.174;
const DEG = Math.PI / 180;

export class DiveTrackError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiveTrackError";
    this.cacheable = true;
  }
}

function dynamics({ diveAngleDeg, windAlongKt = 0, windCrossKt = 0, capKcas = null }) {
  const sin = Math.sin(diveAngleDeg * DEG);
  const accel = adoptedAccelerationGrid({ fuelKg: ROLL_IN_MIL_PREMISES.fuelKg, aoaDeg: ROLL_IN_MIL_PREMISES.nominalAoaDeg });
  const cap = Number.isFinite(capKcas) ? capKcas : null;
  const capOf = cap === null ? null : capTasTable(cap);
  const capTasFps = (h) => capOf(h)[0];
  const gsFps = (vFps) => groundSpeedAlongPath({ airspeed: vFps / KT_TO_FPS, pathAngleDeg: diveAngleDeg, windAlong: windAlongKt, windCross: windCrossKt }) * KT_TO_FPS;
  // State [path ft, altitude ft MSL, TAS ft/s].
  const derivative = (s) => {
    const v = s[2];
    if (!(v > 1)) throw new DiveTrackError("Track speed reaches zero at MIL");
    const gs = gsFps(v);
    const hDot = -gs * sin;
    const sinGamma = Math.max(-1, Math.min(1, hDot / v));
    const n = Math.sqrt(1 - sinGamma * sinGamma);
    let rate;
    try {
      rate = accel(s[1], v, n) - G_FTPS2 * sinGamma;
    } catch (error) {
      throw new DiveTrackError(`No MIL performance data on the Track: ${error.message}`);
    }
    if (cap !== null) {
      const [c, slope] = capOf(s[1]);
      if (v >= c - 1e-9) rate = Math.min(rate, slope * hDot);
    }
    return [gs, hDot, rate];
  };
  const step = (s, dt) => {
    const k1 = derivative(s);
    const k2 = derivative(s.map((x, i) => x + (dt / 2) * k1[i]));
    const k3 = derivative(s.map((x, i) => x + (dt / 2) * k2[i]));
    const k4 = derivative(s.map((x, i) => x + dt * k3[i]));
    const next = s.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    // Reaching the cap from below: held at it. A Track that starts above it holds its speed (the derivative).
    if (cap !== null && s[2] <= capTasFps(s[1]) + 1e-9) next[2] = Math.min(next[2], capTasFps(next[1]));
    return next;
  };
  const start = (tasKt, altitudeMslFt) => {
    const v = tasKt * KT_TO_FPS;
    return [0, altitudeMslFt, v];
  };
  return { step, start, gsFps };
}

// (T − D)/m at MIL (ft/s²) of (altitude ft MSL, TAS ft/s, load factor G) with the same premises, for the SEM at MIL
// (owner 2026-11-19, "release이후에는 mil power로 level이던 csem을 한다"; sem-fragment 0.1.4, SEM NLT 0.2.3).
export function milThrustMinusDragFps2() {
  const accel = adoptedAccelerationGrid({ fuelKg: ROLL_IN_MIL_PREMISES.fuelKg, aoaDeg: ROLL_IN_MIL_PREMISES.nominalAoaDeg });
  return (altitudeMslFt, tasFps, loadFactorG) => {
    try {
      return accel(altitudeMslFt, tasFps, loadFactorG);
    } catch (error) {
      throw new DiveTrackError(`No MIL performance data on the SEM: ${error.message}`);
    }
  };
}
export const SEM_SPEED_MODELS = Object.freeze(["ENERGY_NEUTRAL", "MIL"]);

function flyFor(dyn, s0, timeSec) {
  const steps = Math.max(1, Math.ceil(timeSec / DIVE_TRACK_MIL_V0_1.maxStepSec - 1e-9));
  const dt = timeSec / steps;
  let s = s0;
  for (let i = 0; i < steps; i += 1) s = dyn.step(s, dt);
  return s;
}

function result(s, timeSec, s0, capKcas) {
  const endTasKt = s[2] / KT_TO_FPS;
  const endKcas = tasToCas(endTasKt, s[1]);
  return {
    timeSec,
    pathFt: s[0],
    endAltitudeMslFt: s[1],
    startTasKt: s0[2] / KT_TO_FPS,
    endTasKt,
    endKcas,
    capKcas: Number.isFinite(capKcas) ? capKcas : null,
    capReached: Number.isFinite(capKcas) && endKcas >= capKcas - 1e-6,
  };
}

// Time given (Tracking Time, solveMode "time"). A negative or zero time flies no Track: the start speed is kept and
// the path is that speed's ground speed × time (the shortfall the Roll-in Altitude carries, as before).
export function flyDiveTrackMilForTime({ startTasKt, startAltitudeMslFt, timeSec, ...geometry }) {
  const dyn = dynamics(geometry);
  const s0 = dyn.start(startTasKt, startAltitudeMslFt);
  if (!(timeSec > 0)) return result([dyn.gsFps(s0[2]) * timeSec, startAltitudeMslFt - dyn.gsFps(s0[2]) * timeSec * Math.sin(geometry.diveAngleDeg * DEG), s0[2]], timeSec, s0, geometry.capKcas);
  return result(flyFor(dyn, s0, timeSec), timeSec, s0, geometry.capKcas);
}

// Path given (the Track length, solveMode "height"): the time is found by Newton steps on the flown path.
export function flyDiveTrackMilForPath({ startTasKt, startAltitudeMslFt, pathFt, ...geometry }) {
  const dyn = dynamics(geometry);
  const s0 = dyn.start(startTasKt, startAltitudeMslFt);
  if (!(pathFt > 0)) {
    const t = pathFt / dyn.gsFps(s0[2]);
    return result([pathFt, startAltitudeMslFt - pathFt * Math.sin(geometry.diveAngleDeg * DEG), s0[2]], t, s0, geometry.capKcas);
  }
  let t = pathFt / dyn.gsFps(s0[2]);
  let s = flyFor(dyn, s0, t);
  for (let i = 0; i < 12 && Math.abs(s[0] - pathFt) > 1e-7; i += 1) {
    t += (pathFt - s[0]) / dyn.gsFps(s[2]);
    s = flyFor(dyn, s0, t);
  }
  return result(s, t, s0, geometry.capKcas);
}
