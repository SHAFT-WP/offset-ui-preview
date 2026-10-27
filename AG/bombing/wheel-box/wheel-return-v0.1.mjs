// The adopted performance model entry (owner 2026-10-27, aircraft-performance SPEC §16): today PW-229 MIL, unchanged.
import { ADOPTED_PERFORMANCE_MODEL, ADOPTED_PERFORMANCE_MODEL_V0_1, evaluateAdoptedPerformance } from "../../../flight/aircraft-performance/adopted-performance-model-v0.1.mjs";
import { casToTas, tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";

// Wheel Return v0.1 — the path from the CSEM End back into the Wheel at Abeam (owner 2026-10-26; Wheel SPEC §19):
//   "Csem이후 완만한 선회로 원을 그리게 … 전반구 wheel로 들어감", "고도 속도 리커버리 하면서", "어빔 위치로만 법선방향으로
//   붙으면 된다", "레벨이 되면, g를 더 넣어서 경로로 진입한다. 혹은 고도와 속도를 얻은 뒤에 선회를 해서 휠 경로로 진입한다
//   … g는 더 줘도 된다", "상승 중에 속도가 감속된다 추력 모델, box be 참조", "다소 긴 타원 형태가 될 수 있으나 수평(x축)
//   기준 괘적이 wheel radius를 넘지는 않는다 — 1.5g를 유지하는 구간은 350이 안되기 때문", "에너지는 안남는다", "Wheel에서 쓰는
//   minimum range를 적용하고 고도만 맞추는 것으로 하자".
// Wheel-owned, pure. The flown phases are BOX OUT v0.2's (AG/bombing/box-pattern/box-out-maneuver-v0.2.mjs), at MIL on
// the PW-229 research model with BOX OUT's premises:
//   Climb        straight on the Attack Heading at the CSEM End's flight-path angle until the CAS falls to the Turn
//                Speed (350 KCAS) or the Roll-in Altitude is reached;
//   Extension    (only when needed) straight on, the BOX energy leg toward the Roll-in Altitude and speed: altitude and
//                speed first, the turn after ("고도와 속도를 얻은 뒤에 선회");
//   Return Turn  toward the pattern side: 90° bank at Return Turn G while the path falls to level (BOX OUT Turn), or
//                until the Minimum Speed; then at the Join G, solved so the turn ends on the Downwind heading on the
//                Abeam line ("레벨이 되면, g를 더 넣어서"): level, or at the Minimum Speed descending as MIL requires;
//   Downwind     straight on the Abeam line to Abeam, to the Roll-in Altitude only: a MIL climb holding the join CAS
//                until it, then on at it; from above, a descent to it (power below MIL).
// The Minimum Speed (300 KCAS) holds the speed, not the energy: where MIL cannot hold it at the Join G, the turn trades
// altitude for it (BOX OUT v0.2 holds the altitude too, which adds energy MIL does not give).
// The Extension is the shortest that has the Roll-in Altitude back by Abeam ("전반구 비행 경로가 늘어날 것"); the speed at
// Abeam is the join CAS, not required to be the pattern speed.
// The side of the path grows through the whole turn, so it never passes the Abeam line: the Wheel Radius is its width.
// Attack frame (NM): alongNm along the Attack Heading from the Target, sideNm toward the pattern side.
export const WHEEL_RETURN_MODEL_V0_1 = Object.freeze({
  id: "wheel-return-v0.1",
  // 0.1.1 (2026-10-27, owner): the model comes from the adopted performance entry (performanceEntry); same model,
  // every number unchanged.
  version: "0.1.1",
  status: "Work / MIL return on the PW-229 research model (unofficial adoption) / Not Official",
  phaseSource: "box-out-maneuver-v0.2 (Climb, OUT Turn, energy leg)",
  performanceModel: ADOPTED_PERFORMANCE_MODEL.modelId,
  performanceEntry: `${ADOPTED_PERFORMANCE_MODEL_V0_1.id} ${ADOPTED_PERFORMANCE_MODEL_V0_1.version}`,
  performanceAdoption: "UNOFFICIAL",
  // BOX OUT v0.2's premises and defaults.
  fuelKg: (ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[0] + ADOPTED_PERFORMANCE_MODEL.domain.ranges.fuelKg[1]) / 2,
  nominalAoaDeg: 5,
  turnSpeedKcas: 350,
  turnBankDeg: 90,
  defaultTurnG: 1.5,
  maxTurnG: 3,
  minimumSpeedKcas: 300,
  // The level part of the turn: the Join G is found in this range (Illinois regula falsi on the side at Downwind).
  minJoinG: 1.1,
  maxJoinG: 3,
  joinSideToleranceNm: 1e-6,
  // The Extension: the shortest that recovers by Abeam, to this tolerance, up to this length.
  extensionToleranceNm: 0.005,
  maxExtensionNm: 80,
  // RK4 step: against 1/16 s the solved path moves by under 0.001 NM and 0.01 s (the S, L and Join G solves repeat it).
  stepSec: 0.5,
  phaseLimitSec: 300,
  energyLegIntervals: 32,
});

const G = 9.8066352; // the PW-229 model's g
const KT = 1852 / 3600;
const M_PER_FT = 0.3048;
const M_PER_NM = 1852;
const DEG = Math.PI / 180;
const GAUSS = [0.5 - 0.5 / Math.sqrt(3), 0.5 + 0.5 / Math.sqrt(3)];
const KEYS = ["t", "x", "y", "h", "gamma", "psi", "cas", "d"];

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// The PW-229 MIL state at one point, with the domain report kept per call (as BOX OUT v0.2).
function performanceProbe() {
  const model = WHEEL_RETURN_MODEL_V0_1;
  const issues = new Set();
  let states = 0;
  let outside = 0;
  const evaluate = (altitudeMslFt, casKt, loadFactorG, verticalSpeedMps) => {
    const perf = evaluateAdoptedPerformance({
      altitudeMslFt, casKt, fuelKg: model.fuelKg, loadFactorG, aoaDeg: model.nominalAoaDeg, verticalSpeedMps,
    }, { allowResearchExtrapolation: true });
    states += 1;
    if (perf.outsideDomain) {
      outside += 1;
      perf.domainIssues.forEach((issue) => issues.add(issue));
    }
    return perf;
  };
  return { evaluate, report: () => ({ states, outsideDomainStates: outside, domainIssues: [...issues].sort() }) };
}

// Flown phases (BOX OUT v0.2's equations). State: t (s), x / y / d (NM; d the ground distance), h (ft MSL), gamma
// (flight-path angle, rad), psi (heading change toward the pattern side, rad), cas (KCAS).
function phaseRates(phase, loadFactorG, probe, hold = true) {
  const model = WHEEL_RETURN_MODEL_V0_1;
  const bank = model.turnBankDeg * DEG;
  return (s) => {
    const v = casToTas(s.cas, s.h) * KT;
    let cosGamma = Math.cos(s.gamma);
    const n = phase === "climb" ? cosGamma : loadFactorG;
    let verticalSpeedMps = v * Math.sin(s.gamma);
    let casRate = probe.evaluate(s.h, s.cas, n, verticalSpeedMps).casRateKtSec;
    let gammaRate = 0;
    let psiRate = 0;
    if (phase === "slice") {
      gammaRate = (G * (n * Math.cos(bank) - cosGamma)) / v;
      psiRate = (G * n * Math.sin(bank)) / (v * cosGamma);
    } else if (phase === "level") {
      // At the Minimum Speed, the sink rate that holds it (the CAS rate is linear in the vertical speed): MIL's energy
      // goes on falling, out of altitude. The turn at n with that path angle.
      if (hold && s.cas <= model.minimumSpeedKcas && casRate < 0) {
        const perMps = probe.evaluate(s.h, s.cas, n, 1).casRateKtSec - casRate;
        verticalSpeedMps = Math.max(-v, -casRate / perMps);
        cosGamma = Math.sqrt(1 - (verticalSpeedMps / v) ** 2);
        casRate = 0;
      }
      psiRate = (G * Math.sqrt(n * n - cosGamma * cosGamma)) / (v * cosGamma);
    }
    const horizontal = (v * cosGamma) / M_PER_NM;
    return { t: 1, x: horizontal * Math.cos(s.psi), y: horizontal * Math.sin(s.psi), h: verticalSpeedMps / M_PER_FT, gamma: gammaRate, psi: psiRate, cas: casRate, d: horizontal };
  };
}

const add = (s, k, f) => {
  const out = {};
  for (const key of KEYS) out[key] = s[key] + k[key] * f;
  return out;
};
function rk4(rates, s, dt, clamp = true) {
  const k1 = rates(s);
  const k2 = rates(add(s, k1, dt / 2));
  const k3 = rates(add(s, k2, dt / 2));
  const k4 = rates(add(s, k3, dt));
  const next = {};
  for (const key of KEYS) next[key] = s[key] + (dt / 6) * (k1[key] + 2 * k2[key] + 2 * k3[key] + k4[key]);
  // The Minimum Speed holds: the speed is not taken below it (a phase that ends at it is not clamped, so its end is found).
  if (clamp) next.cas = Math.max(next.cas, WHEEL_RETURN_MODEL_V0_1.minimumSpeedKcas);
  return next;
}

// Fly one phase until remaining(s) reaches 0 (found inside the last step by regula falsi). Returns the end state, its
// samples and the time held at the Minimum Speed (clamp: the speed held there; a phase that ends at it is not clamped).
function flyPhase(name, rates, start, remaining, stepSec, clamp = true) {
  const { phaseLimitSec, minimumSpeedKcas } = WHEEL_RETURN_MODEL_V0_1;
  const samples = [start];
  let s = start;
  let floorSec = 0;
  if (remaining(s) <= 0) return { end: s, samples, floorSec };
  for (;;) {
    if (s.t - start.t > phaseLimitSec) throw new RangeError(`Return ${name} does not end within ${phaseLimitSec} sec`);
    const next = rk4(rates, s, stepSec, clamp);
    const fNext = remaining(next);
    if (fNext > 0) {
      if (clamp && next.cas <= minimumSpeedKcas) floorSec += stepSec;
      s = next;
      samples.push(s);
      continue;
    }
    let lo = 0;
    let fLo = remaining(s);
    let hi = stepSec;
    let fHi = fNext;
    let end = next;
    let kept = 0;
    // Illinois regula falsi: a bracket end kept twice has its value halved.
    for (let index = 0; index < 60 && hi - lo > 1e-12; index += 1) {
      const dt = lo + ((hi - lo) * fLo) / (fLo - fHi);
      end = rk4(rates, s, dt, clamp);
      const f = remaining(end);
      if (Math.abs(f) < 1e-12) break;
      if (f > 0) {
        lo = dt; fLo = f;
        if (kept === -1) fHi /= 2;
        kept = -1;
      } else {
        hi = dt; fHi = f;
        if (kept === 1) fLo /= 2;
        kept = 1;
      }
    }
    if (clamp && end.cas <= minimumSpeedKcas) floorSec += end.t - s.t;
    samples.push(end);
    return { end, samples, floorSec };
  }
}

// BOX OUT v0.2's energy leg, as a profile along a straight: E = h + V²/2g rises at the MIL Ps; the altitude and the
// kinetic energy each move in proportion to E, so neither turns back. Nodes give the distance and time at each energy
// fraction (2-point Gauss–Legendre per interval); stateAt(u) the altitude, speed and flight-path angle there.
function energyProfile(start, target, probe) {
  const intervals = WHEEL_RETURN_MODEL_V0_1.energyLegIntervals;
  const energyFt = (h, cas) => h + (casToTas(cas, h) * KT) ** 2 / (2 * G) / M_PER_FT;
  const e1 = energyFt(start.h, start.cas);
  const eR = energyFt(target.altitudeMslFt, target.casKt);
  const deltaFt = eR - e1;
  if (!(deltaFt > 1e-6)) {
    return { excessEnergy: deltaFt < -1e-6, distanceNm: 0, timeSec: 0, nodes: [{ u: 0, d: 0, t: 0 }], stateAt: () => ({ h: target.altitudeMslFt, cas: target.casKt, gamma: 0 }) };
  }
  const dh = target.altitudeMslFt - start.h;
  const kinetic1 = e1 - start.h;
  const kineticR = eR - target.altitudeMslFt;
  const stateAt = (u) => {
    const h = start.h + u * dh;
    const v = Math.sqrt(2 * G * (kinetic1 + u * (kineticR - kinetic1)) * M_PER_FT);
    const cas = tasToCas(v / KT, h);
    const ps = probe.evaluate(h, cas, 1, 0).specificExcessPowerMps;
    if (!(ps > 0)) throw new RangeError(`MIL cannot reach the Roll-in Altitude and speed: Ps ${ps.toFixed(1)} m/s at ${Math.round(h)} ft, ${Math.round(cas)} KCAS`);
    const duDt = ps / (deltaFt * M_PER_FT);
    const vs = dh * M_PER_FT * duDt;
    return { h, cas, gamma: Math.asin(Math.max(-1, Math.min(1, vs / v))), dtDu: 1 / duDt, dsDu: Math.sqrt(Math.max(0, v * v - vs * vs)) / duDt / M_PER_NM };
  };
  const nodes = [{ u: 0, d: 0, t: 0 }];
  let d = 0;
  let t = 0;
  for (let index = 0; index < intervals; index += 1) {
    for (const g of GAUSS) {
      const point = stateAt((index + g) / intervals);
      t += point.dtDu / intervals / 2;
      d += point.dsDu / intervals / 2;
    }
    nodes.push({ u: (index + 1) / intervals, d, t });
  }
  return { excessEnergy: false, distanceNm: d, timeSec: t, nodes, stateAt };
}

// The Downwind to the Roll-in Altitude only (owner: "고도만 맞추는"), from the join on the Downwind heading:
//   CLIMB    below it: a MIL climb holding the join CAS (the vertical speed where the CAS rate is zero, n = 1 as the
//            energy leg) until the altitude; reachNm / reachSec where and when, past the Downwind when it is too short;
//   DESCENT  above it: a descent to it at the join CAS over the whole Downwind (power below MIL, not on the thrust model;
//            altitude linear over the distance);
//   LEVEL    at it.
// After the altitude the Downwind goes on level at the join CAS.
function altitudeLeg(join, altitudeFt, downwindNm, probe, stepSec) {
  const dh = altitudeFt - join.h;
  const along = { ...join, gamma: 0, psi: Math.PI };
  if (Math.abs(dh) < 1e-6) return { kind: "LEVEL", reachNm: 0, reachSec: 0, samples: [along], descentFt: 0 };
  if (dh < 0) {
    if (!(downwindNm > 0)) return { kind: "DESCENT", reachNm: Infinity, reachSec: Infinity, samples: [along], descentFt: -dh };
    const intervals = WHEEL_RETURN_MODEL_V0_1.energyLegIntervals;
    const gamma = Math.atan2(dh * M_PER_FT, downwindNm * M_PER_NM);
    const speedAt = (u) => casToTas(join.cas, join.h + u * dh) * KT * Math.cos(gamma);
    const samples = [along];
    let t = 0;
    for (let index = 0; index < intervals; index += 1) {
      for (const g of GAUSS) t += (downwindNm * M_PER_NM) / speedAt((index + g) / intervals) / intervals / 2;
      const d = (downwindNm * (index + 1)) / intervals;
      samples.push({ ...along, t: join.t + t, x: join.x - d, d: join.d + d, h: join.h + ((index + 1) / intervals) * dh });
    }
    return { kind: "DESCENT", reachNm: downwindNm, reachSec: t, samples, descentFt: -dh };
  }
  const rates = (s) => {
    const v = casToTas(s.cas, s.h) * KT;
    const perf = probe.evaluate(s.h, s.cas, 1, 0);
    if (!(perf.casRateKtSec > 0)) {
      throw new RangeError(`MIL cannot climb to the Roll-in Altitude at ${Math.round(s.cas)} KCAS: Ps ${perf.specificExcessPowerMps.toFixed(1)} m/s at ${Math.round(s.h)} ft`);
    }
    const perMps = probe.evaluate(s.h, s.cas, 1, 1).casRateKtSec - perf.casRateKtSec;
    const verticalSpeedMps = Math.min(v, -perf.casRateKtSec / perMps);
    const horizontal = Math.sqrt(v * v - verticalSpeedMps * verticalSpeedMps) / M_PER_NM;
    return { t: 1, x: -horizontal, y: 0, h: verticalSpeedMps / M_PER_FT, gamma: 0, psi: 0, cas: 0, d: horizontal };
  };
  let climb;
  try {
    climb = flyPhase("Downwind climb", rates, along, (s) => altitudeFt - s.h, stepSec, false);
  } catch (error) {
    if (!/does not end within/.test(error.message)) throw error;
    throw new RangeError(`MIL climbs to the Roll-in Altitude too slowly: more than ${WHEEL_RETURN_MODEL_V0_1.phaseLimitSec} sec on the Downwind at ${Math.round(join.cas)} KCAS from ${Math.round(join.h)} ft`);
  }
  return { kind: "CLIMB", reachNm: climb.end.d - join.d, reachSec: climb.end.t - join.t, samples: climb.samples, descentFt: 0 };
}

// The energy fraction and time at a distance into a profile (linear between nodes); at or past its end, u = 1.
function alongProfile(profile, distanceNm) {
  if (distanceNm >= profile.distanceNm) return { u: 1, t: profile.timeSec };
  const i = profile.nodes.findIndex((node) => node.d >= distanceNm);
  const a = profile.nodes[i - 1];
  const b = profile.nodes[i];
  const w = (distanceNm - a.d) / (b.d - a.d);
  return { u: a.u + w * (b.u - a.u), t: a.t + w * (b.t - a.t) };
}

// input:
//   start    { alongNm, sideNm, altitudeMslFt, casKt, fpaDeg }   the CSEM End (heading = Attack Heading)
//   abeam    { alongNm, sideNm }                                the Wheel's Abeam (0, Wheel Radius)
//   target   { altitudeMslFt, casKt }                           the Roll-in Altitude and the pattern speed
//   turnG    Return Turn G: the 90° bank part of the turn, > 1 and ≤ 3 G (default 1.5)
//   stepSec  the RK4 step (default the model's; tests use a finer one to bound the step error)
// Returns { status: VALID | INVALID, errors, warnings, ... }; a Return that cannot be flown is INVALID with the reason
// (never thrown), so the attack route stays usable.
export function calculateWheelReturnV0_1({ start, abeam, target, turnG = WHEEL_RETURN_MODEL_V0_1.defaultTurnG, stepSec = WHEEL_RETURN_MODEL_V0_1.stepSec }) {
  const model = WHEEL_RETURN_MODEL_V0_1;
  finite("turnG", turnG);
  if (!(turnG > 1 && turnG <= model.maxTurnG)) throw new RangeError(`Return Turn G must be > 1 and <= ${model.maxTurnG} G`);
  if (!(finite("stepSec", stepSec) > 0)) throw new RangeError("stepSec must be > 0");
  for (const [name, value] of Object.entries({ "start.alongNm": start?.alongNm, "start.sideNm": start?.sideNm, "start.altitudeMslFt": start?.altitudeMslFt, "start.casKt": start?.casKt, "start.fpaDeg": start?.fpaDeg, "abeam.alongNm": abeam?.alongNm, "abeam.sideNm": abeam?.sideNm, "target.altitudeMslFt": target?.altitudeMslFt, "target.casKt": target?.casKt })) finite(name, value);

  const probe = performanceProbe();
  const performance = () => ({
    modelId: ADOPTED_PERFORMANCE_MODEL.modelId,
    engineModel: ADOPTED_PERFORMANCE_MODEL.engineModel,
    powerSetting: ADOPTED_PERFORMANCE_MODEL.powerSetting,
    configurationId: ADOPTED_PERFORMANCE_MODEL.configurationId,
    adoption: "UNOFFICIAL",
    fuelKg: model.fuelKg,
    aoaDeg: model.nominalAoaDeg,
    bmsFlightValidated: false,
    ...probe.report(),
  });
  const base = { model: { ...model }, inputs: { turnG }, start: { ...start }, target: { ...target } };
  const invalid = (message, extra = {}) => ({ ...base, ...extra, status: "INVALID", errors: [message], warnings: [], samples: [], performance: performance() });
  const R = abeam.sideNm;

  // Climb: the CSEM End's flight-path angle held at MIL until the Turn Speed or the Roll-in Altitude.
  const origin = { t: 0, x: start.alongNm, y: start.sideNm, h: start.altitudeMslFt, gamma: start.fpaDeg * DEG, psi: 0, cas: start.casKt, d: 0 };
  let climb;
  let climbReason;
  try {
    climb = flyPhase("Climb", phaseRates("climb", 0, probe), origin, (s) => Math.min(s.cas - model.turnSpeedKcas, target.altitudeMslFt - s.h), stepSec);
    climbReason = origin.cas <= model.turnSpeedKcas || origin.h >= target.altitudeMslFt ? "AT_CSEM_END" : climb.end.cas <= model.turnSpeedKcas + 1e-6 ? "TURN_SPEED" : "ROLL_IN_ALTITUDE";
  } catch (error) {
    return invalid(`Return: ${error.message}`);
  }
  const climbEnd = climb.end;
  let extensionProfile;
  try {
    extensionProfile = energyProfile(climbEnd, target, probe);
  } catch (error) {
    return invalid(`Return: ${error.message}`);
  }
  const patternSpeedNmSec = (casToTas(target.casKt, target.altitudeMslFt) * KT) / M_PER_NM;

  // One Extension length: the turn and the Downwind it gives. The Join G is solved so the level part ends on the Downwind
  // heading on the Abeam line (side = R), or given (the flown path repeats the solved one exactly). recovered: the
  // Roll-in Altitude is back by Abeam.
  const attempt = (extensionNm, { samples = false, joinHint = null, joinG: givenJoinG = null } = {}) => {
    let turnStart = climbEnd;
    const extensionSamples = [climbEnd];
    if (extensionNm > 0) {
      const at = alongProfile(extensionProfile, extensionNm);
      const state = extensionProfile.excessEnergy || at.u >= 1 ? { h: target.altitudeMslFt, cas: target.casKt, gamma: 0 } : extensionProfile.stateAt(at.u);
      const extra = Math.max(0, extensionNm - extensionProfile.distanceNm);
      turnStart = { ...climbEnd, t: climbEnd.t + at.t + extra / patternSpeedNmSec, x: climbEnd.x + extensionNm, d: climbEnd.d + extensionNm, h: state.h, cas: state.cas, gamma: state.gamma };
      if (samples) {
        for (const node of extensionProfile.nodes.slice(1)) {
          if (node.d >= extensionNm) break;
          const s = extensionProfile.stateAt(node.u);
          extensionSamples.push({ ...climbEnd, t: climbEnd.t + node.t, x: climbEnd.x + node.d, d: climbEnd.d + node.d, h: s.h, cas: s.cas, gamma: s.gamma });
        }
        extensionSamples.push(turnStart);
      }
    }
    // The 90° bank part while the path is above level (BOX OUT Turn) and the speed above the Minimum Speed (the step in
    // pitch to level there is not modelled), then at the Join G.
    const slice = turnStart.gamma > 1e-9
      ? flyPhase("Turn (bank)", phaseRates("slice", turnG, probe), turnStart, (s) => Math.min(s.gamma, Math.PI - s.psi, s.cas - model.minimumSpeedKcas), stepSec, false)
      : { end: { ...turnStart, gamma: 0 }, samples: [{ ...turnStart, gamma: 0 }], floorSec: 0 };
    if (slice.end.psi >= Math.PI - 1e-9) {
      return { extensionNm, error: `Return: the ${turnG} G turn reaches the Downwind heading before level (side ${slice.end.y.toFixed(2)} NM, Abeam ${R.toFixed(2)} NM)` };
    }
    if (slice.end.y > R) return { extensionNm, error: `Return: the ${turnG} G turn is wider than the Wheel Radius before it is level (side ${slice.end.y.toFixed(2)} NM)` };
    // Level from the bank part's end; one that ended at the Minimum Speed starts on it.
    const onMinimum = (cas) => (Math.abs(cas - model.minimumSpeedKcas) < 1e-6 ? model.minimumSpeedKcas : cas);
    const levelStart = { ...slice.end, gamma: 0, cas: onMinimum(slice.end.cas) };
    // Flown to the Minimum Speed first (found inside its step: the hold starts a sink), then on to the Downwind heading.
    const level = (n) => {
      const fast = flyPhase("Turn (level)", phaseRates("level", n, probe, false), levelStart, (s) => Math.min(Math.PI - s.psi, s.cas - model.minimumSpeedKcas), stepSec, false);
      if (fast.end.psi >= Math.PI - 1e-9) return fast;
      const held = flyPhase("Turn (level)", phaseRates("level", n, probe), { ...fast.end, cas: onMinimum(fast.end.cas) }, (s) => Math.PI - s.psi, stepSec);
      return { end: held.end, samples: [...fast.samples, ...held.samples.slice(1)], floorSec: fast.floorSec + held.floorSec };
    };
    const sideAt = (n) => level(n).end.y - R;
    // The Join G: a bracket around the last one when it still holds, else the whole range; then Illinois regula falsi
    // (the side falls as the G rises): a bracket end kept twice has its value halved.
    const solveJoinG = () => {
      let lo = joinHint === null ? model.minJoinG : Math.max(model.minJoinG, joinHint - 0.05);
      let hi = joinHint === null ? model.maxJoinG : Math.min(model.maxJoinG, joinHint + 0.05);
      let fLo = sideAt(lo);
      let fHi = sideAt(hi);
      if (joinHint !== null && (fLo < 0 || fHi > 0)) {
        if (fLo < 0) { hi = lo; fHi = fLo; lo = model.minJoinG; fLo = sideAt(lo); }
        else { lo = hi; fLo = fHi; hi = model.maxJoinG; fHi = sideAt(hi); }
      }
      if (fHi > 0) return { error: `Return: joining the Abeam line needs more than ${model.maxJoinG} G` };
      if (fLo < 0) return { error: `Return: the Abeam line is wider than the turn reaches at ${model.minJoinG} G` };
      let solved = hi;
      let kept = 0;
      for (let index = 0; index < 60; index += 1) {
        const n = hi - (fHi * (hi - lo)) / (fHi - fLo);
        const f = sideAt(n);
        solved = n;
        if (Math.abs(f) < model.joinSideToleranceNm) break;
        if (f > 0) {
          lo = n; fLo = f;
          if (kept === -1) fHi /= 2;
          kept = -1;
        } else {
          hi = n; fHi = f;
          if (kept === 1) fLo /= 2;
          kept = 1;
        }
      }
      return { joinG: solved };
    };
    const solution = givenJoinG === null ? solveJoinG() : { joinG: givenJoinG };
    if (solution.error) return { extensionNm, error: solution.error };
    const { joinG } = solution;
    const turn = level(joinG);
    const join = turn.end;
    // Downwind on the Abeam line to Abeam (along back to it), to the Roll-in Altitude on it.
    const downwindNm = join.x - abeam.alongNm;
    const downwind = altitudeLeg(join, target.altitudeMslFt, downwindNm, probe, stepSec);
    // shortNm: how much more Downwind the altitude needs (> 0: not back by Abeam).
    const shortNm = downwind.reachNm - downwindNm;
    const recovered = downwindNm >= -1e-9 && shortNm <= 1e-9;
    return { extensionNm, turnStart, extensionSamples, slice, turn, joinG, join, downwindNm, downwind, recovered, shortNm };
  };

  // The Extension: none when the Roll-in Altitude is back by Abeam without it, else the shortest that has it back (within
  // the tolerance): a bracket from the shortfall, then Illinois regula falsi on the shortfall (it falls as the
  // Extension grows).
  let flown;
  try {
    flown = attempt(0);
    if (!flown.error && !flown.recovered) {
      let lo = flown;
      let hi = attempt(Math.min(Math.max(lo.shortNm, 0.5), model.maxExtensionNm), { joinHint: lo.joinG });
      while (!hi.error && !hi.recovered && hi.extensionNm < model.maxExtensionNm) {
        lo = hi;
        hi = attempt(Math.min(hi.extensionNm * 2, model.maxExtensionNm), { joinHint: hi.joinG });
      }
      if (!hi.error && hi.recovered) {
        let fLo = lo.shortNm;
        let fHi = hi.shortNm;
        let kept = 0;
        while (hi.extensionNm - lo.extensionNm > model.extensionToleranceNm && fHi < -model.extensionToleranceNm) {
          const nextNm = hi.extensionNm - (fHi * (hi.extensionNm - lo.extensionNm)) / (fHi - fLo);
          const trial = attempt(nextNm, { joinHint: hi.joinG });
          if (trial.error) break;
          if (trial.recovered) {
            hi = trial; fHi = trial.shortNm;
            if (kept === 1) fLo /= 2;
            kept = 1;
          } else {
            lo = trial; fLo = trial.shortNm;
            if (kept === -1) fHi /= 2;
            kept = -1;
          }
        }
        flown = hi;
      } else if (hi.error) flown = hi;
    }
    if (!flown.error) flown = attempt(flown.extensionNm, { samples: true, joinG: flown.joinG });
  } catch (error) {
    return invalid(`Return: ${error.message}`);
  }
  if (flown.error) return invalid(flown.error, { extensionNm: flown.extensionNm });

  // The flown path: Climb, Extension, the turn, then the Downwind to Abeam.
  const { turnStart, slice, turn, join, downwind, downwindNm } = flown;
  const errors = [];
  if (!flown.recovered) {
    errors.push(`Return: MIL does not reach ${Math.round(target.altitudeMslFt)} ft by Abeam even with a ${model.maxExtensionNm} NM Extension`);
  }
  // The Downwind samples up to Abeam (a climb that does not end by Abeam is cut there), then on level at the join CAS.
  const downwindSamples = downwind.samples.slice(1).filter((s) => s.d - join.d < downwindNm - 1e-9);
  const reach = Math.min(downwind.reachNm, downwindNm);
  const reached = downwindSamples.at(-1) ?? join;
  let endAltitude = target.altitudeMslFt;
  let endT = join.t + (downwind.kind === "DESCENT" ? downwind.reachSec : downwind.reachSec + (downwindNm - reach) / ((casToTas(join.cas, target.altitudeMslFt) * KT) / M_PER_NM));
  if (!flown.recovered) {
    // Not back by Abeam: the climb at Abeam (between its samples).
    const next = downwindNm > 0 ? downwind.samples.find((s) => s.d - join.d >= downwindNm) : null;
    const w = next && next.d > reached.d ? (join.d + downwindNm - reached.d) / (next.d - reached.d) : 0;
    endAltitude = reached.h + w * (next.h - reached.h);
    endT = reached.t + w * (next.t - reached.t);
  }
  const end = { ...join, t: endT, x: abeam.alongNm, d: join.d + downwindNm, h: endAltitude, cas: join.cas };
  const tagged = (list, phase) => list.map((s) => ({ ...s, phase }));
  const raw = [
    ...tagged(climb.samples, "Climb"),
    ...tagged(flown.extensionSamples.slice(1), "Extension"),
    ...tagged(slice.samples.slice(1), "Return Turn (bank)"),
    ...tagged(turn.samples.slice(1), "Return Turn (level)"),
    ...tagged(downwindSamples, "Downwind"),
    { ...end, phase: "Downwind" },
  ];
  const warnings = [];
  const at = (s) => ({ alongNm: s.x, sideNm: s.y });
  const state = (s) => ({ altitudeMslFt: s.h, casKt: s.cas });
  return {
    ...base,
    status: errors.length ? "INVALID" : "VALID",
    errors,
    warnings,
    extensionNm: flown.extensionNm,
    joinLoadFactorG: flown.joinG,
    joinBankDeg: Math.acos(1 / flown.joinG) / DEG,
    timeSec: end.t,
    distanceNm: end.d,
    // The Roll-in Altitude reached: on the Downwind climb, at Abeam after a descent, or at the turn end when level.
    recovery: !flown.recovered ? null : { timeSec: join.t + downwind.reachSec, distanceNm: join.d + downwind.reachNm, casKt: join.cas },
    minimumSpeedHeldSec: climb.floorSec + slice.floorSec + turn.floorSec,
    maxSideNm: Math.max(...raw.map((s) => s.y)),
    phases: {
      climb: { reason: climbReason, fpaDeg: start.fpaDeg, timeSec: climbEnd.t, distanceNm: climbEnd.d, ...state(climbEnd) },
      extension: { distanceNm: flown.extensionNm, timeSec: turnStart.t - climbEnd.t, ...state(turnStart) },
      turnBank: { loadFactorG: turnG, bankDeg: model.turnBankDeg, headingChangeDeg: slice.end.psi / DEG, timeSec: slice.end.t - turnStart.t, distanceNm: slice.end.d - turnStart.d, ...state(slice.end) },
      turnLevel: { loadFactorG: flown.joinG, headingChangeDeg: 180 - slice.end.psi / DEG, timeSec: join.t - slice.end.t, distanceNm: join.d - slice.end.d, ...state(join) },
      downwind: { kind: downwind.kind, distanceNm: downwindNm, timeSec: end.t - join.t, altitudeDistanceNm: downwind.reachNm, altitudeTimeSec: downwind.reachSec, descentFt: downwind.descentFt },
    },
    stations: {
      csemEnd: at(origin),
      turnStart: at(turnStart),
      levelPoint: at(slice.end),
      joinPoint: at(join),
      abeam: at(end),
    },
    abeamState: { ...state(end), headingChangeDeg: end.psi / DEG },
    samples: raw.map((s) => ({ alongNm: s.x, sideNm: s.y, timeSec: s.t, distanceNm: s.d, altitudeMslFt: s.h, casKt: s.cas, headingChangeDeg: s.psi / DEG, phase: s.phase })),
    performance: performance(),
  };
}
