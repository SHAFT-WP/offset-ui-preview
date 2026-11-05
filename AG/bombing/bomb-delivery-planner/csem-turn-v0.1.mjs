// CSEM turn v0.1 (owner 2026-11-03 / 2026-11-04, BDP SPEC §6.10): what a CSEM flies after its End (the Target
// FPA reached, G released linearly from the +20° gate). "10000피트에서 level이 되도록 90도 뱅크 2g turn 실시
// ip-to 타겟 헤딩의 반대방향으로 평행하게 비행"; the level altitude was then set to 12,000 ft ("단거리 대공망 유효
// 레인지 경계"), taken as AGL above the Target and kept an input.
//   1 Climb straight at the Target FPA (1 G along the path's normal, cos FPA),
//   2 roll to the slice bank (90°) at the Roll-in Rate at 1 G, pull to the turn G (2 G) at the G Onset Rate,
//   3 hold bank and G: the nose slices down to the horizon while the heading turns,
//   4 at FPA 0 the aircraft is level at the Level Altitude: a level turn at the same G (bank acos(1/G)) to the
//     heading change asked (the Run-In reciprocal for Offset), then a roll-out at the Roll-out Rate, wings level.
// The climb length (1) is solved so the slice reaches FPA 0 exactly at the Level Altitude. When even a slice right
// at the CSEM End levels above it, the slice starts there and the result carries LEVEL_ABOVE_TARGET. When the
// slice has already turned past the heading asked at FPA 0, the aircraft rolls straight out (HEADING_OVERSHOOT).
// Energy-neutral point mass like the CSEM core (no thrust / drag; speed changes only with height). Mechanism
// only: the consumer places the turn (start time, side, wind). Display and check only.
export const CSEM_TURN_MODEL_V0_1 = Object.freeze({
  id: "bdp-csem-turn-v0.1",
  version: "0.1.0",
  defaultLevelAltitudeAglFt: 12000,
  defaultLoadFactorG: 2,
  defaultSliceBankDeg: 90,
  minSpeedKt: 120,
  maxClimbSec: 600,
  stepSec: 0.05,
  sampleIntervalSec: 0.1,
});

const G = 32.174;
const KT = 1.687809857;
const DEG = Math.PI / 180;
const STEP = CSEM_TURN_MODEL_V0_1.stepSec;
const SAMPLE = CSEM_TURN_MODEL_V0_1.sampleIntervalSec;
const MIN_V = CSEM_TURN_MODEL_V0_1.minSpeedKt * KT;
const MAX_PHASE_SEC = 300;

export function csemTurnError(codes) {
  const error = new RangeError(`CSEM turn: ${codes.join(", ")}`);
  error.semErrors = [...codes];
  return error;
}

// State [forwardFt, turnSideFt, altitudeMslFt, fpaRad, headingRad, tasFps].
function derivativeInto(out, s, c) {
  const v = s[5];
  const cosG = Math.cos(s[3]);
  out[0] = v * cosG * Math.cos(s[4]);
  out[1] = v * cosG * Math.sin(s[4]);
  if (c.levelHold) {
    out[2] = 0; out[3] = 0; out[5] = 0;
  } else {
    out[2] = v * Math.sin(s[3]);
    out[3] = (G * (c.n * Math.cos(c.bank) - cosG)) / v;
    out[5] = -G * Math.sin(s[3]);
  }
  out[4] = (G * c.n * Math.sin(c.bank)) / (v * cosG);
}
const N = 6;
const K1 = new Float64Array(N), K2 = new Float64Array(N), K3 = new Float64Array(N), K4 = new Float64Array(N), TMP = new Float64Array(N);
function rk4(s, controls, tau, dt) {
  derivativeInto(K1, s, controls(tau));
  for (let i = 0; i < N; i += 1) TMP[i] = s[i] + (dt / 2) * K1[i];
  derivativeInto(K2, TMP, controls(tau + dt / 2));
  for (let i = 0; i < N; i += 1) TMP[i] = s[i] + (dt / 2) * K2[i];
  derivativeInto(K3, TMP, controls(tau + dt / 2));
  for (let i = 0; i < N; i += 1) TMP[i] = s[i] + dt * K3[i];
  derivativeInto(K4, TMP, controls(tau + dt));
  const next = new Float64Array(N);
  for (let i = 0; i < N; i += 1) next[i] = s[i] + (dt / 6) * (K1[i] + 2 * K2[i] + 2 * K3[i] + K4[i]);
  if (!(next[5] >= MIN_V)) throw csemTurnError(["CSEM_TURN_SPEED_TOO_LOW"]);
  return next;
}

// The straight climb at FPA γ for t seconds, closed form (V' = −g·sinγ).
function climbState(start, t) {
  const sinG = Math.sin(start[3]);
  const v = start[5] - G * sinG * t;
  if (!(v >= MIN_V)) throw csemTurnError(["CSEM_TURN_SPEED_TOO_LOW"]);
  const path = start[5] * t - 0.5 * G * sinG * t * t;
  return Float64Array.of(start[0] + path * Math.cos(start[3]), start[1], start[2] + path * sinG, start[3], start[4], v);
}

// One phase of fixed length, or until the FPA reaches 0 (stopAtLevel): returns { state, tau, levelReached }.
function phase(s, controls, durationSec, { stopAtLevel = false, onStep = null } = {}) {
  if (!(durationSec > 0)) return { state: s, tau: 0, levelReached: stopAtLevel && s[3] <= 0 };
  const steps = Math.max(1, Math.ceil(durationSec / STEP - 1e-9));
  const dt = durationSec / steps;
  let state = s;
  for (let i = 0; i < steps; i += 1) {
    const next = rk4(state, controls, i * dt, dt);
    if (stopAtLevel && next[3] <= 0) {
      // The crossing by secant steps on a partial step from the last state above level.
      let a = 0, fa = state[3], b = dt, fb = next[3], end = next;
      for (let k = 0; k < 10 && Math.abs(fb) > 1e-12; k += 1) {
        const x = b - (fb * (b - a)) / (fb - fa);
        end = rk4(state, controls, i * dt, x);
        a = b; fa = fb; b = x; fb = end[3];
      }
      end[3] = 0;
      onStep?.(i * dt + b, end, controls(i * dt + b));
      return { state: end, tau: i * dt + b, levelReached: true };
    }
    state = next;
    onStep?.((i + 1) * dt, state, controls((i + 1) * dt));
  }
  return { state, tau: durationSec, levelReached: false };
}

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function calculateCsemTurn({
  startAltitudeMslFt,
  startTasKt,
  startFpaDeg,
  startTimeSec = 0,
  levelAltitudeMslFt,
  headingChangeDeg,
  loadFactorG = CSEM_TURN_MODEL_V0_1.defaultLoadFactorG,
  sliceBankDeg = CSEM_TURN_MODEL_V0_1.defaultSliceBankDeg,
  rollInRollRateDegSec,
  rollOutRollRateDegSec,
  gOnsetRateGSec,
}) {
  [["startAltitudeMslFt", startAltitudeMslFt], ["startTasKt", startTasKt], ["startFpaDeg", startFpaDeg], ["startTimeSec", startTimeSec],
    ["levelAltitudeMslFt", levelAltitudeMslFt], ["headingChangeDeg", headingChangeDeg], ["loadFactorG", loadFactorG], ["sliceBankDeg", sliceBankDeg]]
    .forEach(([name, value]) => finite(name, value));
  const onset = { rollInRollRateDegSec, rollOutRollRateDegSec, gOnsetRateGSec };
  for (const [name, value] of Object.entries(onset)) if (!(finite(name, value) > 0)) throw new RangeError(`${name} must be > 0`);
  const errors = [];
  if (!(startFpaDeg > 0 && startFpaDeg < 90)) errors.push("CSEM_TURN_START_FPA_OUT_OF_RANGE");
  if (!(headingChangeDeg >= 0 && headingChangeDeg <= 360)) errors.push("CSEM_TURN_OUT_OF_RANGE");
  if (!(loadFactorG > 1 && loadFactorG <= 9)) errors.push("CSEM_TURN_G_OUT_OF_RANGE");
  if (!(sliceBankDeg > 0 && sliceBankDeg <= 150)) errors.push("CSEM_TURN_BANK_OUT_OF_RANGE");
  if (errors.length) throw csemTurnError(errors);

  const bank = sliceBankDeg * DEG;
  const levelBank = Math.acos(1 / loadFactorG);
  const theta = headingChangeDeg * DEG;
  const rollSec = bank / (rollInRollRateDegSec * DEG);
  const pullSec = (loadFactorG - 1) / gOnsetRateGSec;
  const rate = rollOutRollRateDegSec * DEG;
  const controls = {
    climb: () => ({ bank: 0, n: Math.cos(startFpaDeg * DEG) }),
    roll: (tau) => ({ bank: bank * Math.min(1, tau / rollSec), n: 1 }),
    pull: (tau) => ({ bank, n: 1 + (loadFactorG - 1) * Math.min(1, tau / pullSec) }),
    hold: () => ({ bank, n: loadFactorG }),
    // Level from FPA 0 (altitude and speed held): the bank goes to the level-turn bank, or straight to wings level.
    toLevelBank: (fromBank) => (tau) => ({ bank: fromBank + (levelBank - fromBank) * Math.min(1, (tau * rate) / Math.abs(levelBank - fromBank || 1)), n: loadFactorG, levelHold: true }),
    levelTurn: () => ({ bank: levelBank, n: loadFactorG, levelHold: true }),
    rollOut: (fromBank, fromN) => (tau) => {
      const x = Math.min(1, (tau * rate) / fromBank);
      return { bank: fromBank * (1 - x), n: fromN + (1 - fromN) * x, levelHold: true };
    },
  };
  const start = Float64Array.of(0, 0, startAltitudeMslFt, startFpaDeg * DEG, 0, startTasKt * KT);

  // The slice from a climb of t seconds, up to FPA 0.
  const slice = (climbSec, onStep = null) => {
    let s = climbState(start, climbSec);
    const record = (name, tau0) => (onStep ? (tau, st, c) => onStep(name, tau0 + tau, st, c) : null);
    let tau0 = climbSec;
    let r = phase(s, controls.roll, rollSec, { stopAtLevel: true, onStep: record("turn-roll", tau0) });
    tau0 += r.tau;
    if (!r.levelReached) {
      r = phase(r.state, controls.pull, pullSec, { stopAtLevel: true, onStep: record("turn-pull", tau0) });
      tau0 += r.tau;
    }
    if (!r.levelReached) {
      r = phase(r.state, controls.hold, MAX_PHASE_SEC, { stopAtLevel: true, onStep: record("turn-hold", tau0) });
      tau0 += r.tau;
      if (!r.levelReached) throw csemTurnError(["CSEM_TURN_NO_LEVEL_OFF"]);
    }
    return { state: r.state, tau: tau0 };
  };

  // Climb length so the slice levels at the Level Altitude.
  const levelOffAt = (climbSec) => slice(climbSec).state[2] - levelAltitudeMslFt;
  let climbSec = 0;
  let levelAboveTarget = false;
  const f0 = levelOffAt(0);
  if (f0 >= 0) levelAboveTarget = f0 > 0.5;
  else {
    let lo = 0, flo = f0, hi = 10, fhi;
    for (;;) {
      if (hi > CSEM_TURN_MODEL_V0_1.maxClimbSec) throw csemTurnError(["CSEM_TURN_LEVEL_ALTITUDE_NOT_REACHED"]);
      try { fhi = levelOffAt(hi); } catch (error) {
        if (error.semErrors?.includes("CSEM_TURN_SPEED_TOO_LOW")) throw csemTurnError(["CSEM_TURN_LEVEL_ALTITUDE_NOT_REACHED"]);
        throw error;
      }
      if (fhi >= 0) break;
      lo = hi; flo = fhi; hi *= 2;
    }
    let side = 0;
    for (let i = 0; i < 80 && hi - lo > 1e-9; i += 1) {
      const x = (lo * fhi - hi * flo) / (fhi - flo);
      const fx = levelOffAt(x);
      if (Math.abs(fx) < 1e-4) { lo = hi = x; break; }
      if (fx > 0) { hi = x; fhi = fx; if (side === 1) flo /= 2; side = 1; } else { lo = x; flo = fx; if (side === -1) fhi /= 2; side = -1; }
    }
    climbSec = (lo + hi) / 2;
  }

  // The flight, recorded.
  const trace = [{ tau: 0, s: start, bank: 0, n: Math.cos(start[3]), phase: "turn-climb" }];
  if (climbSec > 0) {
    // The straight climb is closed form: a few points along it (1 s apart) for the grid samples.
    const pieces = Math.max(1, Math.ceil(climbSec));
    for (let i = 1; i <= pieces; i += 1) {
      const t = (climbSec * i) / pieces;
      trace.push({ tau: t, s: climbState(start, t), bank: 0, n: Math.cos(start[3]), phase: "turn-climb" });
    }
  }
  const sliced = slice(climbSec, (name, tau, s, c) => trace.push({ tau, s, bank: c.bank, n: c.n, phase: name }));
  let s = sliced.state;
  let tau0 = sliced.tau;
  const levelOff = { tau: tau0, altitudeMslFt: s[2], headingChangeDeg: s[4] / DEG, tasKt: s[5] / KT };
  const push = (name) => (tau, st, c) => trace.push({ tau: tau0 + tau, s: st, bank: c.bank, n: c.n, phase: name });
  const bankAtLevel = trace[trace.length - 1].bank;
  const nAtLevel = trace[trace.length - 1].n;
  // Heading a roll-out from (bank, n) adds at the held speed.
  const rollOutGain = (fromBank, fromN, st) => phase(st, controls.rollOut(fromBank, fromN), fromBank / rate).state[4] - st[4];
  const toLevelSec = Math.abs(levelBank - bankAtLevel) / rate;
  let mode = "TO_HEADING";
  const viaLevel = phase(s, controls.toLevelBank(bankAtLevel), toLevelSec).state;
  const remaining = theta - viaLevel[4] - rollOutGain(levelBank, loadFactorG, viaLevel);
  if (remaining >= 0) {
    let r = phase(s, controls.toLevelBank(bankAtLevel), toLevelSec, { onStep: push("turn-level") });
    tau0 += r.tau; s = r.state;
    const holdSec = remaining / ((G * Math.sqrt(loadFactorG * loadFactorG - 1)) / s[5]);
    r = phase(s, controls.levelTurn, holdSec, { onStep: push("turn-level") });
    tau0 += r.tau; s = r.state;
    r = phase(s, controls.rollOut(levelBank, loadFactorG), levelBank / rate, { onStep: push("turn-rollout") });
    tau0 += r.tau; s = r.state;
  } else {
    // Turned past the heading asked by FPA 0: wings level straight away.
    mode = "HEADING_OVERSHOOT";
    const r = phase(s, controls.rollOut(bankAtLevel, nAtLevel), bankAtLevel / rate, { onStep: push("turn-rollout") });
    tau0 += r.tau; s = r.state;
  }

  const sampleOf = (e) => ({
    timeSec: startTimeSec + e.tau,
    forwardFt: e.s[0],
    turnSideFt: e.s[1],
    altitudeMslFt: e.s[2],
    fpaDeg: e.s[3] / DEG,
    headingChangeDeg: e.s[4] / DEG,
    bankDeg: e.bank / DEG,
    loadFactorG: e.n,
    tasKt: e.s[5] / KT,
    phase: e.phase,
  });
  const lerp = (a, b, f) => ({ tau: a.tau + (b.tau - a.tau) * f, s: a.s.map((v, i) => v + (b.s[i] - v) * f), bank: a.bank + (b.bank - a.bank) * f, n: a.n + (b.n - a.n) * f, phase: b.phase });
  const samples = [sampleOf(trace[0])];
  let k = Math.floor(startTimeSec / SAMPLE + 1e-9) + 1;
  for (let i = 1; i < trace.length; i += 1) {
    const a = trace[i - 1];
    const b = trace[i];
    if (!(b.tau > a.tau)) continue;
    while (startTimeSec + b.tau >= k * SAMPLE - 1e-9) {
      const tGrid = k * SAMPLE - startTimeSec;
      if (tGrid > a.tau + 1e-9 && tGrid < b.tau - 1e-9) samples.push(sampleOf(lerp(a, b, (tGrid - a.tau) / (b.tau - a.tau))));
      k += 1;
    }
    if (i === trace.length - 1 || trace[i + 1].phase !== b.phase) samples.push(sampleOf(b));
  }
  const end = sampleOf(trace[trace.length - 1]);
  return {
    model: { ...CSEM_TURN_MODEL_V0_1 },
    type: "CSEM",
    mode,
    headingChangeDeg,
    flownHeadingChangeDeg: end.headingChangeDeg,
    loadFactorG,
    sliceBankDeg,
    levelBankDeg: levelBank / DEG,
    levelAltitudeMslFt,
    levelOffAltitudeMslFt: levelOff.altitudeMslFt,
    levelAboveTarget,
    climbSec,
    levelOffTimeSec: startTimeSec + levelOff.tau,
    levelOffHeadingChangeDeg: levelOff.headingChangeDeg,
    levelOffTasKt: levelOff.tasKt,
    onset,
    timeSec: tau0,
    end,
    minAltitudeMslFt: Math.min(...trace.map((e) => e.s[2])),
    samples,
  };
}
