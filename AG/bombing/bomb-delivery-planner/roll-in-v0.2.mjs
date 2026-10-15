import { casToTas, machToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";

// BDP Roll-in v0.2 (owner 2026-10-15, SPEC §5.1): technique B with linear rate onsets.
// Roll at 1 G to the Roll-in Bank at the Roll-in Rate; pull at the G Onset Rate to Roll-in G; hold G with no
// roll input (the bank unwinds as mu_dot = psi_dot·sin(gamma)); roll out at the Roll-out Rate while G goes
// linearly to cos(Dive). The Roll-in Bank and the hold time are solved so the Track Point has heading change
// = Angle Off and flight path = −Dive. Speed is held in the entered mode (CAS or Mach), as in the BMS check.
// Below 10° Dive the Roll-in is a level turn with the same onsets (bank acos(1/G), altitude held).

export const ROLL_IN_V0_2_MODEL = Object.freeze({
  id: "bdp-roll-in-v0.2-model-b-rate-onset",
  version: "0.2.0",
  technique: "B",
  onsetShape: "LINEAR",
  speedHold: "ENTERED_MODE",
});

export const ROLL_IN_ONSET_DEFAULTS = Object.freeze({
  rollInRollRateDegSec: 60,
  rollOutRollRateDegSec: 55,
  gOnsetRateGSec: 2,
});
export const ROLL_IN_LOW_ANGLE_BOUNDARY_DEG = 10;
export const ROLL_IN_LARGE_BANK_WARNING_DEG = 150;

const G_FTPS2 = 32.174;
const KT_TO_FPS = 1.687809857;
const DEG = Math.PI / 180;
const STEP_SEC = 0.1;
const SAMPLE_SEC = 0.1;
const VERTICAL_LIMIT_RAD = Math.PI / 2 - 1e-4;
const HEADING_TOLERANCE_RAD = 1e-10;
const DIVE_TOLERANCE_RAD = 1e-9;
const TAS_GRID_STEP_FT = 25;
const TAS_GRID_ABOVE_FT = 1000;
const TAS_GRID_POINTS = 1 + (1000 + 20000) / 25;

export function isLevelTurnRollIn(diveAngleDeg) {
  return diveAngleDeg < ROLL_IN_LOW_ANGLE_BOUNDARY_DEG;
}

// Counters for performance tests only; they never change a result.
export const rollInSolveStats = { solves: 0, bankEvaluations: 0 };

export class RollInSolveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RollInSolveError";
    this.code = code;
    // The same input always fails the same way: a calculation cache may store it (Common cache 0.1.1).
    this.cacheable = true;
  }
}

function onsetFrom(params) {
  const onset = {
    rollInRollRateDegSec: params.rollInRollRateDegSec ?? ROLL_IN_ONSET_DEFAULTS.rollInRollRateDegSec,
    rollOutRollRateDegSec: params.rollOutRollRateDegSec ?? ROLL_IN_ONSET_DEFAULTS.rollOutRollRateDegSec,
    gOnsetRateGSec: params.gOnsetRateGSec ?? ROLL_IN_ONSET_DEFAULTS.gOnsetRateGSec,
  };
  for (const [name, value] of Object.entries(onset)) {
    if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) throw new RangeError(`${name} must be finite and > 0`);
  }
  return onset;
}

// Point-mass state [forwardFt, turnSideFt, altitudeMslFt, gammaRad, headingRad, bankRad]; TAS follows altitude.
function createDynamics(params, initialAltitudeMslFt) {
  const mode = params.initialSpeedMode === "MACH" ? "MACH" : "CAS";
  const value = params.initialSpeedValue;
  const exactTasFps = (altitudeMslFt) => (mode === "MACH" ? machToTas(value, altitudeMslFt) : casToTas(value, altitudeMslFt)) * KT_TO_FPS;
  // TAS on a 25 ft altitude grid around the Roll-in (linear interpolation; the interpolation error is far
  // below 1e-6 kt). The exact conversion costs most of the solve otherwise.
  const gridTop = initialAltitudeMslFt + TAS_GRID_ABOVE_FT;
  const gridValues = new Float64Array(TAS_GRID_POINTS);
  for (let i = 0; i < TAS_GRID_POINTS; i += 1) gridValues[i] = exactTasFps(gridTop - i * TAS_GRID_STEP_FT);
  const tasFpsAt = (altitudeMslFt) => {
    const x = (gridTop - altitudeMslFt) / TAS_GRID_STEP_FT;
    const i = Math.floor(x);
    if (!(i >= 0 && i < TAS_GRID_POINTS - 1)) return exactTasFps(altitudeMslFt);
    const f = x - i;
    return gridValues[i] + (gridValues[i + 1] - gridValues[i]) * f;
  };
  function derivativeInto(out, s, c) {
    const altitude = s[2];
    const gamma = s[3];
    const heading = s[4];
    if (Math.abs(gamma) >= VERTICAL_LIMIT_RAD) throw new RollInSolveError("VERTICAL", "Roll-in path reaches the vertical");
    const v = tasFpsAt(altitude);
    const bank = c.bankRad ?? s[5];
    const cosG = Math.cos(gamma);
    const headingRate = (G_FTPS2 * c.loadFactor * Math.sin(bank)) / (v * cosG);
    out[0] = v * cosG * Math.cos(heading);
    out[1] = v * cosG * Math.sin(heading);
    out[2] = v * Math.sin(gamma);
    out[3] = (G_FTPS2 / v) * (c.loadFactor * Math.cos(bank) - cosG);
    out[4] = headingRate;
    out[5] = c.bankRad === undefined ? headingRate * Math.sin(gamma) : 0;
    return out;
  }
  const derivative = (s, c) => derivativeInto(new Array(6), s, c);
  // Classic RK4 on scratch arrays; only the returned state is allocated.
  const k1 = new Float64Array(6);
  const k2 = new Float64Array(6);
  const k3 = new Float64Array(6);
  const k4 = new Float64Array(6);
  const tmp = new Float64Array(6);
  function rk4(s, controls, tau, dt) {
    derivativeInto(k1, s, controls(tau, s));
    for (let i = 0; i < 6; i += 1) tmp[i] = s[i] + (dt / 2) * k1[i];
    derivativeInto(k2, tmp, controls(tau + dt / 2, tmp));
    for (let i = 0; i < 6; i += 1) tmp[i] = s[i] + (dt / 2) * k2[i];
    derivativeInto(k3, tmp, controls(tau + dt / 2, tmp));
    for (let i = 0; i < 6; i += 1) tmp[i] = s[i] + dt * k3[i];
    derivativeInto(k4, tmp, controls(tau + dt, tmp));
    const next = new Array(6);
    for (let i = 0; i < 6; i += 1) next[i] = s[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    const c = controls(tau + dt, next);
    if (c.bankRad !== undefined) next[5] = c.bankRad;
    return next;
  }
  // Integrates one phase from s; onStep(tauEnd, state, controls) after each step.
  function phase(s, durationSec, controls, onStep) {
    let state = s;
    for (let tau = 0; durationSec - tau > 1e-12;) {
      const dt = Math.min(STEP_SEC, durationSec - tau);
      state = rk4(state, controls, tau, dt);
      tau += dt;
      onStep?.(tau, state, controls(tau, state));
    }
    return state;
  }
  return { tasFpsAt, derivative, rk4, phase, initialState: [0, 0, initialAltitudeMslFt, 0, 0, 0] };
}

// Slice-turn (technique B) phases for one Roll-in Bank; the hold is integrated step by step so the roll-out
// start can be placed anywhere inside it.
function sliceTurnPlan(dyn, onset, { bankRad, loadFactor, diveRad }) {
  const rollRate = onset.rollInRollRateDegSec * DEG;
  const rollSec = bankRad / rollRate;
  const pullSec = (loadFactor - 1) / onset.gOnsetRateGSec;
  const rollControls = (tau) => ({ loadFactor: 1, bankRad: Math.min(bankRad, rollRate * tau) });
  const pullControls = (tau) => ({ loadFactor: Math.min(loadFactor, 1 + onset.gOnsetRateGSec * tau) });
  const holdControls = () => ({ loadFactor });
  const rollOutPhase = (start) => {
    const startBank = start[5];
    const rollOutSec = Math.abs(startBank) / (onset.rollOutRollRateDegSec * DEG);
    const nEnd = Math.cos(diveRad);
    return {
      rollOutSec,
      startBank,
      controls: (tau) => {
        const x = rollOutSec > 0 ? Math.min(1, tau / rollOutSec) : 1;
        return { loadFactor: loadFactor + (nEnd - loadFactor) * x, bankRad: startBank * (1 - x) };
      },
    };
  };
  return { rollSec, pullSec, rollControls, pullControls, holdControls, rollOutPhase };
}

// For one Roll-in Bank: the hold time that ends the roll-out on heading change = Angle Off.
function solveHoldForBank(dyn, onset, target, bankRad) {
  const plan = sliceTurnPlan(dyn, onset, { bankRad, loadFactor: target.loadFactor, diveRad: target.diveRad });
  let s = dyn.phase(dyn.initialState, plan.rollSec, plan.rollControls);
  s = dyn.phase(s, plan.pullSec, plan.pullControls);
  const holdStart = s;
  const rollOutEnd = (start) => {
    const ro = plan.rollOutPhase(start);
    return { end: dyn.phase(start, ro.rollOutSec, ro.controls), ro };
  };
  const atZero = rollOutEnd(holdStart);
  if (atZero.end[4] > target.angleOffRad + HEADING_TOLERANCE_RAD) {
    return { failure: "ONSET_OVERSHOOT" };
  }
  // Hold states every step until the heading reaches Angle Off (the roll-out only adds heading).
  const holds = [{ t: 0, s: holdStart }];
  let state = holdStart;
  let t = 0;
  while (state[4] < target.angleOffRad) {
    state = dyn.rk4(state, plan.holdControls, 0, STEP_SEC);
    t += STEP_SEC;
    holds.push({ t, s: state });
    if (t > 600) return { failure: "NO_TURN" };
  }
  const stateAt = (holdSec) => {
    const i = Math.min(holds.length - 1, Math.floor(holdSec / STEP_SEC + 1e-9));
    const base = holds[i];
    const dt = holdSec - base.t;
    return dt > 1e-12 ? dyn.rk4(base.s, plan.holdControls, 0, dt) : base.s;
  };
  const headingError = (holdSec) => {
    const r = rollOutEnd(stateAt(holdSec));
    return { error: r.end[4] - target.angleOffRad, ...r };
  };
  // The roll-out adds about the same heading wherever it starts, so the first guess is where the hold heading
  // reaches Angle Off minus the zero-hold roll-out increment; then Newton with the hold turn rate as the slope,
  // kept inside [0, t] by bisection when a step leaves the bracket.
  const rollOutIncrement = atZero.end[4] - holdStart[4];
  const aim = target.angleOffRad - rollOutIncrement;
  let k = holds.findIndex((h) => h.s[4] >= aim);
  if (k < 0) k = holds.length - 1;
  let holdSec;
  if (k === 0) holdSec = 0;
  else {
    const a = holds[k - 1];
    const b = holds[k];
    holdSec = a.t + ((aim - a.s[4]) / (b.s[4] - a.s[4])) * (b.t - a.t);
  }
  let lo = 0;
  let hi = t;
  let best = { holdSec: 0, ...atZero, error: atZero.end[4] - target.angleOffRad };
  for (let i = 0; i < 60; i += 1) {
    const start = stateAt(holdSec);
    const r = rollOutEnd(start);
    const error = r.end[4] - target.angleOffRad;
    if (Math.abs(error) < Math.abs(best.error)) best = { holdSec, ...r, error };
    if (Math.abs(error) <= HEADING_TOLERANCE_RAD || hi - lo <= 1e-12) break;
    if (error > 0) hi = holdSec; else lo = holdSec;
    const rate = dyn.derivative(start, plan.holdControls())[4];
    let next = holdSec - error / rate;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    holdSec = next;
  }
  return { ...best, plan, holdStart };
}

// End-dive error (degrees, + = deeper than Dive) for one Roll-in Bank. A failed bank tells only on which side
// the answer lies: a vertical path or an onset that already passes the Angle Off means "too much bank";
// no turn means "too little".
const FAILURE_SIDE = Object.freeze({ VERTICAL: 1, ONSET_OVERSHOOT: 1, NO_TURN: -1 });

function evaluateBank(dyn, onset, target, bankDeg) {
  rollInSolveStats.bankEvaluations += 1;
  let r;
  try {
    r = solveHoldForBank(dyn, onset, target, bankDeg * DEG);
  } catch (error) {
    if (error instanceof RollInSolveError) return { bankDeg, failure: error.code, side: FAILURE_SIDE[error.code] ?? 1 };
    throw error;
  }
  if (r.failure) return { bankDeg, failure: r.failure, side: FAILURE_SIDE[r.failure] ?? 1 };
  const diveErrorDeg = (-r.end[3] - target.diveRad) / DEG;
  return { ...r, bankDeg, diveErrorDeg, side: diveErrorDeg > 0 ? 1 : -1 };
}

const BANK_MIN_DEG = 1;
const BANK_MAX_DEG = 179;
const FAILURE_BRACKET_DEG = 0.05;

// The end dive deepens with the Roll-in Bank: bracket by stepping out from a guess, then Illinois, with
// bisection whenever a bracket end is a failure (no error value to interpolate). The guess is a fixed rule
// or the caller's bankHintDeg; no state is kept between calls, so the same input (and hint) always takes the
// same path to the same bits (Offset relies on that).
function solveSliceTurn(dyn, onset, target, bankHintDeg) {
  const hinted = typeof bankHintDeg === "number" && bankHintDeg > BANK_MIN_DEG && bankHintDeg < BANK_MAX_DEG;
  const guess = hinted ? bankHintDeg : Math.min(170, 102 + target.diveRad / DEG / 2);
  const evalAt = (b) => evaluateBank(dyn, onset, target, b);
  const failures = new Set();
  let lo = null; // highest bank known to be too shallow (side −1)
  let hi = null; // lowest bank known to be too deep (side +1)
  const record = (e) => {
    if (e.failure) failures.add(e.failure);
    if (e.side < 0 && (!lo || e.bankDeg > lo.bankDeg)) lo = e;
    if (e.side > 0 && (!hi || e.bankDeg < hi.bankDeg)) hi = e;
    return e;
  };
  record(evalAt(guess));
  for (let step = hinted ? 0.5 : 6; (!lo || !hi) && step < 512; step *= 2) {
    if (!lo) {
      const b = Math.max(BANK_MIN_DEG, (hi ? hi.bankDeg : guess) - step);
      record(evalAt(b));
      if (!lo && b === BANK_MIN_DEG) break;
    }
    if (!hi) {
      const b = Math.min(BANK_MAX_DEG, (lo ? lo.bankDeg : guess) + step);
      record(evalAt(b));
      if (!hi && b === BANK_MAX_DEG) break;
    }
  }
  const noSolution = () => {
    if (failures.has("ONSET_OVERSHOOT")) {
      return new RollInSolveError("ONSET_OVERSHOOT", "Roll-in onsets alone turn past the Angle Off (Angle Off too small for the roll and G onset rates)");
    }
    return new RollInSolveError("NO_SOLUTION", "No Roll-in Bank reaches the Dive Angle at this Angle Off with these onsets (Angle Off too small for the Dive and Roll-in G)");
  };
  if (!lo || !hi) throw noSolution();
  let best = null;
  const consider = (e) => {
    if (!e.failure && (!best || Math.abs(e.diveErrorDeg) < Math.abs(best.diveErrorDeg))) best = e;
  };
  consider(lo);
  consider(hi);
  let fLo = lo.failure ? null : lo.diveErrorDeg;
  let fHi = hi.failure ? null : hi.diveErrorDeg;
  let lastSide = 0;
  for (let i = 0; i < 100; i += 1) {
    if (best && Math.abs(best.diveErrorDeg) <= DIVE_TOLERANCE_RAD / DEG) break;
    if (hi.bankDeg - lo.bankDeg <= 1e-11) break;
    // A bracket narrower than 0.05° whose ends are both still more than 0.5° of dive from the Dive Angle (a
    // failed bank, or a jump in the end dive where the roll-out start changes branch) holds no solution. A
    // continuous end dive changes by about 1° of dive per degree of bank, far less across such a bracket.
    if (hi.bankDeg - lo.bankDeg < FAILURE_BRACKET_DEG) {
      const gapDeg = Math.min(lo.failure ? Infinity : Math.abs(lo.diveErrorDeg), hi.failure ? Infinity : Math.abs(hi.diveErrorDeg));
      if (gapDeg > 0.5) break;
    }
    let b = (lo.bankDeg + hi.bankDeg) / 2;
    if (fLo !== null && fHi !== null) {
      const x = hi.bankDeg - (fHi * (hi.bankDeg - lo.bankDeg)) / (fHi - fLo);
      if (x > lo.bankDeg && x < hi.bankDeg) b = x;
    }
    const e = record(evalAt(b));
    consider(e);
    if (e.side > 0) {
      fHi = e.failure ? null : e.diveErrorDeg;
      if (lastSide === 1 && fLo !== null) fLo /= 2;
      lastSide = 1;
    } else {
      fLo = e.failure ? null : e.diveErrorDeg;
      if (lastSide === -1 && fHi !== null) fHi /= 2;
      lastSide = -1;
    }
  }
  if (!best || Math.abs(best.diveErrorDeg) > 1e-6) throw noSolution();
  return best;
}

// Level turn with onsets (Dive < 10°): bank acos(1/G) at the Roll-in Rate, G at the G Onset Rate, hold, roll-out
// at the Roll-out Rate with G back to 1. Horizontal turn rate g·n·sin(bank)/V; altitude and speed held.
function solveLevelTurn(dyn, onset, target) {
  const bankRad = Math.acos(1 / target.loadFactor);
  const v = dyn.tasFpsAt(dyn.initialState[2]);
  const levelDynamics = (s, c) => {
    const bank = c.bankRad;
    return [v * Math.cos(s[4]), v * Math.sin(s[4]), 0, 0, (G_FTPS2 * c.loadFactor * Math.sin(bank)) / v, 0];
  };
  const level = { ...dyn, derivative: levelDynamics };
  level.rk4 = (s, controls, tau, dt) => {
    const add = (k, a) => s.map((value, i) => value + a * k[i]);
    const k1 = levelDynamics(s, controls(tau, s));
    const k2 = levelDynamics(add(k1, dt / 2), controls(tau + dt / 2));
    const k3 = levelDynamics(add(k2, dt / 2), controls(tau + dt / 2));
    const k4 = levelDynamics(add(k3, dt), controls(tau + dt));
    const next = s.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    next[5] = controls(tau + dt).bankRad;
    return next;
  };
  level.phase = (s, durationSec, controls, onStep) => {
    let state = s;
    for (let tau = 0; durationSec - tau > 1e-12;) {
      const dt = Math.min(STEP_SEC, durationSec - tau);
      state = level.rk4(state, controls, tau, dt);
      tau += dt;
      onStep?.(tau, state, controls(tau));
    }
    return state;
  };
  const rollRate = onset.rollInRollRateDegSec * DEG;
  const rollSec = bankRad / rollRate;
  const pullSec = (target.loadFactor - 1) / onset.gOnsetRateGSec;
  const rollOutSec = bankRad / (onset.rollOutRollRateDegSec * DEG);
  const controls = {
    roll: (tau) => ({ loadFactor: 1, bankRad: Math.min(bankRad, rollRate * tau) }),
    pull: (tau) => ({ loadFactor: Math.min(target.loadFactor, 1 + onset.gOnsetRateGSec * tau), bankRad }),
    hold: () => ({ loadFactor: target.loadFactor, bankRad }),
    rollOut: (tau) => {
      const x = Math.min(1, tau / rollOutSec);
      return { loadFactor: target.loadFactor + (1 - target.loadFactor) * x, bankRad: bankRad * (1 - x) };
    },
  };
  let s = level.phase(dyn.initialState, rollSec, controls.roll);
  s = level.phase(s, pullSec, controls.pull);
  const holdStart = s;
  const endAt = (holdSec) => level.phase(level.phase(holdStart, holdSec, controls.hold), rollOutSec, controls.rollOut);
  const atZero = endAt(0);
  if (atZero[4] > target.angleOffRad + HEADING_TOLERANCE_RAD) {
    throw new RollInSolveError("ONSET_OVERSHOOT", "Roll-in onsets alone turn past the Angle Off (Angle Off too small for the roll and G onset rates)");
  }
  // Heading during the hold is linear in time, so one correction is exact up to integration error.
  const holdRate = (G_FTPS2 * target.loadFactor * Math.sin(bankRad)) / v;
  let holdSec = (target.angleOffRad - atZero[4]) / holdRate;
  for (let i = 0; i < 4; i += 1) holdSec -= (endAt(holdSec)[4] - target.angleOffRad) / holdRate;
  return { level, controls, rollSec, pullSec, holdSec, rollOutSec, bankRad, holdStart };
}

// Re-flies the solved Roll-in and records 0.1 s samples and the result in the v0.1 contract plus v0.2 fields.
export function integrateRollInV0_2(params, initialAltitudeMslFt) {
  rollInSolveStats.solves += 1;
  const onset = onsetFrom(params);
  if (!(params.rollInG > 1 && params.rollInG <= 9)) throw new RangeError("rollInG must be > 1 and <= 9");
  if (!(params.angleOffDeg > 0 && params.angleOffDeg < 180)) throw new RangeError("angleOffDeg must be > 0 and < 180");
  const levelTurn = isLevelTurnRollIn(params.diveAngleDeg);
  const dyn = createDynamics(params, initialAltitudeMslFt);
  const target = { loadFactor: params.rollInG, diveRad: params.diveAngleDeg * DEG, angleOffRad: params.angleOffDeg * DEG };
  const samples = [];
  const sample = (t, s, c, phase) => samples.push({ t, s: s.slice(), loadFactor: c.loadFactor, phase });
  let phases;
  let bankRad;
  let integrate;
  if (levelTurn) {
    const sol = solveLevelTurn(dyn, onset, target);
    bankRad = sol.bankRad;
    phases = [
      ["roll", sol.rollSec, sol.controls.roll],
      ["pull", sol.pullSec, sol.controls.pull],
      ["hold", sol.holdSec, sol.controls.hold],
      ["rollOut", sol.rollOutSec, sol.controls.rollOut],
    ];
    integrate = sol.level.phase;
  } else {
    const sol = solveSliceTurn(dyn, onset, target, params.bankHintDeg);
    bankRad = sol.bankDeg * DEG;
    phases = [
      ["roll", sol.plan.rollSec, sol.plan.rollControls],
      ["pull", sol.plan.pullSec, sol.plan.pullControls],
      ["hold", sol.holdSec, sol.plan.holdControls],
      ["rollOut", null, null],
    ];
    integrate = dyn.phase;
  }
  // Fly the solution once and keep every step.
  let s = dyn.initialState.slice();
  let t = 0;
  sample(0, s, { loadFactor: 1 }, "roll");
  const phaseTimes = {};
  let bankAtRollOutStartRad = null;
  for (const [name, durationSec, controls] of phases) {
    let duration = durationSec;
    let phaseControls = controls;
    if (name === "rollOut" && !levelTurn) {
      const plan = sliceTurnPlan(dyn, onset, { bankRad, loadFactor: target.loadFactor, diveRad: target.diveRad }).rollOutPhase(s);
      duration = plan.rollOutSec;
      phaseControls = plan.controls;
    }
    if (name === "rollOut") bankAtRollOutStartRad = s[5];
    const t0 = t;
    s = integrate(s, duration, phaseControls, (tau, state, c) => sample(t0 + tau, state, c, name));
    t = t0 + duration;
    phaseTimes[name] = duration;
  }
  const end = s;
  if (Math.abs(end[4] - target.angleOffRad) > 1e-7) throw new RollInSolveError("NO_SOLUTION", "Roll-in did not end on the Angle Off");
  const tasKtAt = (alt) => dyn.tasFpsAt(alt) / KT_TO_FPS;
  // Ground arc along the integration steps; samples on the exact 0.1 s grid (linear between steps) plus the
  // Track Point, as in v0.1.
  let groundArcFt = 0;
  let spatialArcFt = 0;
  let maxDiveRad = 0;
  const out = [];
  const pushSample = (tSec, st, loadFactor, phase, arcFt) => out.push({
    t: tSec,
    groundArcFt: arcFt,
    altitudeLossFt: levelTurn ? 0 : initialAltitudeMslFt - st[2],
    forwardFt: st[0],
    turnSideFt: st[1],
    headingChangeRad: st[4],
    bankDeg: st[5] / DEG,
    fpaDeg: st[3] / DEG,
    loadFactor,
    tasKt: tasKtAt(st[2]),
    phase,
  });
  pushSample(0, samples[0].s, 1, "roll", 0);
  let nextGridIndex = 1;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const ground = Math.hypot(cur.s[0] - prev.s[0], cur.s[1] - prev.s[1]);
    while (nextGridIndex * SAMPLE_SEC <= cur.t + 1e-9 && nextGridIndex * SAMPLE_SEC < t - 1e-9) {
      const g = nextGridIndex * SAMPLE_SEC;
      const f = cur.t > prev.t ? Math.min(1, Math.max(0, (g - prev.t) / (cur.t - prev.t))) : 1;
      const st = prev.s.map((value, k) => value + (cur.s[k] - value) * f);
      pushSample(g, st, prev.loadFactor + (cur.loadFactor - prev.loadFactor) * f, cur.phase, groundArcFt + ground * f);
      nextGridIndex += 1;
    }
    groundArcFt += ground;
    spatialArcFt += Math.hypot(ground, cur.s[2] - prev.s[2]);
    maxDiveRad = Math.max(maxDiveRad, -cur.s[3]);
  }
  const lastStep = samples[samples.length - 1];
  pushSample(t, lastStep.s, lastStep.loadFactor, lastStep.phase, groundArcFt);
  const altitudeLossFt = initialAltitudeMslFt - end[2];
  const rollInTimeSec = t;
  const finalHeadingRad = target.angleOffRad;
  const xFt = end[0];
  const yFt = end[1];
  const rollInBankAngleDeg = bankRad / DEG;
  return {
    model: ROLL_IN_V0_2_MODEL,
    mode: levelTurn ? "LEVEL_TURN" : "SLICE_TURN",
    onset,
    rollInBankAngleDeg,
    phaseTimesSec: {
      roll: phaseTimes.roll,
      pull: phaseTimes.pull,
      hold: phaseTimes.hold,
      rollOut: phaseTimes.rollOut,
    },
    bankAtRollOutStartDeg: Math.abs(bankAtRollOutStartRad) / DEG,
    maxDiveDeg: maxDiveRad / DEG,
    largeBankWarning: rollInBankAngleDeg > ROLL_IN_LARGE_BANK_WARNING_DEG,
    initialTasKt: tasKtAt(initialAltitudeMslFt),
    finalTasKt: tasKtAt(end[2]),
    finalDiveAngleDeg: params.diveAngleDeg,
    rollInTimeSec,
    displacementForwardFt: xFt,
    displacementTurnSideFt: yFt,
    finalAttackAxisForwardFt: xFt * Math.cos(finalHeadingRad) + yFt * Math.sin(finalHeadingRad),
    finalAttackAxisLateralFt: Math.abs(-xFt * Math.sin(finalHeadingRad) + yFt * Math.cos(finalHeadingRad)),
    altitudeLossFt: levelTurn ? 0 : altitudeLossFt,
    groundArcFt,
    spatialArcFt,
    equivalentRadiusFt: groundArcFt / target.angleOffRad,
    averageTurnRateDegSec: params.angleOffDeg / rollInTimeSec,
    dynamicFinalDiveDeg: levelTurn ? 0 : -end[3] / DEG,
    samples: out,
  };
}
