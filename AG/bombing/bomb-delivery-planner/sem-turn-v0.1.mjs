import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";

// SEM turn v0.1 (owner 2026-10-19, BDP SPEC §6.8): the sustained turn a Level SEM flies from its level-off, with
// the same linear onsets as the Roll-in and the Offset Turn — roll at 1 G to the bank at the Roll-in Rate, pull to
// G at the G Onset Rate, hold G and bank, roll out at the Roll-out Rate. Speed is held (CAS).
// - LEVEL: bank AUTO = acos(1/G); altitude held, heading rate g·n·sin(bank)/V, the roll-out returns G linearly
//   to 1 (the Common onset level turn's kinematics, here up to 360°).
// - SLICE: the entered bank (above acos(1/G)), point-mass flight path with G and bank held; the roll-out keeps G,
//   then a wings-level pull at the same G to level flight (owner 2026-10-19). Climbing back through level during
//   the roll-out holds level from there.
// Turn amount: the roll-out ends on the heading change. When the onsets alone turn past it, a lower turn G
// (REDUCED: LEVEL with its bank acos(1/G), SLICE with the same bank; a slice too small even at 1 G flies a REDUCED
// level turn). Mechanism only: the consumer places the turn (start time, side, wind). Display and check only.
export const SEM_TURN_MODEL_V0_1 = Object.freeze({
  id: "bdp-sem-turn-v0.1",
  version: "0.1.0",
  types: Object.freeze(["LEVEL", "SLICE"]),
  directions: Object.freeze(["LEFT", "RIGHT"]),
  maxHeadingChangeDeg: 360,
  maxLoadFactorG: 9,
  maxSliceBankDeg: 150,
  verticalLimitDeg: 85,
  speedHold: "CAS",
  stepSec: 0.05,
  sampleIntervalSec: 0.1,
});

const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;
const DEG = Math.PI / 180;
const STEP = SEM_TURN_MODEL_V0_1.stepSec;
const SAMPLE = SEM_TURN_MODEL_V0_1.sampleIntervalSec;
const VERTICAL_RAD = SEM_TURN_MODEL_V0_1.verticalLimitDeg * DEG;
const TAS_GRID_FT = 50;
const MAX_PHASE_SEC = 300;

// Input that cannot be flown: the BDP keeps MINALT / NLT and reports the SEM as INVALID with these codes.
export function semTurnError(codes) {
  const error = new RangeError(`SEM turn: ${codes.join(", ")}`);
  error.semErrors = [...codes];
  return error;
}

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function validate({ type, headingChangeDeg, loadFactorG, bankDeg, speedKcas }) {
  const errors = [];
  if (!(headingChangeDeg > 0 && headingChangeDeg <= SEM_TURN_MODEL_V0_1.maxHeadingChangeDeg)) errors.push("SEM_TURN_OUT_OF_RANGE");
  if (!(loadFactorG > 1 && loadFactorG <= SEM_TURN_MODEL_V0_1.maxLoadFactorG)) errors.push("SEM_TURN_G_OUT_OF_RANGE");
  if (!(speedKcas > 0)) errors.push("SEM_TURN_SPEED_OUT_OF_RANGE");
  if (type === "SLICE") {
    if (typeof bankDeg !== "number" || !Number.isFinite(bankDeg)) errors.push("SLICE_BANK_REQUIRED");
    else if (!(bankDeg <= SEM_TURN_MODEL_V0_1.maxSliceBankDeg)) errors.push("SLICE_BANK_OUT_OF_RANGE");
    else if (loadFactorG > 1 && !(bankDeg > Math.acos(1 / loadFactorG) / DEG)) errors.push("SLICE_BANK_NOT_ABOVE_LEVEL_BANK");
  }
  if (errors.length) throw semTurnError(errors);
}

// TAS at the held CAS; a slice changes altitude, so TAS comes from a lazily filled 50 ft grid (linear between).
function tasModel(speedKcas, startAltitudeMslFt, level) {
  const exact = (h) => casToTas(speedKcas, h) * KT_TO_FPS;
  const v0 = exact(startAltitudeMslFt);
  if (level) return () => v0;
  const grid = new Map();
  const at = (i) => {
    if (!grid.has(i)) grid.set(i, exact(i * TAS_GRID_FT));
    return grid.get(i);
  };
  return (h) => {
    const x = h / TAS_GRID_FT;
    const i = Math.floor(x);
    return at(i) + (at(i + 1) - at(i)) * (x - i);
  };
}

// State [forwardFt, turnSideFt, altitudeMslFt, fpaRad, headingRad] in the turn's own frame (x along the heading at
// the start, y toward the turn side, no wind). levelHold: the altitude is held (gamma' = 0).
function derivativeInto(out, s, c, tasFps) {
  const v = tasFps(s[2]);
  const cosG = Math.cos(s[3]);
  out[0] = v * cosG * Math.cos(s[4]);
  out[1] = v * cosG * Math.sin(s[4]);
  out[2] = v * Math.sin(s[3]);
  out[3] = c.levelHold ? 0 : (G_FTPS2 * (c.n * Math.cos(c.bank) - cosG)) / v;
  out[4] = (G_FTPS2 * c.n * Math.sin(c.bank)) / (v * cosG);
}

// Classic RK4 on scratch arrays; only the returned state is allocated.
const K1 = new Float64Array(5);
const K2 = new Float64Array(5);
const K3 = new Float64Array(5);
const K4 = new Float64Array(5);
const TMP = new Float64Array(5);
function rk4(s, controls, tau, dt, tasFps) {
  derivativeInto(K1, s, controls(tau, s), tasFps);
  for (let i = 0; i < 5; i += 1) TMP[i] = s[i] + (dt / 2) * K1[i];
  derivativeInto(K2, TMP, controls(tau + dt / 2, TMP), tasFps);
  for (let i = 0; i < 5; i += 1) TMP[i] = s[i] + (dt / 2) * K2[i];
  derivativeInto(K3, TMP, controls(tau + dt / 2, TMP), tasFps);
  for (let i = 0; i < 5; i += 1) TMP[i] = s[i] + dt * K3[i];
  derivativeInto(K4, TMP, controls(tau + dt, TMP), tasFps);
  const next = new Float64Array(5);
  for (let i = 0; i < 5; i += 1) next[i] = s[i] + (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
  return next;
}

function checkVertical(s) {
  if (Math.abs(s[3]) >= VERTICAL_RAD) throw semTurnError(["SLICE_REACHES_VERTICAL"]);
}

// The turn flown for one peak (bank, G): phase schedules and an integrator that can stop the hold anywhere.
function turnPlan({ level, onset, peak, tasFps }) {
  const rollSec = peak.bank / (onset.rollInRollRateDegSec * DEG);
  const pullSec = (peak.n - 1) / onset.gOnsetRateGSec;
  const rollOutSec = peak.bank / (onset.rollOutRollRateDegSec * DEG);
  const schedules = {
    roll: (tau) => ({ bank: peak.bank * Math.min(1, tau / rollSec), n: 1 }),
    pull: (tau) => ({ bank: peak.bank, n: 1 + (peak.n - 1) * Math.min(1, tau / pullSec) }),
    hold: () => ({ bank: peak.bank, n: peak.n }),
    rollOut: (tau) => {
      const x = Math.min(1, tau / rollOutSec);
      return { bank: peak.bank * (1 - x), n: level ? peak.n + (1 - peak.n) * x : peak.n };
    },
    levelOff: () => ({ bank: 0, n: peak.n }),
  };
  const controlsOf = (name, latch) => (tau, s) => {
    const c = schedules[name](tau, s);
    if (level) c.levelHold = true;
    // SLICE roll-out back through level: level flight from there (G = 1/cos bank).
    else if (latch?.level) { c.n = 1 / Math.cos(c.bank); c.levelHold = true; }
    return c;
  };
  // Integrates one phase; onStep(tauEnd, state, controls) after each step.
  function phase(s, name, durationSec, onStep, latch = null) {
    let state = s;
    const controls = controlsOf(name, latch);
    const steps = Math.max(1, Math.ceil(durationSec / STEP - 1e-9));
    const dt = durationSec / steps;
    if (!(durationSec > 0)) return state;
    for (let i = 0; i < steps; i += 1) {
      state = rk4(state, controls, i * dt, dt, tasFps);
      if (!level) checkVertical(state);
      if (latch && !level && !latch.level && state[3] >= 0) {
        latch.level = true;
        state[3] = 0;
      }
      onStep?.((i + 1) * dt, state, controls((i + 1) * dt, state));
    }
    return state;
  }
  // SLICE only: wings level at G until the flight path is level again (the crossing interpolated).
  function levelOff(s, onStep) {
    if (level || s[3] >= 0) return { state: s, durationSec: 0 };
    const controls = controlsOf("levelOff");
    let state = s;
    let tau = 0;
    while (tau < MAX_PHASE_SEC) {
      const next = rk4(state, controls, tau, STEP, tasFps);
      checkVertical(next);
      if (next[3] >= 0) {
        // The crossing by secant steps on a partial RK4 step from the last state below level.
        let dtA = 0;
        let gA = state[3];
        let dtB = STEP;
        let gB = next[3];
        let end = next;
        for (let i = 0; i < 8 && Math.abs(gB) > 1e-13; i += 1) {
          const dt = dtB - (gB * (dtB - dtA)) / (gB - gA);
          end = rk4(state, controls, tau, dt, tasFps);
          dtA = dtB; gA = gB;
          dtB = dt; gB = end[3];
        }
        end[3] = 0;
        onStep?.(tau + dtB, end, controls(tau + dtB, end));
        return { state: end, durationSec: tau + dtB };
      }
      state = next;
      tau += STEP;
      onStep?.(tau, state, controls(tau, state));
    }
    throw semTurnError(["SLICE_NO_LEVEL_OFF"]);
  }
  return { rollSec, pullSec, rollOutSec, phase, levelOff };
}

// Heading at the roll-out end for a hold time: the hold states every step are kept, so each trial integrates only
// the part of a step and the roll-out.
function holdSolver(plan, holdStart, thetaRad) {
  const holds = [holdStart];
  let state = holdStart;
  while (state[4] < thetaRad) {
    state = plan.phase(state, "hold", STEP);
    holds.push(state);
    if (holds.length * STEP > MAX_PHASE_SEC) throw semTurnError(["SEM_TURN_NOT_COMPLETED"]);
  }
  const stateAt = (holdSec) => {
    const i = Math.min(holds.length - 1, Math.floor(holdSec / STEP + 1e-9));
    const rest = holdSec - i * STEP;
    return rest > 1e-12 ? plan.phase(holds[i], "hold", rest) : holds[i];
  };
  const endHeading = (holdSec) => plan.phase(stateAt(holdSec), "rollOut", plan.rollOutSec, null, { level: false })[4];
  return { maxHoldSec: (holds.length - 1) * STEP, endHeading };
}

// Illinois regula falsi on an increasing f with f(lo) ≤ 0 ≤ f(hi).
function solveIncreasing(f, lo, hi) {
  let flo = f(lo);
  let fhi = f(hi);
  let side = 0;
  for (let i = 0; i < 80; i += 1) {
    if (Math.abs(fhi - flo) < 1e-15) break;
    const x = (lo * fhi - hi * flo) / (fhi - flo);
    const fx = f(x);
    if (Math.abs(fx) < 1e-11 || hi - lo < 1e-12) return x;
    if (fx > 0) {
      hi = x; fhi = fx;
      if (side === 1) flo /= 2;
      side = 1;
    } else {
      lo = x; flo = fx;
      if (side === -1) fhi /= 2;
      side = -1;
    }
  }
  return (lo + hi) / 2;
}

export function calculateSemTurn({
  type = "LEVEL",
  headingChangeDeg,
  loadFactorG,
  bankDeg = null,
  speedKcas,
  startAltitudeMslFt,
  rollInRollRateDegSec,
  rollOutRollRateDegSec,
  gOnsetRateGSec,
  startTimeSec = 0,
}) {
  if (!SEM_TURN_MODEL_V0_1.types.includes(type)) throw new RangeError(`type must be one of ${SEM_TURN_MODEL_V0_1.types.join(", ")}`);
  [["headingChangeDeg", headingChangeDeg], ["loadFactorG", loadFactorG], ["speedKcas", speedKcas], ["startAltitudeMslFt", startAltitudeMslFt], ["startTimeSec", startTimeSec]]
    .forEach(([name, value]) => finite(name, value));
  const onset = { rollInRollRateDegSec, rollOutRollRateDegSec, gOnsetRateGSec };
  for (const [name, value] of Object.entries(onset)) {
    if (!(finite(name, value) > 0)) throw new RangeError(`${name} must be > 0`);
  }
  validate({ type, headingChangeDeg, loadFactorG, bankDeg, speedKcas });

  const thetaRad = headingChangeDeg * DEG;
  const levelBankRad = Math.acos(1 / loadFactorG);
  let level = type === "LEVEL";
  const start = Float64Array.of(0, 0, startAltitudeMslFt, 0, 0);
  const planFor = (n, levelTurn) => {
    const tasFps = tasModel(speedKcas, startAltitudeMslFt, levelTurn);
    return turnPlan({ level: levelTurn, onset, peak: { bank: levelTurn ? Math.acos(1 / n) : bankDeg * DEG, n }, tasFps });
  };
  // Heading at the roll-out end with no hold, for a peak G.
  const onsetHeading = (n, levelTurn) => {
    const plan = planFor(n, levelTurn);
    let s = plan.phase(start, "roll", plan.rollSec);
    s = plan.phase(s, "pull", plan.pullSec);
    return plan.phase(s, "rollOut", plan.rollOutSec, null, { level: false })[4];
  };

  let mode = "FULL";
  let peakN = loadFactorG;
  if (onsetHeading(loadFactorG, level) > thetaRad) {
    if (!level && onsetHeading(1, false) > thetaRad) {
      level = true;
      mode = "REDUCED_LEVEL";
    } else mode = "REDUCED";
    let lo = 1;
    let hi = loadFactorG;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (onsetHeading(mid, level) > thetaRad) hi = mid;
      else lo = mid;
      if (hi - lo < 1e-12) break;
    }
    peakN = (lo + hi) / 2;
  }
  const plan = planFor(peakN, level);
  const peakBankRad = level ? Math.acos(1 / peakN) : bankDeg * DEG;
  let holdSec = 0;
  if (mode === "FULL") {
    let s = plan.phase(start, "roll", plan.rollSec);
    s = plan.phase(s, "pull", plan.pullSec);
    if (level) {
      // Level: the hold turns at a constant rate and the roll-out adds the same heading wherever it starts.
      const rollOutRad = plan.phase(s, "rollOut", plan.rollOutSec)[4] - s[4];
      const rateRadSec = (G_FTPS2 * Math.sqrt(peakN * peakN - 1)) / tasModel(speedKcas, startAltitudeMslFt, true)(startAltitudeMslFt);
      holdSec = Math.max(0, (thetaRad - s[4] - rollOutRad) / rateRadSec);
    } else {
      const solver = holdSolver(plan, s, thetaRad);
      holdSec = solveIncreasing((h) => solver.endHeading(h) - thetaRad, 0, solver.maxHoldSec);
    }
  }

  // The flight once more, recorded every step, then put on the 0.1 s grid of the caller's clock.
  const trace = [{ tau: 0, s: start, bank: 0, n: 1, phase: "turn-roll" }];
  let tau0 = 0;
  const record = (phaseName) => (tau, s, c) => trace.push({ tau: tau0 + tau, s, bank: c.bank, n: c.n, phase: phaseName });
  let s = plan.phase(start, "roll", plan.rollSec, record("turn-roll"));
  tau0 += plan.rollSec;
  s = plan.phase(s, "pull", plan.pullSec, record("turn-pull"));
  tau0 += plan.pullSec;
  s = plan.phase(s, "hold", holdSec, record("turn-hold"));
  tau0 += holdSec;
  const latch = { level: false };
  s = plan.phase(s, "rollOut", plan.rollOutSec, record("turn-rollout"), latch);
  tau0 += plan.rollOutSec;
  const after = plan.levelOff(s, record("turn-leveloff"));
  s = after.state;
  tau0 += after.durationSec;
  const timeSec = tau0;

  const tasFps = tasModel(speedKcas, startAltitudeMslFt, level);
  const sampleOf = (entry) => ({
    timeSec: startTimeSec + entry.tau,
    forwardFt: entry.s[0],
    turnSideFt: entry.s[1],
    altitudeMslFt: entry.s[2],
    fpaDeg: entry.s[3] / DEG,
    headingChangeDeg: entry.s[4] / DEG,
    bankDeg: entry.bank / DEG,
    loadFactorG: entry.n,
    tasKt: tasFps(entry.s[2]) / KT_TO_FPS,
    phase: entry.phase,
  });
  const lerp = (a, b, f) => ({
    tau: a.tau + (b.tau - a.tau) * f,
    s: a.s.map((value, i) => value + (b.s[i] - value) * f),
    bank: a.bank + (b.bank - a.bank) * f,
    n: a.n + (b.n - a.n) * f,
    phase: b.phase,
  });
  // Grid times of the caller's clock inside the turn, and each phase end.
  const samples = [sampleOf(trace[0])];
  let k = Math.floor(startTimeSec / SAMPLE + 1e-9) + 1;
  for (let i = 1; i < trace.length; i += 1) {
    const a = trace[i - 1];
    const b = trace[i];
    while (startTimeSec + b.tau >= k * SAMPLE - 1e-9) {
      const tGrid = k * SAMPLE - startTimeSec;
      if (tGrid > a.tau + 1e-9 && tGrid < b.tau - 1e-9) samples.push(sampleOf(lerp(a, b, (tGrid - a.tau) / (b.tau - a.tau))));
      k += 1;
    }
    if (i === trace.length - 1 || trace[i + 1].phase !== b.phase || Math.abs(startTimeSec + b.tau - Math.round((startTimeSec + b.tau) / SAMPLE) * SAMPLE) < 1e-9) {
      samples.push(sampleOf(b));
    }
  }
  const end = sampleOf(trace[trace.length - 1]);
  return {
    model: { ...SEM_TURN_MODEL_V0_1 },
    type,
    flownType: level ? "LEVEL" : "SLICE",
    mode,
    headingChangeDeg,
    loadFactorG,
    peakLoadFactorG: peakN,
    bankDeg: peakBankRad / DEG,
    levelBankDeg: levelBankRad / DEG,
    bankAuto: level,
    speedKcas,
    startTasKt: tasFps(startAltitudeMslFt) / KT_TO_FPS,
    onset,
    phaseTimesSec: { roll: plan.rollSec, pull: plan.pullSec, hold: holdSec, rollOut: plan.rollOutSec, levelOff: after.durationSec },
    rollOutLevelLatched: latch.level,
    timeSec,
    end,
    minAltitudeMslFt: Math.min(...trace.map((entry) => entry.s[2])),
    samples,
  };
}
