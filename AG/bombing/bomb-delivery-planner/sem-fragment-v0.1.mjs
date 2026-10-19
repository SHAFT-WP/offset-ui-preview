import { calculateWingsLevelRecoveryPull } from "../../../common/maneuvers/recovery-pull/recovery-pull-v0.1.mjs";
import { tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { SEM_TURN_MODEL_V0_1, calculateSemTurn } from "./sem-turn-v0.1.mjs";
import { calculateFragmentData } from "./safety-legacy-v0.1.mjs";
import { CLIMB_SEM_MODEL_V0_2, calculateClimbSemV0_2 } from "../../../flight/maneuvers/safe-escape/work/v0.2/climb-sem-core-v0.2.mjs";

// SEM path and fragment cylinder v0.1 (owner 2026-10-15, BDP update R3 / R5, SPEC §6.6). Display and check only:
// MINALT, NLT and the Z-diagram are unchanged.
// - SEM path: the NLT SEM flown from the effective Release — a wings-level recovery pull at Release + Overshoot
//   KCAS, Recovery G and G onset to FPA 0°, then 1 G level at the reached TAS — on the ground track of the
//   attack axis (crab held against the crosswind, along-track wind added).
// - Fragment cylinder (owner planning model, not a fragment physics model): centred on the impact point; radius
//   R(t) = R_max·f and height H(t) = H_max·f, with f = 0 at impact, 1 at impact + 1 s and 0 again at impact +
//   T_frag, linear in between (owner Q8: "충격+T_frag에 0"). H_max = Fragment Maximum Altitude × (1 + margin);
//   R_max = Fragment Range × (1 + margin), or the plain Fragment Range when the margin applies to the height
//   only (developer option).
export const SEM_FRAGMENT_MODEL_V0_1 = Object.freeze({
  id: "bdp-sem-path-fragment-cylinder-v0.1",
  // 0.1.1 (2026-10-18, owner handoff §6): the selected SEM — `semEnd` LEVEL (default, unchanged) or CLIMB: the CSEM
  // (flight/maneuvers/safe-escape v0.2 core 0.2.1) from the same Release + Overshoot state to `csemTargetFpaDeg`
  // (default +30°), G falling linearly in time from the +20° gate to cos(target). The path ends at the CSEM End (no
  // level-off: N/A); the fragment check alone carries the CSEM End state on, straight at its FPA and speed, to
  // impact + fragment time. Results carry `sem` (the SEM flown and its conditions).
  // 0.1.2 (2026-10-19, owner, SPEC §6.8): `semTurn` — the Level SEM turns right at its level-off (sem-turn v0.1:
  // LEVEL or SLICE, speed and G held, the Roll-in onsets), then flies level at the turn's speed and heading. The
  // ground path takes the wind (crab at the turn start, drift during it): samples carry the cross range (+ = right
  // of the Attack Heading), the heading change and the bank, and the fragment check measures the distance with the
  // cross range. The SEM minimum covers the turn (a slice descends). Without a turn every result is unchanged.
  version: "0.1.2",
  semEnds: Object.freeze(["LEVEL", "CLIMB"]),
  csemGReleaseStartFpaDeg: 20,
  peakAfterImpactSec: 1,
  sampleIntervalSec: 0.1,
});

export const FRAGMENT_MARGIN_MODES = Object.freeze(["HEIGHT_AND_RADIUS", "HEIGHT"]);

const KT_TO_FPS = 1.687809857;
const FT_PER_NM = 6076.11549;
const SAMPLE_SEC = SEM_FRAGMENT_MODEL_V0_1.sampleIntervalSec;
const PEAK_SEC = SEM_FRAGMENT_MODEL_V0_1.peakAfterImpactSec;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

// f(τ), τ = time after impact: 0 → 1 over the first second, then back to 0 at the fragment time.
export function fragmentEnvelopeFactor(afterImpactSec, fragmentTimeSec) {
  if (!(afterImpactSec > 0) || !(afterImpactSec < fragmentTimeSec)) return 0;
  if (afterImpactSec <= PEAK_SEC) return afterImpactSec / PEAK_SEC;
  return (fragmentTimeSec - afterImpactSec) / (fragmentTimeSec - PEAK_SEC);
}

export function fragmentCylinder({ weapon, targetElevationMslFt, fragmentHeightMarginPercent, fragmentMarginAppliesTo = "HEIGHT_AND_RADIUS" }) {
  if (!FRAGMENT_MARGIN_MODES.includes(fragmentMarginAppliesTo)) throw new RangeError(`fragmentMarginAppliesTo must be one of ${FRAGMENT_MARGIN_MODES.join(", ")}`);
  const data = calculateFragmentData({ weapon, targetElevationMslFt });
  const scale = 1 + finite("fragmentHeightMarginPercent", fragmentHeightMarginPercent) / 100;
  const radiusFt = data.fragmentRangeFt * (fragmentMarginAppliesTo === "HEIGHT_AND_RADIUS" ? scale : 1);
  if (!(data.fragmentTimeSec > PEAK_SEC)) throw new RangeError("Fragment time must be longer than the 1 s growth");
  return {
    heightAglFt: data.fragmentMaximumAltitudeAglFt * scale,
    radiusFt,
    radiusNm: radiusFt / FT_PER_NM,
    timeSec: data.fragmentTimeSec,
    peakAfterImpactSec: PEAK_SEC,
    marginPercent: fragmentHeightMarginPercent,
    marginAppliesTo: fragmentMarginAppliesTo,
    // The weapon's own fragment data, without the margin (0.1.1, developer readout; handoff §7.2).
    raw: { rangeFt: data.fragmentRangeFt, maximumAltitudeAglFt: data.fragmentMaximumAltitudeAglFt, timeSec: data.fragmentTimeSec },
  };
}

// The SEM path from Release (t = 0) until the later of level-off and impact + fragment time, and the fragment
// check along it. Positions are ground distances in the attack-axis frame from the Release point.
export function calculateSemPathAndFragment({
  weapon,
  targetElevationMslFt,
  fragmentHeightMarginPercent,
  fragmentMarginAppliesTo = "HEIGHT_AND_RADIUS",
  releaseAltitudeMslFt,
  releaseSpeedKcas,
  speedOvershootKcas,
  diveAngleDeg,
  recoveryG,
  gOnsetTimeSec,
  bombTofSec,
  bombRangeFt,
  windAlongFps = 0,
  windCrossFps = 0,
  semEnd = "LEVEL",
  csemTargetFpaDeg = 30,
  semTurn = null,
}) {
  if (!SEM_FRAGMENT_MODEL_V0_1.semEnds.includes(semEnd)) throw new RangeError(`semEnd must be one of ${SEM_FRAGMENT_MODEL_V0_1.semEnds.join(", ")}`);
  const climb = semEnd === "CLIMB";
  [
    ["targetElevationMslFt", targetElevationMslFt], ["releaseAltitudeMslFt", releaseAltitudeMslFt], ["releaseSpeedKcas", releaseSpeedKcas],
    ["speedOvershootKcas", speedOvershootKcas], ["diveAngleDeg", diveAngleDeg], ["recoveryG", recoveryG], ["gOnsetTimeSec", gOnsetTimeSec],
    ["bombTofSec", bombTofSec], ["bombRangeFt", bombRangeFt], ["windAlongFps", windAlongFps], ["windCrossFps", windCrossFps],
  ].forEach(([name, value]) => finite(name, value));
  if (!(diveAngleDeg > 0 && diveAngleDeg < 90)) throw new RangeError("diveAngleDeg must be > 0 and < 90 for a SEM path");
  const cylinder = fragmentCylinder({ weapon, targetElevationMslFt, fragmentHeightMarginPercent, fragmentMarginAppliesTo });

  const startSpeedKcas = releaseSpeedKcas + speedOvershootKcas;
  let flown;
  let csem = null;
  if (climb) {
    csem = calculateClimbSemV0_2({
      releaseAltitudeFtMsl: releaseAltitudeMslFt,
      releaseSpeedKcas: startSpeedKcas,
      releaseFpaDeg: -diveAngleDeg,
      recoveryG,
      gOnsetTimeSec,
      gRelaxationFpaDeg: SEM_FRAGMENT_MODEL_V0_1.csemGReleaseStartFpaDeg,
      terminalFpaDeg: csemTargetFpaDeg,
      sampleIntervalSec: SAMPLE_SEC,
    });
    if (!csem.validation.valid) {
      const error = new RangeError(`CSEM: ${csem.validation.errors.join(", ")}`);
      error.semErrors = [...csem.validation.errors];
      throw error;
    }
    flown = { samples: csem.path.samples, gateSec: csem.path.relaxationStartSec, minAltitudeMslFt: csem.minAltitudeFtMsl };
  } else {
    const pull = calculateWingsLevelRecoveryPull({
      startAltitudeMslFt: releaseAltitudeMslFt,
      startSpeedKcas,
      startFpaDeg: -diveAngleDeg,
      targetFpaDeg: 0,
      recoveryG,
      gOnsetTimeSec,
      maneuverInitiationDelaySec: 0,
      sampleIntervalSec: SAMPLE_SEC,
    });
    flown = { samples: pull.path.samples, gateSec: Infinity, minAltitudeMslFt: pull.minAltitudeMslFt };
  }

  // Ground along-track distance: the horizontal airspeed less the crab against the crosswind, plus the
  // along-track wind (the same wind components as the ballistics).
  const groundStep = (airFt, dtSec) => {
    if (!(dtSec > 0)) return 0;
    const vh = airFt / dtSec;
    return dtSec * (Math.sqrt(Math.max(0, vh * vh - windCrossFps * windCrossFps)) + windAlongFps);
  };
  const samples = [];
  let groundFt = 0;
  let previous = null;
  for (const point of flown.samples) {
    if (previous) groundFt += groundStep(point.horizontalDistanceFt - previous.horizontalDistanceFt, point.elapsedTimeSec - previous.elapsedTimeSec);
    samples.push({
      timeSec: point.elapsedTimeSec,
      downRangeFt: groundFt,
      altitudeMslFt: point.altitudeMslFt,
      fpaDeg: point.fpaDeg,
      tasKt: point.speedKtas,
      loadFactorG: point.loadFactorG,
      crossRangeFt: 0,
      headingChangeDeg: 0,
      bankDeg: 0,
      phase: point.elapsedTimeSec > flown.gateSec + 1e-9 ? "relax" : "pull",
    });
    previous = point;
  }
  const levelOff = climb ? null : samples[samples.length - 1];

  // LEVEL with a turn (0.1.2): from the level-off, in the turn's own frame placed on the ground — x along the air
  // heading at the start (crabbed against the crosswind, so the track is still the attack axis), y toward the turn
  // side (RIGHT +), plus the wind drift since the start.
  let turn = null;
  let turnSide = 0;
  let turnSpeedSource = null;
  let levelOffSpeedKcas = null;
  let turnCrabRad = 0;
  if (!climb && semTurn && semTurn.headingChangeDeg !== 0) {
    if (!SEM_TURN_MODEL_V0_1.directions.includes(semTurn.direction)) throw new RangeError(`semTurn.direction must be one of ${SEM_TURN_MODEL_V0_1.directions.join(", ")}`);
    levelOffSpeedKcas = tasToCas(levelOff.tasKt, levelOff.altitudeMslFt);
    turnSpeedSource = semTurn.speedKcas === null || semTurn.speedKcas === undefined ? "LEVEL_OFF" : "INPUT";
    turn = calculateSemTurn({
      type: semTurn.type ?? "LEVEL",
      headingChangeDeg: semTurn.headingChangeDeg,
      loadFactorG: semTurn.loadFactorG ?? recoveryG,
      bankDeg: semTurn.bankDeg ?? null,
      speedKcas: turnSpeedSource === "LEVEL_OFF" ? levelOffSpeedKcas : semTurn.speedKcas,
      startAltitudeMslFt: levelOff.altitudeMslFt,
      startTimeSec: levelOff.timeSec,
      rollInRollRateDegSec: semTurn.rollInRollRateDegSec,
      rollOutRollRateDegSec: semTurn.rollOutRollRateDegSec,
      gOnsetRateGSec: semTurn.gOnsetRateGSec,
    });
    turnSide = semTurn.direction === "LEFT" ? -1 : 1;
    turnCrabRad = Math.asin(Math.max(-1, Math.min(1, -windCrossFps / (turn.startTasKt * KT_TO_FPS))));
    const cosC = Math.cos(turnCrabRad);
    const sinC = Math.sin(turnCrabRad);
    turn.samples.forEach((point, index) => {
      if (index === 0) return;
      const tau = point.timeSec - levelOff.timeSec;
      const y = turnSide * point.turnSideFt;
      samples.push({
        timeSec: point.timeSec,
        downRangeFt: levelOff.downRangeFt + point.forwardFt * cosC - y * sinC + windAlongFps * tau,
        crossRangeFt: point.forwardFt * sinC + y * cosC + windCrossFps * tau,
        altitudeMslFt: point.altitudeMslFt,
        fpaDeg: point.fpaDeg,
        tasKt: point.tasKt,
        loadFactorG: point.loadFactorG,
        headingChangeDeg: turnSide * point.headingChangeDeg,
        bankDeg: turnSide * point.bankDeg,
        phase: point.phase,
      });
    });
  }

  const last = samples[samples.length - 1];
  const impactSec = bombTofSec;
  const endSec = Math.max(last.timeSec, impactSec + cylinder.timeSec);
  // LEVEL: after level-off (or the turn) the path is straight and level at constant speed (one end sample, linear
  // in time). CLIMB: the path ends at the CSEM End; only the fragment check carries that state on (straight, its
  // FPA and speed).
  const lastTasFps = last.tasKt * KT_TO_FPS;
  const carried = (t) => {
    const dt = t - last.timeSec;
    const fpa = (last.fpaDeg * Math.PI) / 180;
    if (turn) {
      const airHeading = turnCrabRad + (last.headingChangeDeg * Math.PI) / 180;
      return {
        ...last,
        timeSec: t,
        downRangeFt: last.downRangeFt + (lastTasFps * Math.cos(airHeading) + windAlongFps) * dt,
        crossRangeFt: last.crossRangeFt + (lastTasFps * Math.sin(airHeading) + windCrossFps) * dt,
        fpaDeg: 0,
        loadFactorG: 1,
        bankDeg: 0,
        phase: "level",
      };
    }
    return {
      timeSec: t,
      downRangeFt: last.downRangeFt + groundStep(lastTasFps * Math.cos(fpa) * dt, dt),
      crossRangeFt: 0,
      altitudeMslFt: last.altitudeMslFt + lastTasFps * Math.sin(fpa) * dt,
      fpaDeg: last.fpaDeg,
      tasKt: last.tasKt,
      loadFactorG: climb ? Math.cos(fpa) : 1,
      headingChangeDeg: 0,
      bankDeg: 0,
      phase: climb ? "csem-end-held" : "level",
    };
  };
  if (!climb && endSec > last.timeSec + 1e-9) samples.push(carried(endSec));
  const checkSamples = climb && endSec > last.timeSec + 1e-9 ? [...samples, carried(endSec)] : samples;

  // Aircraft state at any time (linear between samples).
  const at = (t) => {
    let i = 1;
    while (i < checkSamples.length - 1 && checkSamples[i].timeSec < t) i += 1;
    const a = checkSamples[i - 1];
    const b = checkSamples[i];
    const f = b.timeSec > a.timeSec ? Math.min(1, Math.max(0, (t - a.timeSec) / (b.timeSec - a.timeSec))) : 1;
    return {
      downRangeFt: a.downRangeFt + (b.downRangeFt - a.downRangeFt) * f,
      crossRangeFt: a.crossRangeFt + (b.crossRangeFt - a.crossRangeFt) * f,
      altitudeMslFt: a.altitudeMslFt + (b.altitudeMslFt - a.altitudeMslFt) * f,
    };
  };
  // Fragment check from impact to impact + fragment time, every 0.1 s, at each pull sample and at the
  // envelope's peak. The clearance is the larger of (distance − R) and (height − H): the aircraft is inside
  // only when both are < 0. Height room: the smallest height − H while the aircraft is inside the radius (how far
  // the same path could be lowered before entering the cylinder); null when it never comes inside the radius.
  const impactCrossFt = windCrossFps * impactSec + 0; // no -0 without wind
  const windowEnd = impactSec + cylinder.timeSec;
  const checkTimes = [impactSec + PEAK_SEC, ...samples.map((sample) => sample.timeSec).filter((t) => t > impactSec && t < windowEnd)];
  for (let k = Math.floor(impactSec / SAMPLE_SEC) + 1; k * SAMPLE_SEC < windowEnd; k += 1) checkTimes.push(k * SAMPLE_SEC);
  let worst = null;
  let heightRoomFt = null;
  for (const t of checkTimes) {
    const f = fragmentEnvelopeFactor(t - impactSec, cylinder.timeSec);
    const state = at(t);
    const distanceFt = Math.hypot(state.downRangeFt - bombRangeFt, state.crossRangeFt - impactCrossFt);
    const heightAglFt = state.altitudeMslFt - targetElevationMslFt;
    const radiusFt = cylinder.radiusFt * f;
    const envelopeHeightFt = cylinder.heightAglFt * f;
    const horizontal = distanceFt - radiusFt;
    const vertical = heightAglFt - envelopeHeightFt;
    const clearanceFt = Math.max(horizontal, vertical);
    if (horizontal < 0) heightRoomFt = heightRoomFt === null ? vertical : Math.min(heightRoomFt, vertical);
    if (!worst || clearanceFt < worst.clearanceFt) {
      worst = { clearanceFt, timeSec: t, clearanceAxis: horizontal >= vertical ? "RADIUS" : "HEIGHT", distanceFt, heightAglFt, radiusFt, envelopeHeightFt };
    }
  }

  const semMinimumAltitudeMslFt = turn ? Math.min(flown.minAltitudeMslFt, turn.minAltitudeMslFt) : flown.minAltitudeMslFt;
  return {
    model: { ...SEM_FRAGMENT_MODEL_V0_1 },
    semMinimumAltitudeMslFt,
    semMinimumAltitudeAglFt: semMinimumAltitudeMslFt - targetElevationMslFt,
    semLevelOffTimeSec: levelOff ? levelOff.timeSec : null,
    semLevelOffDownRangeNm: levelOff ? levelOff.downRangeFt / FT_PER_NM : null,
    semRecoverySpeedKcas: startSpeedKcas,
    // The SEM flown and its conditions (handoff §4.5 / §6.6): one record every view, the Result and S&R read.
    sem: {
      end: semEnd,
      model: climb ? { ...CLIMB_SEM_MODEL_V0_2 } : { id: "common-recovery-pull-level-sem" },
      recoveryG,
      gOnsetTimeSec,
      recoverySpeedKcas: startSpeedKcas,
      targetFpaDeg: climb ? csemTargetFpaDeg : null,
      gReleaseStartFpaDeg: climb ? SEM_FRAGMENT_MODEL_V0_1.csemGReleaseStartFpaDeg : null,
      gReleaseStartTimeSec: climb ? flown.gateSec : null,
      terminalG: climb ? csem.terminalG : null,
      levelOffAltitudeMslFt: levelOff ? levelOff.altitudeMslFt : null,
      levelOffTimeSec: levelOff ? levelOff.timeSec : null,
      endTimeSec: climb ? csem.elapsedTimeSec : null,
      endAltitudeMslFt: climb ? csem.terminationAltitudeFtMsl : null,
      endSpeedKcas: climb ? csem.terminationSpeedKcas : null,
      endFpaDeg: climb ? csem.terminationState.fpaDeg : null,
      // The Level SEM turn from the level-off (0.1.2); null without one.
      turn: turn ? {
        model: { ...turn.model },
        type: turn.type,
        flownType: turn.flownType,
        mode: turn.mode,
        direction: semTurn.direction,
        headingChangeDeg: turn.headingChangeDeg,
        loadFactorG: turn.loadFactorG,
        peakLoadFactorG: turn.peakLoadFactorG,
        bankDeg: turn.bankDeg,
        bankAuto: turn.bankAuto,
        levelBankDeg: turn.levelBankDeg,
        speedKcas: turn.speedKcas,
        speedSource: turnSpeedSource,
        levelOffSpeedKcas,
        onset: { ...turn.onset },
        phaseTimesSec: { ...turn.phaseTimesSec },
        startTimeSec: levelOff.timeSec,
        endTimeSec: levelOff.timeSec + turn.timeSec,
        endAltitudeMslFt: turn.end.altitudeMslFt,
        minAltitudeMslFt: turn.minAltitudeMslFt,
      } : null,
      warnings: climb ? [...csem.validation.warnings] : [],
      assumptions: climb
        ? ["CSEM_END_HELD_FOR_FRAGMENT_CHECK: after the CSEM End the fragment check carries the end state straight at its FPA and speed (the path itself ends there)"]
        : turn ? ["SEM_TURN_SPEED_HELD: the turn and the level flight after it hold the turn speed (CAS) from the level-off; no acceleration or thrust model"] : [],
    },
    fragment: {
      ...cylinder,
      impactTimeSec: impactSec,
      impactDownRangeNm: bombRangeFt / FT_PER_NM,
      impactCrossNm: impactCrossFt / FT_PER_NM,
    },
    fragmentCheck: {
      clear: worst.clearanceFt >= 0,
      minClearanceFt: worst.clearanceFt,
      atTimeSec: worst.timeSec,
      afterImpactSec: worst.timeSec - impactSec,
      // The axis that gives the clearance: outside the radius, or above the envelope height.
      clearanceAxis: worst.clearanceAxis,
      aircraftDistanceNm: worst.distanceFt / FT_PER_NM,
      aircraftHeightAglFt: worst.heightAglFt,
      envelopeRadiusNm: worst.radiusFt / FT_PER_NM,
      envelopeHeightAglFt: worst.envelopeHeightFt,
      heightRoomFt,
    },
    // The envelope's corners (linear between them).
    fragmentEnvelope: [0, PEAK_SEC, cylinder.timeSec].map((after) => ({
      timeSec: impactSec + after,
      afterImpactSec: after,
      radiusNm: (cylinder.radiusFt * fragmentEnvelopeFactor(after, cylinder.timeSec)) / FT_PER_NM,
      heightAglFt: cylinder.heightAglFt * fragmentEnvelopeFactor(after, cylinder.timeSec),
    })),
    samples: samples.map((s) => ({
      timeSec: s.timeSec,
      downRangeNm: s.downRangeFt / FT_PER_NM,
      crossRangeNm: s.crossRangeFt / FT_PER_NM,
      headingChangeDeg: s.headingChangeDeg,
      bankDeg: s.bankDeg,
      altitudeMslFt: s.altitudeMslFt,
      altitudeAglFt: s.altitudeMslFt - targetElevationMslFt,
      fpaDeg: s.fpaDeg,
      tasKt: s.tasKt,
      loadFactorG: s.loadFactorG,
      phase: s.phase,
    })),
  };
}
