import { BOMB_DELIVERY_PLANNER_MODEL_V0_4, calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";
import { calculateWheelTurnV0_3 } from "./wheel-orbit-turn-v0.3.mjs";
import { WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1, WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1, evaluateWheelOrbitPerformanceValidityV0_1 } from "./wheel-orbit-performance-validity-v0.1.mjs";
import { buildWheelAttackGeometryV0_1, wheelPlace } from "./wheel-attack-geometry-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// Wheel Attack v0.1 — the Wheel (V2) (owner 2026-10-27: "wheel에는 0.4버전(html)을 참조해서 지금의 be fe 구조를
// 가지게 해줘 box를 참조해서 만들면 된다"; Wheel SPEC §20). The Official Wheel Rev0.4 (bombing/wheel-attack/) on the V2
// BE: the aircraft orbits the Target-centred Wheel and rolls in from it at the point where the Roll-in, tracked to the
// Target on the Attack Heading, starts tangent to the Wheel.
// - Tangent condition (Rev0.4): in the Roll-in Start frame (forward = the heading flown there, turn side = the Roll-in
//   turn's side), the Target is abeam: x_roll + MAP × cos ψ = 0. ψ is the Angle-Off (Heading) the Roll-in turns
//   through; the Wheel Radius is then the Target's abeam distance, y_roll + MAP × sin ψ (= Roll-in Range = Base
//   Distance). The Roll-in, Track Point and MAP are BDP v0.4's at that Angle-Off (Rev0.4: its embedded Bomb Profile).
// - ψ is searched over 90–155° (Rev0.4): from 90.001° upward for the first sign change of the closure, then refined.
//   No sign change: no Wheel (an error, no result). The Target must lie on the Wheel side.
// - The Wheel turn: a level turn at the Initial speed and the Roll-in Altitude on the Wheel Radius (the Common
//   radius-driven turn, as Wheel-BOX), its G = 1 / cos(bank); its source-bounded limits as Wheel-BOX (M82 / M84;
//   other weapons NOT_EVALUATED).
// - Aircraft Count N (2–8, Rev0.4): spaced evenly on the Wheel, one Wheel time (360°) / N apart; the attack order is
//   1 → N → … → 2 (Rev0.4): aircraft k ≠ 1 is the (N + 1 − k)-th after #1.
// - RIGHT (Rev0.4) and LEFT (its mirror, as Wheel-BOX).
export const WHEEL_ATTACK_BE_MODEL_V0_1 = Object.freeze({
  id: "wheel-attack-be-v0.1",
  version: "0.1.0",
  status: "Work / Pure Composition / Not Official",
  reference: "Official Wheel Rev0.4 · R_20260825 (bombing/wheel-attack/wheel-attack.html)",
  bombDeliverySource: BOMB_DELIVERY_PLANNER_MODEL_V0_4.id,
  wheelTurnSource: "fst-wheel-orbit-turn-v0.3",
  performanceValiditySource: "wheel-orbit-performance-validity-v0.1",
  routeSource: "wheel-attack-geometry-v0.1 (stations, paths, validation)",
  // The Angle-Off search (Rev0.4): its range, the scan step from its start, and the refinement's tolerances.
  angleOffMinDeg: 90.001,
  angleOffMaxDeg: 155,
  angleOffScanStepDeg: 5,
  angleOffHintSpanDeg: 0.5,
  tangentToleranceNm: 1e-7,
  angleOffToleranceDeg: 1e-9,
  maxRefineIterations: 60,
  aircraftCountMin: 2,
  aircraftCountMax: 8,
  defaultAircraftCount: 4,
});

const DIRECTIONS = Object.freeze(["RIGHT", "LEFT"]);
const FT_PER_NM = 6076.11549;
const DEG = Math.PI / 180;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
const optional = (name, value) => (value === undefined || value === null ? null : finite(name, value));
const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

// DED point (as BOX / Wheel-BOX): the Target → point true bearing, range (NM, ft) and the Roll-in altitude.
function dedPoint({ alongNm, sideNm }, attackHeadingDeg, sign, elevationFt) {
  const rangeNm = Math.hypot(alongNm, sideNm);
  return {
    bearingDeg: normalizeDeg(attackHeadingDeg + sign * (Math.atan2(sideNm, alongNm) / DEG)),
    rangeNm,
    rangeFt: rangeNm * FT_PER_NM,
    elevationFt,
  };
}

// The Wheel turn limits (as Wheel-BOX v0.9): evaluated for a weapon of the source profile; NOT_EVALUATED otherwise.
const profileWeapons = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.supportedWeaponIds;
function turnPerformance({ weaponId, speedKcas, altitudeMslFt, turnRadiusNm, performanceProfileId }) {
  if (profileWeapons.includes(weaponId)) {
    return evaluateWheelOrbitPerformanceValidityV0_1({ role: "WHEEL", weaponId, speedKcas, altitudeMslFt, turnRadiusNm, performanceProfileId });
  }
  return Object.freeze({
    profile: Object.freeze({ id: WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id, weaponId, supportedWeaponIds: profileWeapons }),
    role: "WHEEL",
    valid: null,
    status: "NOT_EVALUATED",
    reason: `${weaponId} is not in ${WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id} (${profileWeapons.join(", ")}); its limits are not applied by analogy`,
    limitations: WHEEL_ORBIT_PERFORMANCE_LIMITATIONS_V0_1,
    issues: Object.freeze([]),
  });
}

// One candidate Angle-Off: the BDP at it and the Target in its Roll-in Start frame (the BDP semantic state's).
function candidateAt(bombDeliveryInput, angleOffDeg) {
  const bombDelivery = calculateBombDeliveryV0_4Full({ ...bombDeliveryInput, angleOffDeg });
  const target = bombDelivery.visualization.semanticState.stations.target;
  return { angleOffDeg, bombDelivery, closureNm: finite("target.forwardNm", target.forwardNm), abeamNm: finite("target.turnSideNm", target.turnSideNm) };
}

// The tangent Angle-Off: the first sign change of the closure from the search start (Rev0.4), bracketed by the scan
// (or around a hint: the Angle-Off of a nearby solve), then refined by the Illinois method (a bracketing secant) to
// the closure or Angle-Off tolerance. A candidate the BDP cannot fly ends the scan there (Rev0.4).
export function solveWheelTangentV0_1(bombDeliveryInput, { angleOffHintDeg = null } = {}) {
  const model = WHEEL_ATTACK_BE_MODEL_V0_1;
  let evaluations = 0;
  const f = (angleOffDeg) => { evaluations += 1; return candidateAt(bombDeliveryInput, angleOffDeg); };
  const crosses = (a, b) => a.closureNm === 0 || a.closureNm * b.closureNm < 0;
  let low = null;
  let high = null;
  const hint = optional("angleOffHintDeg", angleOffHintDeg);
  if (hint !== null && hint > model.angleOffMinDeg && hint < model.angleOffMaxDeg) {
    try {
      const a = f(Math.max(model.angleOffMinDeg, hint - model.angleOffHintSpanDeg));
      const b = f(Math.min(model.angleOffMaxDeg, hint + model.angleOffHintSpanDeg));
      if (a.closureNm > 0 && crosses(a, b)) { low = a; high = b; }
    } catch { /* the scan below decides */ }
  }
  let scanEnd = null;
  if (!low) {
    let previous = f(model.angleOffMinDeg);
    if (previous.closureNm === 0) return finish(previous, previous, previous);
    for (let deg = Math.ceil(model.angleOffMinDeg / model.angleOffScanStepDeg) * model.angleOffScanStepDeg; ; deg += model.angleOffScanStepDeg) {
      const angle = Math.min(deg, model.angleOffMaxDeg);
      let current;
      try {
        current = f(angle);
      } catch (error) {
        scanEnd = `the BDP cannot fly Angle-Off ${angle}°: ${error.message}`;
        break;
      }
      if (crosses(previous, current)) { low = previous; high = current; break; }
      previous = current;
      if (angle >= model.angleOffMaxDeg) {
        scanEnd = `at ${angle}° the Target is still ${Math.abs(current.closureNm).toFixed(2)} NM ${current.closureNm > 0 ? "ahead of" : "behind"} abeam`;
        break;
      }
    }
  }
  if (!low) {
    throw new RangeError(`No Wheel: no Roll-in from Angle-Off ${model.angleOffMinDeg.toFixed(0)}–${model.angleOffMaxDeg}° starts tangent to a Target-centred Wheel (${scanEnd}). Change the Roll-in Altitude, Initial Speed, Dive Angle or Roll-in G.`);
  }
  // Illinois: keep the bracket; halve the kept end's value when the same end is kept twice.
  let a = low;
  let b = high;
  let fa = a.closureNm;
  let fb = b.closureNm;
  let side = 0;
  let best = Math.abs(fa) < Math.abs(fb) ? a : b;
  for (let iteration = 0; iteration < model.maxRefineIterations; iteration += 1) {
    if (Math.abs(best.closureNm) <= model.tangentToleranceNm || Math.abs(b.angleOffDeg - a.angleOffDeg) <= model.angleOffToleranceDeg) break;
    const angle = (a.angleOffDeg * fb - b.angleOffDeg * fa) / (fb - fa);
    const c = f(angle);
    if (Math.abs(c.closureNm) < Math.abs(best.closureNm)) best = c;
    if (c.closureNm * fb > 0) {
      b = c; fb = c.closureNm;
      if (side === -1) fa /= 2;
      side = -1;
    } else {
      a = c; fa = c.closureNm;
      if (side === 1) fb /= 2;
      side = 1;
    }
  }
  return finish(best, low, high);

  function finish(solution, bracketLow, bracketHigh) {
    return { ...solution, evaluations, bracketDeg: [bracketLow.angleOffDeg, bracketHigh.angleOffDeg] };
  }
}

// Public entrypoint: result truncated to 5 decimals (docs/FE-BE-RULES.md). BE-to-BE composition uses the Full form.
export function calculateWheelAttackV0_1(input) {
  return truncateBeOutput(calculateWheelAttackV0_1Full(input));
}

// input:
//   bombDeliveryInput   BDP v0.4 input (the composition sets the Angle-Off it solves; a blank SEM Turn Direction is
//                       the Wheel side)
//   attackHeadingDeg    true
//   direction           RIGHT | LEFT (the Wheel side and the turn on it), default RIGHT
//   aircraftCount       2–8, default 4
//   angleOffHintDeg     optional: the Angle-Off of a nearby solve, to bracket the search around it (same answer)
export function calculateWheelAttackV0_1Full({
  bombDeliveryInput,
  attackHeadingDeg,
  direction = "RIGHT",
  aircraftCount = WHEEL_ATTACK_BE_MODEL_V0_1.defaultAircraftCount,
  angleOffHintDeg = null,
  performanceProfileId = WHEEL_ORBIT_PERFORMANCE_PROFILE_V0_1.id,
}) {
  const model = WHEEL_ATTACK_BE_MODEL_V0_1;
  if (!bombDeliveryInput || typeof bombDeliveryInput !== "object") throw new TypeError("bombDeliveryInput must be an object");
  finite("attackHeadingDeg", attackHeadingDeg);
  if (!DIRECTIONS.includes(direction)) throw new RangeError("direction must be RIGHT or LEFT");
  finite("aircraftCount", aircraftCount);
  if (!Number.isInteger(aircraftCount) || aircraftCount < model.aircraftCountMin || aircraftCount > model.aircraftCountMax) {
    throw new RangeError(`Aircraft Count must be an integer from ${model.aircraftCountMin} to ${model.aircraftCountMax}`);
  }
  const sign = direction === "RIGHT" ? 1 : -1;
  const attack = normalizeDeg(attackHeadingDeg);
  const bdpInput = { ...bombDeliveryInput, semTurnDirection: bombDeliveryInput.semTurnDirection ?? direction };

  const tangent = solveWheelTangentV0_1(bdpInput, { angleOffHintDeg });
  const { bombDelivery } = tangent;
  if (!(tangent.abeamNm > 0)) throw new RangeError(`No Wheel: the Target is not on the ${direction} side of the Roll-in Start at the tangent Angle-Off.`);
  const angleOffDeg = tangent.angleOffDeg;
  const pub = bombDelivery.public;
  const radiusNm = tangent.abeamNm;
  const weaponId = bombDelivery.canonicalInputs.weaponId;
  const speedKcas = finite("public.resolvedInitialSpeedKcas", pub.resolvedInitialSpeedKcas);
  const altitudeMslFt = finite("public.resolvedInitialAltitudeMslFt", pub.resolvedInitialAltitudeMslFt);
  const tasKt = finite("diagnostics.initialTasKt", bombDelivery.diagnostics?.initialTasKt);
  const targetElevationMslFt = finite("canonicalInputs.targetElevationMslFt", bombDelivery.canonicalInputs.targetElevationMslFt);

  // The Wheel turn at the Initial speed and the Roll-in Altitude, on the Wheel Radius.
  const turn = calculateWheelTurnV0_3({ initialSpeedKcas: speedKcas, initialAltitudeMslFt: altitudeMslFt, minWheelRadiusNm: radiusNm, wheelRadiusNm: radiusNm });
  const wheelTimeSec = 2 * turn.wheelTurn180TimeSec;
  const wheel = {
    role: "ATTACK_PATTERN",
    radiusNm,
    slantRangeNm: Math.hypot(radiusNm, (altitudeMslFt - targetElevationMslFt) / FT_PER_NM),
    wheelSpeedKcas: turn.wheelSpeedKcas,
    wheelAltitudeMslFt: turn.wheelAltitudeMslFt,
    wheelTasKt: tasKt,
    wheelBankAngleDeg: turn.wheelBankAngleDeg,
    wheelLoadFactorG: 1 / Math.cos(turn.wheelBankAngleDeg * DEG),
    wheelTurnRateDegSec: 360 / wheelTimeSec,
    wheelTurn180TimeSec: turn.wheelTurn180TimeSec,
    wheelTimeSec,
    circumferenceNm: 2 * Math.PI * radiusNm,
    performance: turnPerformance({ weaponId, speedKcas: turn.wheelSpeedKcas, altitudeMslFt: turn.wheelAltitudeMslFt, turnRadiusNm: radiusNm, performanceProfileId }),
  };

  const result = {
    model: { ...model },
    attackHeadingDeg: attack,
    direction,
    turnSideSign: sign,
    rollDirection: direction,
    angleOffDeg,
    interceptAngleDeg: angleOffDeg - 90,
    rollInStartHeadingDeg: normalizeDeg(attack - sign * angleOffDeg),
    rollInStartRadialDeg: normalizeDeg(attack - sign * (angleOffDeg + 90)),
    tangent: { closureNm: tangent.closureNm, closureFt: tangent.closureNm * FT_PER_NM, evaluations: tangent.evaluations, bracketDeg: tangent.bracketDeg },
    bombDelivery,
    wheel,
    flight: null,
  };

  // The Flight on the Wheel: N aircraft one Wheel time / N apart, in the order 1 → N → … → 2; each one's place when #1
  // is at the Roll-in Start, and its Roll-in time after #1's.
  const sequence = [1, ...Array.from({ length: aircraftCount - 1 }, (_, index) => aircraftCount - index)];
  const attackIntervalSec = wheelTimeSec / aircraftCount;
  result.flight = {
    aircraftCount,
    sequence,
    attackIntervalSec,
    arcSpacingNm: wheel.circumferenceNm / aircraftCount,
    arcSpacingDeg: 360 / aircraftCount,
    slots: [],
  };
  result.geometry = buildWheelAttackGeometryV0_1(result);
  const startPhi = result.geometry.values.rollInStartPhiRad;
  result.flight.slots = sequence.map((aircraft, slot) => ({
    aircraft,
    slot,
    rollInDelaySec: slot * attackIntervalSec,
    ...wheelPlace(radiusNm, startPhi - (slot * 2 * Math.PI) / aircraftCount, attack, sign),
  }));
  result.ded = { oa1: dedPoint(result.geometry.stations.oa1, attack, sign, altitudeMslFt) };
  return result;
}
