import { casToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { ADOPTED_PERFORMANCE_MODEL, ADOPTED_PERFORMANCE_MODEL_V0_1, evaluateAdoptedPerformance } from "../../../flight/aircraft-performance/adopted-performance-model-v0.1.mjs";
import { ADOPTED_ACCELERATION_GRID_V0_1, adoptedAccelerationGrid } from "../../../flight/aircraft-performance/adopted-acceleration-grid-v0.1.mjs";

// POP-UP climb v0.2 (owner 2026-10-27, POP-UP SPEC §13.2c, §13.3, §13.5): Pop Point → Roll-in Start.
//   Pull-up: wings level from level flight at the Pop Point; G from 1 G to Popup G at the G Onset Rate (the BDP
//   rate), held, then released at the same rate, timed so that the flight path reaches the Popup angle as the G
//   reaches cos(Popup angle) (the straight-climb load factor: "G release at the same rate, pitch held"). A
//   Popup angle too small for the full Popup G peaks lower: onset straight into release.
//   Straight climb: the Popup angle held (n = cos(gamma)) until the Roll-in Altitude (Roll-in Start).
//   Speed: TAS integrated with the adopted performance model at MIL throughout, dV/dt = (T − D)/m − g·sin(gamma)
//   (BOX OUT v0.2's premises: fuel the middle of the model's range, nominal AoA 5°, research extrapolation
//   allowed and reported). Point mass, no wind (an air-mass manoeuvre, as the BDP Roll-in), standard atmosphere.
// Pure calculation: no DOM, no storage. The Roll-in after Roll-in Start is the BDP's (v0.4.5 POP-UP option).
export const POPUP_CLIMB_V0_2 = Object.freeze({
  id: "popup-climb-v0.2",
  version: "0.2.0",
  status: "Work / MIL climb on the PW-229 research model (unofficial adoption) / Not Official",
  performanceEntry: `${ADOPTED_PERFORMANCE_MODEL_V0_1.id} ${ADOPTED_PERFORMANCE_MODEL_V0_1.version}`,
  performanceModel: ADOPTED_PERFORMANCE_MODEL.modelId,
  accelerationGrid: `${ADOPTED_ACCELERATION_GRID_V0_1.id} ${ADOPTED_ACCELERATION_GRID_V0_1.version}`,
  powerSetting: ADOPTED_PERFORMANCE_MODEL.powerSetting,
  fuelKg: (ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[0] + ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[1]) / 2,
  nominalAoaDeg: 5,
  stepSec: 0.05,
  // Popup angle domain (POP-UP SPEC §11 / §13.5): above 0, below 55 (exclusive).
  angleDomainDeg: Object.freeze([0, 55]),
  climbLimitSec: 300,
});

const G = 32.174;
const KT_TO_FPS = 1.687809857;
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;

export class PopupClimbError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PopupClimbError";
    this.code = code;
    this.cacheable = true;
  }
}

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// State [groundFt, altitudeMslFt, gammaRad, tasFps]; control: load factor. (T − D)/m from the adopted model's
// acceleration grid (exact in G, bilinear in altitude and TAS), the same as the BDP POP-UP Roll-in.
function createClimbDynamics() {
  const accel = adoptedAccelerationGrid({ fuelKg: POPUP_CLIMB_V0_2.fuelKg, aoaDeg: POPUP_CLIMB_V0_2.nominalAoaDeg });
  const speedRate = (tasFps, altitudeMslFt, gamma, loadFactorG) => {
    if (!(tasFps > 1)) throw new PopupClimbError("SPEED", "The climb speed reaches zero at MIL");
    try {
      return accel(altitudeMslFt, tasFps, loadFactorG) - G * Math.sin(gamma);
    } catch (error) {
      throw new PopupClimbError("PERFORMANCE_UNAVAILABLE", error.message);
    }
  };
  const derivative = (s, n) => [
    s[3] * Math.cos(s[2]),
    s[3] * Math.sin(s[2]),
    (G / s[3]) * (n - Math.cos(s[2])),
    speedRate(s[3], s[1], s[2], n),
  ];
  // RK4 with the load factor a function of the phase time.
  const rk4 = (s, nAt, tau, dt) => {
    const add = (k, a) => s.map((value, i) => value + a * k[i]);
    const k1 = derivative(s, nAt(tau, s));
    const s2 = add(k1, dt / 2);
    const k2 = derivative(s2, nAt(tau + dt / 2, s2));
    const s3 = add(k2, dt / 2);
    const k3 = derivative(s3, nAt(tau + dt / 2, s3));
    const s4 = add(k3, dt);
    const k4 = derivative(s4, nAt(tau + dt, s4));
    return s.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  };
  const phase = (s, durationSec, nAt, onStep) => {
    let state = s;
    for (let tau = 0; durationSec - tau > 1e-12;) {
      const dt = Math.min(POPUP_CLIMB_V0_2.stepSec, durationSec - tau);
      state = rk4(state, nAt, tau, dt);
      tau += dt;
      onStep?.(tau, state, nAt(tau, state));
    }
    return state;
  };
  return { rk4, phase };
}

// The research-envelope report of the flown samples, with the exact model.
function performanceDomainOf(samples) {
  const issues = new Set();
  let outside = 0;
  for (const x of samples) {
    const perf = evaluateAdoptedPerformance({
      altitudeMslFt: x.s[1], casKt: tasToCas(x.s[3] / KT_TO_FPS, x.s[1]), fuelKg: POPUP_CLIMB_V0_2.fuelKg, loadFactorG: x.n,
      aoaDeg: POPUP_CLIMB_V0_2.nominalAoaDeg, verticalSpeedMps: x.s[3] * Math.sin(x.s[2]) * 0.3048,
    }, { allowResearchExtrapolation: true });
    if (perf.outsideDomain) {
      outside += 1;
      perf.domainIssues.forEach((issue) => issues.add(issue));
    }
  }
  return { states: samples.length, outsideDomainStates: outside, domainIssues: [...issues].sort() };
}

function normalizeInput(input) {
  const popAltitudeMslFt = finite("popAltitudeMslFt", input.popAltitudeMslFt);
  const popSpeedKcas = finite("popSpeedKcas", input.popSpeedKcas);
  const rollInAltitudeMslFt = finite("rollInAltitudeMslFt", input.rollInAltitudeMslFt);
  const popupAngleDeg = finite("popupAngleDeg", input.popupAngleDeg);
  const popupG = finite("popupG", input.popupG ?? 3);
  const gOnsetRateGSec = finite("gOnsetRateGSec", input.gOnsetRateGSec ?? 2);
  const [lo, hi] = POPUP_CLIMB_V0_2.angleDomainDeg;
  if (!(popSpeedKcas > 0)) throw new RangeError("Pop Speed must be > 0 KCAS");
  if (!(popupAngleDeg > lo && popupAngleDeg < hi)) throw new RangeError(`Popup angle must be > ${lo}° and < ${hi}°`);
  if (!(popupG > 1 && popupG <= 9)) throw new RangeError("Popup G must be > 1 and <= 9");
  if (!(gOnsetRateGSec > 0)) throw new RangeError("G Onset Rate must be > 0");
  if (!(rollInAltitudeMslFt > popAltitudeMslFt)) throw new RangeError("Roll-in Altitude must be above the Pop Point altitude");
  return { popAltitudeMslFt, popSpeedKcas, rollInAltitudeMslFt, popupAngleDeg, popupG, gOnsetRateGSec };
}

// The pull-up for one peak G: onset to the peak, hold, then release to cos(angle). Returns the end state of the
// release for a hold time.
function pullUpPlan(p) {
  const theta = p.popupAngleDeg * DEG;
  const nEnd = Math.cos(theta);
  const rate = p.gOnsetRateGSec;
  return (peakG) => {
    const onsetSec = (peakG - 1) / rate;
    const releaseSec = (peakG - nEnd) / rate;
    return {
      peakG,
      onsetSec,
      releaseSec,
      onsetN: (tau) => Math.min(peakG, 1 + rate * tau),
      holdN: () => peakG,
      releaseN: (tau) => Math.max(nEnd, peakG - rate * tau),
    };
  };
}

// Root of a continuous f on [a, b] with f(a) <= 0 <= f(b) (Illinois); 1e-10 rad of FPA is far below any display.
function illinois(f, a, b, fa, fb) {
  if (fa === 0) return a;
  if (fb === 0) return b;
  let side = 0;
  for (let i = 0; i < 80; i += 1) {
    const x = b - (fb * (b - a)) / (fb - fa);
    const fx = f(x);
    if (Math.abs(fx) < 1e-10 || Math.abs(b - a) < 1e-12) return x;
    if (fx > 0) {
      b = x;
      fb = fx;
      if (side === 1) fa /= 2;
      side = 1;
    } else {
      a = x;
      fa = fx;
      if (side === -1) fb /= 2;
      side = -1;
    }
  }
  return b - (fb * (b - a)) / (fb - fa);
}

export function calculatePopupClimbFull(rawInput) {
  const p = normalizeInput(rawInput);
  const theta = p.popupAngleDeg * DEG;
  const dyn = createClimbDynamics();
  const start = [0, p.popAltitudeMslFt, 0, casToTas(p.popSpeedKcas, p.popAltitudeMslFt) * KT_TO_FPS];
  const plan = pullUpPlan(p);
  // End FPA of onset → hold(h) → release, for a peak G and a hold time.
  const flyPullUp = (peakG, holdSec, onStep, d = dyn) => {
    const q = plan(peakG);
    let t = 0;
    const step = (name) => (tau, s, n) => onStep?.(t + tau, s, n, name);
    let s = d.phase(start, q.onsetSec, q.onsetN, step("onset"));
    t += q.onsetSec;
    s = d.phase(s, holdSec, q.holdN, step("hold"));
    t += holdSec;
    s = d.phase(s, q.releaseSec, q.releaseN, step("release"));
    t += q.releaseSec;
    return { s, t, q };
  };
  const fpaError = (peakG, holdSec) => flyPullUp(peakG, holdSec).s[2] - theta;
  let peakG = p.popupG;
  let holdSec = 0;
  if (fpaError(peakG, 0) > 0) {
    // The angle is reached before the full Popup G: a lower peak, onset straight into release.
    peakG = illinois((g) => fpaError(g, 0), 1, peakG, fpaError(1, 0), fpaError(peakG, 0));
  } else {
    // The hold time: bracket by doubling (the end FPA grows with the hold), then Illinois.
    let lo = 0;
    let fLo = fpaError(peakG, 0);
    let hi = 1;
    let fHi = fpaError(peakG, hi);
    while (fHi < 0) {
      lo = hi;
      fLo = fHi;
      hi *= 2;
      if (hi > 120) throw new PopupClimbError("NO_PULL_UP", "The pull-up does not reach the Popup angle");
      fHi = fpaError(peakG, hi);
    }
    holdSec = illinois((h) => fpaError(peakG, h), lo, hi, fLo, fHi);
  }
  // Fly the solved pull-up once, sampled, then the straight climb to the Roll-in Altitude.
  const fly = dyn;
  const samples = [{ t: 0, s: start, n: 1, phase: "pop" }];
  const record = (t, s, n, phase) => samples.push({ t, s, n, phase });
  const pull = flyPullUp(peakG, holdSec, record, fly);
  if (samples.some((x) => x.s[1] >= p.rollInAltitudeMslFt)) {
    throw new PopupClimbError("ARC_PASSES_ROLL_IN", "The pull-up arc alone passes the Roll-in Altitude (Popup angle too steep for the climb height)");
  }
  // Hold the angle exactly (the release ended on it within the bisection tolerance).
  let s = [pull.s[0], pull.s[1], theta, pull.s[3]];
  let t = pull.t;
  const pullUpEnd = { t, s };
  const climbN = (tau, state) => Math.cos(state[2]);
  for (;;) {
    const next = fly.rk4(s, climbN, 0, POPUP_CLIMB_V0_2.stepSec);
    if (next[1] >= p.rollInAltitudeMslFt) {
      // The Roll-in Altitude inside this step: bisection on the step length.
      let a = 0;
      let b = POPUP_CLIMB_V0_2.stepSec;
      for (let i = 0; i < 50; i += 1) {
        const m = (a + b) / 2;
        if (fly.rk4(s, climbN, 0, m)[1] >= p.rollInAltitudeMslFt) b = m; else a = m;
      }
      const dt = (a + b) / 2;
      s = fly.rk4(s, climbN, 0, dt);
      t += dt;
      record(t, s, Math.cos(s[2]), "climb");
      break;
    }
    s = next;
    t += POPUP_CLIMB_V0_2.stepSec;
    record(t, s, Math.cos(s[2]), "climb");
    if (t > POPUP_CLIMB_V0_2.climbLimitSec) throw new PopupClimbError("CLIMB_TOO_LONG", `The MIL climb does not reach the Roll-in Altitude within ${POPUP_CLIMB_V0_2.climbLimitSec} s`);
  }
  const tasKt = (state) => state[3] / KT_TO_FPS;
  const point = (time, state) => ({
    timeSec: time,
    groundFt: state[0],
    groundNm: state[0] / FT_PER_NM,
    altitudeMslFt: state[1],
    fpaDeg: state[2] / DEG,
    tasKt: tasKt(state),
    casKt: tasToCas(tasKt(state), state[1]),
  });
  return {
    model: { ...POPUP_CLIMB_V0_2 },
    inputs: p,
    pullUp: {
      peakG,
      reachesPopupG: peakG === p.popupG,
      onsetSec: pull.q.onsetSec,
      holdSec,
      releaseSec: pull.q.releaseSec,
      end: point(pullUpEnd.t, pullUpEnd.s),
    },
    pop: point(0, start),
    rollInStart: point(t, s),
    climbTimeSec: t,
    groundDistanceFt: s[0],
    groundDistanceNm: s[0] / FT_PER_NM,
    samples: samples.map((x) => ({ ...point(x.t, x.s), loadFactorG: x.n, phase: x.phase })),
    performanceDomain: performanceDomainOf(samples),
  };
}
