// Onset level turn v0.1 (owner 2026-10-15, BDP update R2.1): a coordinated level turn flown with linear rate
// onsets instead of an instantaneous one. Roll at 1 G to the turn bank acos(1/G) at the Roll-in Rate; pull to G
// at the G Onset Rate; hold (a circular arc); roll out at the Roll-out Rate while G goes linearly back to 1.
// Heading rate g·n·sin(bank)/V; TAS and altitude are held. Mechanism only: the consumer chooses the rates,
// the G and the heading change. See SPEC.md "V0.4 onset level turn".

// 0.1.1 (owner 2026-10-15: "어차피 수평 선회라 둘다 적정값으로 줄여야"): a heading change too small for the full
// onsets lowers the turn G and its level-turn bank acos(1/G) together (REDUCED), instead of G first at the full
// bank and then the bank at 1 G.
export const ONSET_LEVEL_TURN_MODEL_V0_1 = Object.freeze({
  id: "fst-onset-level-turn-v0.1",
  version: "0.1.1",
  onsetShape: "LINEAR",
});

const G_FTPS2 = 32.174;
const KNOT_TO_FPS = 1.687809857;
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;
const STEP_SEC = 0.01;
const SAMPLE_SEC = 0.1;
const MAX_HEADING_CHANGE_DEG = 179.5;
const SOLVE_ITERATIONS = 80;

function requirePositive(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  if (!(value > 0)) throw new RangeError(`${name} must be > 0`);
}

// One phase of linear controls: bank and load factor go linearly from (bank0, n0) to (bank1, n1).
function phaseOf(name, durationSec, bank0, bank1, n0, n1) {
  return { name, durationSec, bank0, bank1, n0, n1 };
}

// RK4 on [forwardFt, turnSideFt, headingRad]; the heading rate depends on time only, so the heading part is
// Simpson's rule on each step. Steps never exceed 0.01 s (each phase is split evenly).
function flyPhase(state, phase, vFps, onStep) {
  const { durationSec, bank0, bank1, n0, n1 } = phase;
  if (!(durationSec > 0)) return state;
  const steps = Math.max(1, Math.ceil(durationSec / STEP_SEC - 1e-9));
  const dt = durationSec / steps;
  const rate = (tau) => {
    const x = tau / durationSec;
    const bank = bank0 + (bank1 - bank0) * x;
    const n = n0 + (n1 - n0) * x;
    return (G_FTPS2 * n * Math.sin(bank)) / vFps;
  };
  let [xFt, yFt, psi] = state;
  for (let i = 0; i < steps; i += 1) {
    const tau = i * dt;
    const r1 = rate(tau);
    const r2 = rate(tau + dt / 2);
    const r4 = rate(tau + dt);
    const psi2 = psi + (dt / 2) * r1;
    const psi3 = psi + (dt / 2) * r2;
    const psi4 = psi + dt * r2;
    xFt += (dt / 6) * vFps * (Math.cos(psi) + 2 * Math.cos(psi2) + 2 * Math.cos(psi3) + Math.cos(psi4));
    yFt += (dt / 6) * vFps * (Math.sin(psi) + 2 * Math.sin(psi2) + 2 * Math.sin(psi3) + Math.sin(psi4));
    psi += (dt / 6) * (r1 + 4 * r2 + r4);
    onStep?.(tau + dt, [xFt, yFt, psi]);
  }
  return [xFt, yFt, psi];
}

// Heading change of a phase alone, with the same steps and sums as flyPhase (bit-identical heading).
function phaseHeadingRad(phase, vFps) {
  const { durationSec, bank0, bank1, n0, n1 } = phase;
  if (!(durationSec > 0)) return 0;
  const steps = Math.max(1, Math.ceil(durationSec / STEP_SEC - 1e-9));
  const dt = durationSec / steps;
  const rate = (tau) => {
    const x = tau / durationSec;
    return (G_FTPS2 * (n0 + (n1 - n0) * x) * Math.sin(bank0 + (bank1 - bank0) * x)) / vFps;
  };
  let psi = 0;
  for (let i = 0; i < steps; i += 1) {
    const tau = i * dt;
    psi += (dt / 6) * (rate(tau) + 4 * rate(tau + dt / 2) + rate(tau + dt));
  }
  return psi;
}

function headingChangeOf(phases, vFps) {
  return phases.reduce((sum, phase) => sum + phaseHeadingRad(phase, vFps), 0);
}

// Bisection on a monotone heading change; deterministic and exact to the last bit that matters.
function bisect(lo, hi, headingAt, targetRad) {
  for (let i = 0; i < SOLVE_ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    if (headingAt(mid) > targetRad) hi = mid;
    else lo = mid;
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(hi))) break;
  }
  return (lo + hi) / 2;
}

// The onset phases (no hold) for a peak bank and peak load factor.
function onsetPhases(onset, peakBankRad, peakLoadFactor) {
  const rollRate = onset.rollInRollRateDegSec * DEG;
  const rollOutRate = onset.rollOutRollRateDegSec * DEG;
  return [
    phaseOf("roll", peakBankRad / rollRate, 0, peakBankRad, 1, 1),
    phaseOf("pull", (peakLoadFactor - 1) / onset.gOnsetRateGSec, peakBankRad, peakBankRad, 1, peakLoadFactor),
    phaseOf("rollOut", peakBankRad / rollOutRate, peakBankRad, 0, peakLoadFactor, 1),
  ];
}

export function calculateOnsetLevelTurn({
  tasKt,
  loadFactorG,
  headingChangeDeg,
  rollInRollRateDegSec,
  rollOutRollRateDegSec,
  gOnsetRateGSec,
}) {
  requirePositive("tasKt", tasKt);
  requirePositive("loadFactorG", loadFactorG);
  if (!(loadFactorG > 1)) throw new RangeError("loadFactorG must be > 1");
  requirePositive("headingChangeDeg", headingChangeDeg);
  if (!(headingChangeDeg < MAX_HEADING_CHANGE_DEG)) throw new RangeError(`headingChangeDeg must be < ${MAX_HEADING_CHANGE_DEG}`);
  const onset = { rollInRollRateDegSec, rollOutRollRateDegSec, gOnsetRateGSec };
  for (const [name, value] of Object.entries(onset)) requirePositive(name, value);

  const vFps = tasKt * KNOT_TO_FPS;
  const thetaRad = headingChangeDeg * DEG;
  const bankRad = Math.acos(1 / loadFactorG);
  const holdRateRadSec = (G_FTPS2 * Math.tan(bankRad)) / vFps;
  const holdRadiusFt = vFps / holdRateRadSec;

  // Full onsets first. When they alone turn past the heading change, it is a smaller level turn (REDUCED): a
  // lower turn G with its own level-turn bank acos(1/G), the same onsets and no hold. The heading change of the
  // onsets grows with that G, so the G is found by bisection.
  let mode = "FULL";
  let peakBankRad = bankRad;
  let peakLoadFactor = loadFactorG;
  const levelTurnPhases = (n) => onsetPhases(onset, Math.acos(1 / n), n);
  if (headingChangeOf(levelTurnPhases(loadFactorG), vFps) > thetaRad) {
    mode = "REDUCED";
    peakLoadFactor = bisect(1, loadFactorG, (n) => headingChangeOf(levelTurnPhases(n), vFps), thetaRad);
    peakBankRad = Math.acos(1 / peakLoadFactor);
  }
  const [roll, pull, rollOut] = onsetPhases(onset, peakBankRad, peakLoadFactor);

  // Roll + pull from the turn start; the roll-out as a shape in its own start frame; the hold is the exact arc
  // between them.
  const afterPull = flyPhase(flyPhase([0, 0, 0], roll, vFps), pull, vFps);
  const rollOutShape = flyPhase([0, 0, 0], rollOut, vFps);
  const holdSweepRad = mode === "FULL" ? Math.max(0, thetaRad - afterPull[2] - rollOutShape[2]) : 0;
  const holdSec = holdSweepRad / holdRateRadSec;
  const holdStart = afterPull;
  const center = [holdStart[0] - holdRadiusFt * Math.sin(holdStart[2]), holdStart[1] + holdRadiusFt * Math.cos(holdStart[2])];
  const arcAt = (sweepRad) => {
    const psi = holdStart[2] + sweepRad;
    return [center[0] + holdRadiusFt * Math.sin(psi), center[1] - holdRadiusFt * Math.cos(psi), psi];
  };
  const holdEnd = holdSweepRad > 0 ? arcAt(holdSweepRad) : holdStart;
  const rotate = (origin, local) => {
    const c = Math.cos(origin[2]);
    const s = Math.sin(origin[2]);
    return [origin[0] + local[0] * c - local[1] * s, origin[1] + local[0] * s + local[1] * c, origin[2] + local[2]];
  };
  const end = rotate(holdEnd, rollOutShape);

  // Run-in line (turn-side 0) and exit line (heading = heading change through the end point) meet at the
  // turn's corner: T_in from the turn start to it, T_out from it to the end. An instantaneous turn has
  // T_in = T_out = R·tan(θ/2).
  const entryDistanceFt = end[0] - end[1] / Math.tan(thetaRad);
  const exitDistanceFt = end[1] / Math.sin(thetaRad);
  const timeSec = roll.durationSec + pull.durationSec + holdSec + rollOut.durationSec;

  // Samples on the 0.1 s grid plus each phase end, for drawing and the time path. The hold samples lie on the
  // exact arc; the onset samples are the integration states at the grid times.
  const samples = [];
  const push = (tSec, state, bank, n, phase) => samples.push({
    tSec,
    forwardNm: state[0] / FT_PER_NM,
    turnSideNm: state[1] / FT_PER_NM,
    headingChangeDeg: state[2] / DEG,
    bankDeg: bank / DEG,
    loadFactorG: n,
    phase,
  });
  push(0, [0, 0, 0], 0, 1, "roll");
  let t0 = 0;
  const sampleOnset = (startState, phase, frame) => {
    let nextGrid = Math.floor(t0 / SAMPLE_SEC + 1e-9) + 1;
    const state = flyPhase(startState, phase, vFps, (tau, s) => {
      const t = t0 + tau;
      const last = tau >= phase.durationSec - 1e-12;
      if (!last && t < nextGrid * SAMPLE_SEC - 1e-9) return;
      while (nextGrid * SAMPLE_SEC <= t + 1e-9) nextGrid += 1;
      const x = tau / phase.durationSec;
      push(t, frame ? rotate(frame, s) : s, phase.bank0 + (phase.bank1 - phase.bank0) * x, phase.n0 + (phase.n1 - phase.n0) * x, phase.name);
    });
    t0 += phase.durationSec;
    return state;
  };
  sampleOnset([0, 0, 0], roll);
  sampleOnset(flyPhase([0, 0, 0], roll, vFps), pull);
  if (holdSec > 0) {
    for (let k = Math.floor(t0 / SAMPLE_SEC + 1e-9) + 1; k * SAMPLE_SEC < t0 + holdSec - 1e-9; k += 1) {
      push(k * SAMPLE_SEC, arcAt((k * SAMPLE_SEC - t0) * holdRateRadSec), bankRad, loadFactorG, "hold");
    }
    t0 += holdSec;
    push(t0, holdEnd, bankRad, loadFactorG, "hold");
  }
  sampleOnset([0, 0, 0], rollOut, holdEnd);
  // The composed end state is the authority for the last sample.
  Object.assign(samples[samples.length - 1], {
    tSec: timeSec,
    forwardNm: end[0] / FT_PER_NM,
    turnSideNm: end[1] / FT_PER_NM,
    headingChangeDeg: end[2] / DEG,
  });

  const toNm = (state) => ({ forwardNm: state[0] / FT_PER_NM, turnSideNm: state[1] / FT_PER_NM });
  const holdRadiusNm = holdRadiusFt / FT_PER_NM;
  return {
    model: { ...ONSET_LEVEL_TURN_MODEL_V0_1 },
    tasKt,
    loadFactorG,
    bankAngleDeg: bankRad / DEG,
    headingChangeDeg,
    onset,
    mode,
    peakLoadFactorG: peakLoadFactor,
    peakBankDeg: peakBankRad / DEG,
    phaseTimesSec: { roll: roll.durationSec, pull: pull.durationSec, hold: holdSec, rollOut: rollOut.durationSec },
    timeSec,
    groundArcNm: (vFps * timeSec) / FT_PER_NM,
    entryDistanceNm: entryDistanceFt / FT_PER_NM,
    exitDistanceNm: exitDistanceFt / FT_PER_NM,
    rollOutLeadDeg: rollOutShape[2] / DEG,
    end: toNm(end),
    hold: holdSec > 0 ? {
      radiusNm: holdRadiusNm,
      sweepDeg: holdSweepRad / DEG,
      start: toNm(holdStart),
      end: toNm(holdEnd),
      center: { forwardNm: center[0] / FT_PER_NM, turnSideNm: center[1] / FT_PER_NM },
    } : null,
    instantaneous: {
      radiusNm: holdRadiusNm,
      entryDistanceNm: holdRadiusNm * Math.tan(thetaRad / 2),
      timeSec: thetaRad / holdRateRadSec,
    },
    samples,
  };
}
