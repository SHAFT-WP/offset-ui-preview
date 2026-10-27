import { casToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";
// The adopted performance model entry (owner 2026-10-27, aircraft-performance SPEC §16): today PW-229 MIL, unchanged.
import { ADOPTED_PERFORMANCE_MODEL, ADOPTED_PERFORMANCE_MODEL_V0_1, evaluateAdoptedPerformance } from "../../../flight/aircraft-performance/adopted-performance-model-v0.1.mjs";

// BOX OUT Maneuver v0.2 — the MIL-power OUT (owner 2026-10-25; AG/bombing/box-pattern/SPEC.md "OUT Maneuver v0.2"):
//   "Out 기동은 밀파워로 피치 25도에서 진행. 350노트에서 90도 뱅크 1.5g, cross 지점에서 Roll in altitude, roll in 속도
//    도달 후 cross turn 시작." / "90도에서는 fpm이 떨어지는데 level에 걸리면 수평선회 전환" / "350kcas고 300보다는
//    내려가지 않음" / Crosswind Leg: filled in automatically, a typed value replaces it.
// Phases, all at MIL on the PW-229 research model (aircraft-performance SPEC §14; unofficial adoption, §15):
//   Recovery     Maneuver Initiation Delay straight, then a constant-G pull to level at Recovery G (v0.1, unchanged,
//                kinematic at the OUT Speed);
//   Pitch-up     a pull from level to the Climb Pitch at Climb G;
//   Climb        straight at the Climb Pitch (25°) until the speed falls to the OUT Turn Speed (350 KCAS);
//   OUT Turn     90° of heading: Turn Bank (90°) at Turn G (1.5 G) — the flight path falls, and when it reaches level
//                the turn goes on level at Turn G (bank acos(1 / G));
//   Energy leg   on the Crosswind Leg, from the OUT Turn end to the Roll-in Altitude and Roll-in speed (KCAS): its
//                length is the Crosswind Leg the composition fills in.
// The speed never goes below the Minimum Speed (300 KCAS): a step that would take it lower holds it there.
// The Climb Pitch is flown as the flight-path angle (v0.1's meaning). v0.1 (Rev1.5 OUT) stays for BOX v0.3.

export const BOX_OUT_MANEUVER_MODEL_V0_2 = Object.freeze({
  id: "box-out-maneuver-v0.2",
  // 0.2.1 (2026-10-27, owner): the model comes from the adopted performance entry (performanceEntry); same model,
  // every number unchanged.
  version: "0.2.1",
  status: "Work / MIL OUT on the PW-229 research model (unofficial adoption) / Not Official",
  recoverySource: "box-out-maneuver-v0.1 Recovery (Level-off sign corrected)",
  performanceModel: ADOPTED_PERFORMANCE_MODEL.modelId,
  performanceEntry: `${ADOPTED_PERFORMANCE_MODEL_V0_1.id} ${ADOPTED_PERFORMANCE_MODEL_V0_1.version}`,
  performanceAdoption: "UNOFFICIAL",
  // Premises of the performance model (SPEC): the fuel is the middle of the model's fuel range; the AoA is a nominal
  // value that only the model's envelope check reads (the model has no lift law).
  fuelKg: (ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[0] + ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[1]) / 2,
  nominalAoaDeg: 5,
  // RK4 time step of the flown phases; the end of each phase is found inside its last step.
  stepSec: 0.25,
  // Gauss–Legendre (2-point) intervals of the energy leg.
  energyLegIntervals: 32,
  // A phase that has not ended after this long fails (no OUT Turn Speed reached, no 90° of turn).
  phaseLimitSec: 300,
  turnHeadingChangeDeg: 90,
});

export const BOX_OUT_V0_2_DEFAULTS = Object.freeze({
  outRecoveryG: 5,
  outClimbPitchDeg: 25,
  outTurnSpeedKcas: 350,
  outTurnBankDeg: 90,
  outTurnG: 1.5,
  outMinimumSpeedKcas: 300,
});

const FT_PER_NM = 6076.11549;
const M_PER_NM = 1852;
const M_PER_FT = 0.3048;
const KT = 1852 / 3600;
const G = 9.8066352; // the PW-229 model's g
const KT_TO_FPS = 1.687809857; // Recovery: v0.1's constants
const G_FPS2 = 32.174;
const DEG = Math.PI / 180;
const GAUSS = [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)];

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// OUT inputs. An override replaces its default; Climb G's default follows the Recovery G in use (v0.1).
//   OUT Speed           KCAS  default Release Speed (the Recovery speed)
//   Recovery G          G     default 5.0
//   Climb Pitch         °     default 25
//   Climb G             G     default Recovery G / 2
//   OUT Turn Speed      KCAS  default 350
//   OUT Turn Bank       °     default 90
//   OUT Turn G          G     default 1.5
//   Minimum Speed       KCAS  default 300
export function resolveBoxOutInputsV0_2(bombDeliveryResult, options = {}) {
  const input = bombDeliveryResult.canonicalInputs;
  const d = BOX_OUT_V0_2_DEFAULTS;
  const recoveryG = finite("outRecoveryG", options.outRecoveryG ?? d.outRecoveryG);
  const out = {
    outSpeedKcas: finite("outSpeedKcas", options.outSpeedKcas ?? input.releaseSpeedKcas),
    recoveryG,
    climbPitchDeg: finite("outClimbPitchDeg", options.outClimbPitchDeg ?? d.outClimbPitchDeg),
    climbG: finite("outClimbG", options.outClimbG ?? recoveryG / 2),
    turnSpeedKcas: finite("outTurnSpeedKcas", options.outTurnSpeedKcas ?? d.outTurnSpeedKcas),
    turnBankDeg: finite("outTurnBankDeg", options.outTurnBankDeg ?? d.outTurnBankDeg),
    turnG: finite("outTurnG", options.outTurnG ?? d.outTurnG),
    minimumSpeedKcas: finite("outMinimumSpeedKcas", options.outMinimumSpeedKcas ?? d.outMinimumSpeedKcas),
  };
  if (!(out.outSpeedKcas > 0)) throw new RangeError("OUT Speed must be greater than 0 KCAS");
  if (!(out.recoveryG > 1)) throw new RangeError("OUT Recovery G must be greater than 1 G");
  if (!(out.climbPitchDeg > 0 && out.climbPitchDeg < 90)) throw new RangeError("OUT Climb Pitch must be between 0 and 90 deg");
  if (!(out.climbG > 1)) throw new RangeError("OUT Climb G must be greater than 1 G");
  if (!(out.turnBankDeg > 0 && out.turnBankDeg <= 90)) throw new RangeError("OUT Turn Bank must be more than 0 and at most 90 deg");
  if (!(out.turnG > 1)) throw new RangeError("OUT Turn G must be greater than 1 G (the level turn needs it)");
  if (!(out.minimumSpeedKcas > 0)) throw new RangeError("OUT Minimum Speed must be greater than 0 KCAS");
  if (!(out.turnSpeedKcas >= out.minimumSpeedKcas)) throw new RangeError("OUT Turn Speed must be at or above the Minimum Speed");
  return out;
}

// The PW-229 MIL state at one point of the OUT, with the domain report kept per call.
function performanceProbe() {
  const issues = new Set();
  let states = 0;
  let outside = 0;
  const evaluate = (altitudeMslFt, casKt, loadFactorG, verticalSpeedMps) => {
    const perf = evaluateAdoptedPerformance({
      altitudeMslFt,
      casKt,
      fuelKg: BOX_OUT_MANEUVER_MODEL_V0_2.fuelKg,
      loadFactorG,
      aoaDeg: BOX_OUT_MANEUVER_MODEL_V0_2.nominalAoaDeg,
      verticalSpeedMps,
    }, { allowResearchExtrapolation: true });
    states += 1;
    if (perf.outsideDomain) {
      outside += 1;
      perf.domainIssues.forEach((issue) => issues.add(issue));
    }
    return perf;
  };
  const report = () => ({ states, outsideDomainStates: outside, domainIssues: [...issues].sort() });
  return { evaluate, report };
}

// Flown phases. State: t (s), x / y (m, forward / turn side from the OUT start of the phase chain), h (ft MSL),
// gamma (flight-path angle, rad), psi (heading change, rad), cas (KCAS).
function phaseRates(phase, inputs, probe) {
  const floor = inputs.minimumSpeedKcas;
  const bank = inputs.turnBankDeg * DEG;
  return (s) => {
    const v = casToTas(s.cas, s.h) * KT;
    const cosGamma = Math.cos(s.gamma);
    const n = phase === "pitchUp" ? inputs.climbG : phase === "climb" ? cosGamma : inputs.turnG;
    const verticalSpeedMps = v * Math.sin(s.gamma);
    let casRate = probe.evaluate(s.h, s.cas, n, verticalSpeedMps).casRateKtSec;
    if (s.cas <= floor && casRate < 0) casRate = 0;
    let gammaRate = 0;
    let psiRate = 0;
    if (phase === "pitchUp") gammaRate = (G * (n - cosGamma)) / v;
    else if (phase === "slice") {
      gammaRate = (G * (n * Math.cos(bank) - cosGamma)) / v;
      psiRate = (G * n * Math.sin(bank)) / (v * cosGamma);
    } else if (phase === "levelTurn") psiRate = (G * Math.sqrt(n * n - 1)) / v;
    return {
      t: 1,
      x: v * cosGamma * Math.cos(s.psi),
      y: v * cosGamma * Math.sin(s.psi),
      h: verticalSpeedMps / M_PER_FT,
      gamma: gammaRate,
      psi: psiRate,
      cas: casRate,
    };
  };
}

const STATE_KEYS = ["t", "x", "y", "h", "gamma", "psi", "cas"];
const add = (s, k, f) => Object.fromEntries(STATE_KEYS.map((key) => [key, s[key] + k[key] * f]));

function rk4(rates, s, dt, floor) {
  const k1 = rates(s);
  const k2 = rates(add(s, k1, dt / 2));
  const k3 = rates(add(s, k2, dt / 2));
  const k4 = rates(add(s, k3, dt));
  const next = Object.fromEntries(STATE_KEYS.map((key) => [key, s[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key])]));
  // The Minimum Speed holds: the speed is not taken below it.
  next.cas = Math.max(next.cas, floor);
  return next;
}

// Fly one phase until `remaining(s)` reaches 0 (found inside the last step by regula falsi). Returns the end state,
// the samples at each step and the time held at the Minimum Speed.
function flyPhase(name, rates, start, remaining, floor) {
  const { stepSec, phaseLimitSec } = BOX_OUT_MANEUVER_MODEL_V0_2;
  const samples = [start];
  let s = start;
  let floorSec = 0;
  if (remaining(s) <= 0) return { end: s, samples, floorSec };
  for (;;) {
    if (s.t - start.t > phaseLimitSec) throw new RangeError(`OUT ${name} does not end within ${phaseLimitSec} sec`);
    const next = rk4(rates, s, stepSec, floor);
    const fNext = remaining(next);
    if (fNext > 0) {
      if (next.cas <= floor) floorSec += stepSec;
      s = next;
      samples.push(s);
      continue;
    }
    let lo = 0;
    let fLo = remaining(s);
    let hi = stepSec;
    let fHi = fNext;
    let end = next;
    for (let index = 0; index < 8; index += 1) {
      const dt = lo + ((hi - lo) * fLo) / (fLo - fHi);
      end = rk4(rates, s, dt, floor);
      const f = remaining(end);
      if (Math.abs(f) < 1e-10) break;
      if (f > 0) { lo = dt; fLo = f; } else { hi = dt; fHi = f; }
    }
    if (end.cas <= floor) floorSec += end.t - s.t;
    samples.push(end);
    return { end, samples, floorSec };
  }
}

// Energy leg (SPEC): from (h1, CAS1) to (hR, CASR) at MIL, with the energy height E = h + V²/2g changed at the MIL
// specific excess power Ps; the altitude and the kinetic energy each move in proportion to E, so neither turns back.
// dt = dE / Ps and the ground distance is ∫ V cos γ dt. No leg when E does not have to rise (excess energy is not
// modelled). Ps ≤ 0 on the way means MIL cannot get there.
function energyLeg(start, target, probe) {
  const energyFt = (h, cas) => h + (casToTas(cas, h) * KT) ** 2 / (2 * G) / M_PER_FT;
  const e1 = energyFt(start.h, start.cas);
  const eR = energyFt(target.altitudeMslFt, target.casKt);
  const deltaFt = eR - e1;
  const startSample = { distanceNm: 0, timeSec: 0, altitudeMslFt: start.h, casKt: start.cas };
  if (!(deltaFt > 1e-6)) return { distanceNm: 0, timeSec: 0, excessEnergy: deltaFt < -1e-6, samples: [startSample] };
  const dh = target.altitudeMslFt - start.h;
  const kinetic1 = e1 - start.h;
  const kineticR = eR - target.altitudeMslFt;
  const at = (u) => {
    const h = start.h + u * dh;
    const kineticFt = kinetic1 + u * (kineticR - kinetic1);
    const v = Math.sqrt(2 * G * kineticFt * M_PER_FT);
    const cas = tasToCas(v / KT, h);
    const ps = probe.evaluate(h, cas, 1, 0).specificExcessPowerMps;
    if (!(ps > 0)) throw new RangeError(`MIL cannot reach the Roll-in Altitude and speed: Ps ${ps.toFixed(1)} m/s at ${Math.round(h)} ft, ${Math.round(cas)} KCAS`);
    // du/dt = Ps / ΔE; vertical speed = dh · du/dt; horizontal speed = sqrt(V² − vs²).
    const duDt = ps / (deltaFt * M_PER_FT);
    const vs = dh * M_PER_FT * duDt;
    const horizontal = Math.sqrt(Math.max(0, v * v - vs * vs));
    return { h, cas, dtDu: 1 / duDt, dsDu: horizontal / duDt };
  };
  const intervals = BOX_OUT_MANEUVER_MODEL_V0_2.energyLegIntervals;
  const samples = [startSample];
  let timeSec = 0;
  let distanceM = 0;
  for (let index = 0; index < intervals; index += 1) {
    const u0 = index / intervals;
    const du = 1 / intervals;
    for (const g of GAUSS) {
      const point = at(u0 + g * du);
      timeSec += (point.dtDu * du) / 2;
      distanceM += (point.dsDu * du) / 2;
    }
    const u1 = u0 + du;
    samples.push({ distanceNm: distanceM / M_PER_NM, timeSec, altitudeMslFt: start.h + u1 * dh, casKt: tasToCas(Math.sqrt(2 * G * (kinetic1 + u1 * (kineticR - kinetic1)) * M_PER_FT) / KT, start.h + u1 * dh) });
  }
  return { distanceNm: distanceM / M_PER_NM, timeSec, excessEnergy: false, samples };
}

export function calculateBoxOutManeuverV0_2(bombDeliveryResult, options = {}) {
  return truncateBeOutput(calculateBoxOutManeuverV0_2Full(bombDeliveryResult, options));
}

export function calculateBoxOutManeuverV0_2Full(bombDeliveryResult, options = {}) {
  if (!bombDeliveryResult?.public || !bombDeliveryResult?.canonicalInputs) {
    throw new TypeError("bombDeliveryResult must be a Bomb Delivery Planner result");
  }
  const input = bombDeliveryResult.canonicalInputs;
  const pub = bombDeliveryResult.public;
  const inputs = resolveBoxOutInputsV0_2(bombDeliveryResult, options);
  const probe = performanceProbe();
  const floor = inputs.minimumSpeedKcas;

  // Recovery (v0.1): Maneuver Initiation Delay straight, then a constant-G pull to level at Recovery G, at the OUT Speed.
  const theta = finite("diveAngleDeg", input.diveAngleDeg) * DEG;
  const releaseMslFt = finite("effectiveReleaseAltitudeMslFt", pub.effectiveReleaseAltitudeMslFt);
  const outTasKt = casToTas(inputs.outSpeedKcas, releaseMslFt);
  const speedFps = outTasKt * KT_TO_FPS;
  const delaySec = Math.max(0, finite("maneuverInitiationDelaySec", input.maneuverInitiationDelaySec));
  const delayHorizontalFt = speedFps * Math.cos(theta) * delaySec;
  const delayAltitudeLossFt = speedFps * Math.sin(theta) * delaySec;
  const recoveryRadiusFt = (speedFps * speedFps) / (G_FPS2 * Math.max(0.01, inputs.recoveryG - Math.cos(theta)));
  const pullHorizontalFt = recoveryRadiusFt * Math.sin(theta);
  const pullAltitudeLossFt = recoveryRadiusFt * (1 - Math.cos(theta));
  const levelOffAltitudeMslFt = releaseMslFt - delayAltitudeLossFt - pullAltitudeLossFt;
  const recoveryDistanceNm = (delayHorizontalFt + pullHorizontalFt) / FT_PER_NM;
  const releaseToTargetNm = Math.max(0, finite("bombRangeNm", pub.bombRangeNm));
  const recoveryEndTargetNm = recoveryDistanceNm - releaseToTargetNm;

  // Pitch-up and Climb at MIL until the OUT Turn Speed (the climb starts its turn earlier if the pull-up already
  // brings the speed down to it).
  const pitch = inputs.climbPitchDeg * DEG;
  const levelOff = { t: 0, x: 0, y: 0, h: levelOffAltitudeMslFt, gamma: 0, psi: 0, cas: Math.max(inputs.outSpeedKcas, floor) };
  const toTurnSpeed = (s) => s.cas - inputs.turnSpeedKcas;
  const pitchUp = flyPhase("Pitch-up", phaseRates("pitchUp", inputs, probe), levelOff, (s) => Math.min(pitch - s.gamma, toTurnSpeed(s)), floor);
  const climb = flyPhase("Climb", phaseRates("climb", inputs, probe), { ...pitchUp.end, gamma: Math.min(pitchUp.end.gamma, pitch) }, toTurnSpeed, floor);
  const turnStart = climb.end;

  // OUT Turn: 90° of heading. Bank at Turn G while the path falls to level, then level at Turn G.
  const turnEndPsi = BOX_OUT_MANEUVER_MODEL_V0_2.turnHeadingChangeDeg * DEG;
  const turnOrigin = { ...turnStart, t: 0, x: 0, y: 0, psi: 0 };
  const slice = flyPhase("Turn (bank)", phaseRates("slice", inputs, probe), turnOrigin, (s) => Math.min(s.gamma, turnEndPsi - s.psi), floor);
  const levelStart = { ...slice.end, gamma: Math.max(0, slice.end.gamma) };
  const levelTurn = slice.end.psi < turnEndPsi - 1e-9 && slice.end.gamma <= 1e-9
    ? flyPhase("Turn (level)", phaseRates("levelTurn", inputs, probe), { ...levelStart, gamma: 0 }, (s) => turnEndPsi - s.psi, floor)
    : { end: levelStart, samples: [levelStart], floorSec: 0 };
  const turnEnd = levelTurn.end;
  const turnSamples = [...slice.samples, ...levelTurn.samples.slice(1)].map((s) => ({ forwardNm: s.x / M_PER_NM, turnSideNm: s.y / M_PER_NM }));

  // Energy leg on the Crosswind Leg to the Roll-in Altitude and Roll-in speed.
  const target = {
    altitudeMslFt: finite("resolvedInitialAltitudeMslFt", pub.resolvedInitialAltitudeMslFt),
    casKt: finite("resolvedInitialSpeedKcas", pub.resolvedInitialSpeedKcas),
  };
  const leg = energyLeg(turnEnd, target, probe);

  const climbHorizontalNm = turnStart.x / M_PER_NM;
  const turnStartTargetNm = recoveryEndTargetNm + climbHorizontalNm;
  const sliceHeadingDeg = slice.end.psi / DEG;
  return {
    model: { ...BOX_OUT_MANEUVER_MODEL_V0_2 },
    inputs,
    outTasKt,
    recovery: { radiusFt: recoveryRadiusFt, delayAltitudeLossFt, pullAltitudeLossFt, delayHorizontalFt, pullHorizontalFt },
    recoveryDistanceNm,
    levelOffAltitudeMslFt,
    releaseToTargetNm,
    recoveryEndTargetNm,
    climb: {
      reachedClimbPitch: pitchUp.end.gamma >= pitch - 1e-9,
      pitchUpTimeSec: pitchUp.end.t,
      timeSec: turnStart.t,
      horizontalNm: climbHorizontalNm,
      startCasKt: levelOff.cas,
      endAltitudeMslFt: turnStart.h,
      endCasKt: turnStart.cas,
    },
    turnStartTargetNm,
    // OUT Turn Start before the geometry minimum: past the Target, never before it (v0.1's rule).
    outDistanceNm: Math.max(0, turnStartTargetNm),
    turn: {
      startAltitudeMslFt: turnStart.h,
      startCasKt: turnStart.cas,
      startFpaDeg: turnStart.gamma / DEG,
      bankTimeSec: slice.end.t,
      bankHeadingChangeDeg: sliceHeadingDeg,
      reachedLevel: slice.end.gamma <= 1e-9,
      levelTurnBankDeg: Math.acos(1 / inputs.turnG) / DEG,
      levelTurnTimeSec: turnEnd.t - slice.end.t,
      timeSec: turnEnd.t,
      endAltitudeMslFt: turnEnd.h,
      endCasKt: turnEnd.cas,
      endFpaDeg: turnEnd.gamma / DEG,
      advanceNm: turnEnd.x / M_PER_NM,
      transferNm: turnEnd.y / M_PER_NM,
      samples: turnSamples,
    },
    energyLeg: { targetAltitudeMslFt: target.altitudeMslFt, targetCasKt: target.casKt, ...leg },
    minimumSpeedHeldSec: pitchUp.floorSec + climb.floorSec + slice.floorSec + levelTurn.floorSec,
    performance: {
      modelId: ADOPTED_PERFORMANCE_MODEL.modelId,
      engineModel: ADOPTED_PERFORMANCE_MODEL.engineModel,
      powerSetting: ADOPTED_PERFORMANCE_MODEL.powerSetting,
      configurationId: ADOPTED_PERFORMANCE_MODEL.configurationId,
      adoption: "UNOFFICIAL",
      fuelKg: BOX_OUT_MANEUVER_MODEL_V0_2.fuelKg,
      aoaDeg: BOX_OUT_MANEUVER_MODEL_V0_2.nominalAoaDeg,
      bmsFlightValidated: false,
      ...probe.report(),
    },
    validation: { valid: true, errors: [] },
  };
}
