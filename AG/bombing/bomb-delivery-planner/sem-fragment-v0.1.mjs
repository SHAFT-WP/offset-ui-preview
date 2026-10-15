import { calculateWingsLevelRecoveryPull } from "../../../common/maneuvers/recovery-pull/recovery-pull-v0.1.mjs";
import { calculateFragmentData } from "./safety-legacy-v0.1.mjs";

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
  version: "0.1.0",
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
}) {
  [
    ["targetElevationMslFt", targetElevationMslFt], ["releaseAltitudeMslFt", releaseAltitudeMslFt], ["releaseSpeedKcas", releaseSpeedKcas],
    ["speedOvershootKcas", speedOvershootKcas], ["diveAngleDeg", diveAngleDeg], ["recoveryG", recoveryG], ["gOnsetTimeSec", gOnsetTimeSec],
    ["bombTofSec", bombTofSec], ["bombRangeFt", bombRangeFt], ["windAlongFps", windAlongFps], ["windCrossFps", windCrossFps],
  ].forEach(([name, value]) => finite(name, value));
  if (!(diveAngleDeg > 0 && diveAngleDeg < 90)) throw new RangeError("diveAngleDeg must be > 0 and < 90 for a SEM path");
  const cylinder = fragmentCylinder({ weapon, targetElevationMslFt, fragmentHeightMarginPercent, fragmentMarginAppliesTo });

  const pull = calculateWingsLevelRecoveryPull({
    startAltitudeMslFt: releaseAltitudeMslFt,
    startSpeedKcas: releaseSpeedKcas + speedOvershootKcas,
    startFpaDeg: -diveAngleDeg,
    targetFpaDeg: 0,
    recoveryG,
    gOnsetTimeSec,
    maneuverInitiationDelaySec: 0,
    sampleIntervalSec: SAMPLE_SEC,
  });

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
  for (const point of pull.path.samples) {
    if (previous) groundFt += groundStep(point.horizontalDistanceFt - previous.horizontalDistanceFt, point.elapsedTimeSec - previous.elapsedTimeSec);
    samples.push({
      timeSec: point.elapsedTimeSec,
      downRangeFt: groundFt,
      altitudeMslFt: point.altitudeMslFt,
      fpaDeg: point.fpaDeg,
      tasKt: point.speedKtas,
      loadFactorG: point.loadFactorG,
      phase: "pull",
    });
    previous = point;
  }
  const levelOff = samples[samples.length - 1];
  const impactSec = bombTofSec;
  const endSec = Math.max(levelOff.timeSec, impactSec + cylinder.timeSec);
  const levelTasFps = levelOff.tasKt * KT_TO_FPS;
  // After level-off the path is straight and level at constant speed: one end sample carries it (linear in time).
  const levelState = (t) => ({
    timeSec: t,
    downRangeFt: levelOff.downRangeFt + groundStep(levelTasFps * (t - levelOff.timeSec), t - levelOff.timeSec),
    altitudeMslFt: levelOff.altitudeMslFt,
    fpaDeg: 0,
    tasKt: levelOff.tasKt,
    loadFactorG: 1,
    phase: "level",
  });
  if (endSec > levelOff.timeSec + 1e-9) samples.push(levelState(endSec));

  // Aircraft state at any time (linear between samples).
  const at = (t) => {
    let i = 1;
    while (i < samples.length - 1 && samples[i].timeSec < t) i += 1;
    const a = samples[i - 1];
    const b = samples[i];
    const f = b.timeSec > a.timeSec ? Math.min(1, Math.max(0, (t - a.timeSec) / (b.timeSec - a.timeSec))) : 1;
    return { downRangeFt: a.downRangeFt + (b.downRangeFt - a.downRangeFt) * f, altitudeMslFt: a.altitudeMslFt + (b.altitudeMslFt - a.altitudeMslFt) * f };
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
    const distanceFt = Math.hypot(state.downRangeFt - bombRangeFt, impactCrossFt);
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

  const semMinimumAltitudeMslFt = pull.minAltitudeMslFt;
  return {
    model: { ...SEM_FRAGMENT_MODEL_V0_1 },
    semMinimumAltitudeMslFt,
    semMinimumAltitudeAglFt: semMinimumAltitudeMslFt - targetElevationMslFt,
    semLevelOffTimeSec: levelOff.timeSec,
    semLevelOffDownRangeNm: levelOff.downRangeFt / FT_PER_NM,
    semRecoverySpeedKcas: releaseSpeedKcas + speedOvershootKcas,
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
      altitudeMslFt: s.altitudeMslFt,
      altitudeAglFt: s.altitudeMslFt - targetElevationMslFt,
      fpaDeg: s.fpaDeg,
      tasKt: s.tasKt,
      loadFactorG: s.loadFactorG,
      phase: s.phase,
    })),
  };
}
