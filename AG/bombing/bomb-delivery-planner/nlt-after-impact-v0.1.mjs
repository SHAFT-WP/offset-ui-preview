import { casToTas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { cachedCalculation } from "../../../common/calculation/calculation-cache-v0.1.mjs";
import { calculateBombTrajectory } from "./ballistics-v0.1.mjs";
import { calculateSemPathAndFragment, fragmentCylinder } from "./sem-fragment-v0.1.mjs";

// NLT after impact v0.1 (owner 2026-11-10, SPEC §6.11): "NLT Release 정의를 impact 후 MIN ALT와 같은 지점으로", then
// "b도 넣어" (0.2.0): fragments exist only from bomb impact on, and only inside the fragment cylinder. The NLT Release is
// the lowest Release whose SEM, at every moment from impact to impact + fragment time, is outside the full fragment
// radius R_max (Fragment Range x (1 + margin), 120% by default) OR at or above MINALT (= the cylinder top). The
// cylinder is held at full size the whole time (owner "보수적으로"), not the growing / shrinking display envelope of §6.6.
// - A (0.1.0, height only) is the special case of always being inside the radius: LD 20–45° keep their 0.1.0 NLT.
// - B lowers the NLT when the aircraft is already outside R_max (HD bombs fall short; steep dives).
// Each trial Release flies the bomb (same ballistics, wind and Release TAS as the BDP) and the selected SEM with its
// turn (LEVEL pull + Level SEM turn / CSEM + CSEM turn, sem-fragment: the path the BDP shows), so a turn back toward
// the impact point is caught. A trial whose SEM cannot be flown, or whose bottom reaches the Target elevation, fails.
// When the pull NLT (§6.3) itself fails (e.g. a slice turn that descends inside the radius) it stands, as before.
// Search: a step down from the pull NLT until the root is bracketed, then the Illinois method (safeguarded secant),
// within 1 ft above the root. When B gives nothing (still inside the radius below MINALT) one step of 1 ft confirms it.
export const NLT_AFTER_IMPACT_MODEL_V0_1 = Object.freeze({
  id: "bdp-nlt-after-impact-v0.1",
  version: "0.2.0",
  // Search (owner 2026-11-10, "6–10번"): safeguarded secant; the answer is within releaseToleranceFt above the root.
  releaseToleranceFt: 1,
  clearanceToleranceFt: 0.5,
  minStepFt: 20,
  maxIterations: 40,
});

const KT_TO_FPS = 1.687809857;
const MPS_PER_KT = 0.5144444444444445;
const FT_PER_NM = 6076.11549;
const CHECK_STEP_SEC = 0.1;

// Smallest clearance from the full cylinder, min over t of max(distance − R, altitude − top), from impact to the end
// of the fragment time, every 0.1 s and at each path sample. Past the last sample the path is held straight at its
// FPA and speed along the attack axis (only a plain CSEM ends before that; LEVEL and the turns carry an end sample).
function cylinderClearance(nmSamples, { impactSec, endSec, impactDownFt, impactCrossFt, windAlongFps, radiusFt, topMslFt }) {
  const samples = nmSamples.map((s) => ({ timeSec: s.timeSec, down: s.downRangeNm * FT_PER_NM, cross: (s.crossRangeNm ?? 0) * FT_PER_NM, alt: s.altitudeMslFt, fpaDeg: s.fpaDeg, tasKt: s.tasKt }));
  const last = samples[samples.length - 1];
  let i = 1;
  const at = (t) => {
    if (t >= last.timeSec) {
      const dt = t - last.timeSec;
      const fpa = (last.fpaDeg * Math.PI) / 180;
      const tas = last.tasKt * KT_TO_FPS;
      return { down: last.down + (tas * Math.cos(fpa) + windAlongFps) * dt, cross: last.cross, alt: last.alt + tas * Math.sin(fpa) * dt };
    }
    while (i < samples.length - 1 && samples[i].timeSec < t) i += 1;
    const a = samples[i - 1];
    const b = samples[i];
    const f = b.timeSec > a.timeSec ? Math.min(1, Math.max(0, (t - a.timeSec) / (b.timeSec - a.timeSec))) : 1;
    return { down: a.down + (b.down - a.down) * f, cross: a.cross + (b.cross - a.cross) * f, alt: a.alt + (b.alt - a.alt) * f };
  };
  const times = [impactSec];
  for (const s of samples) if (s.timeSec > impactSec && s.timeSec < endSec) times.push(s.timeSec);
  for (let k = Math.floor(impactSec / CHECK_STEP_SEC) + 1; k * CHECK_STEP_SEC < endSec; k += 1) times.push(k * CHECK_STEP_SEC);
  times.push(endSec);
  times.sort((x, y) => x - y);
  let min = Infinity;
  for (const t of times) {
    const p = at(t);
    min = Math.min(min, Math.max(Math.hypot(p.down - impactDownFt, p.cross - impactCrossFt) - radiusFt, p.alt - topMslFt));
  }
  return min;
}

// args: weapon, targetElevationMslFt, fragmentHeightMarginPercent, fragmentMarginAppliesTo, releaseSpeedKcas,
// speedOvershootKcas, diveAngleDeg, recoveryG, gOnsetTimeSec, semEnd, csemTargetFpaDeg, windDirectionDeg,
// windSpeedKt, ballisticModelId, semTurn, csemTurn (as the BDP passes them to sem-fragment). Returns null when the
// SEM cannot be flown from this Release.
export function evaluateNltTrial(args, releaseAltitudeMslFt) {
  const { weapon, targetElevationMslFt, releaseSpeedKcas, diveAngleDeg, windDirectionDeg, windSpeedKt } = args;
  const bomb = calculateBombTrajectory({
    params: { diveAngleDeg, releaseAglFt: releaseAltitudeMslFt - targetElevationMslFt, windDirectionDeg, windSpeedMps: windSpeedKt * MPS_PER_KT, flightPathReference: "GROUND" },
    weapon,
    releaseTasKt: casToTas(releaseSpeedKcas, releaseAltitudeMslFt),
    modelId: args.ballisticModelId,
  });
  const windRad = (windDirectionDeg * Math.PI) / 180;
  const windFps = windSpeedKt * KT_TO_FPS;
  let sem;
  try {
    sem = calculateSemPathAndFragment({
      weapon,
      targetElevationMslFt,
      fragmentHeightMarginPercent: args.fragmentHeightMarginPercent,
      fragmentMarginAppliesTo: args.fragmentMarginAppliesTo,
      releaseAltitudeMslFt,
      releaseSpeedKcas,
      speedOvershootKcas: args.speedOvershootKcas,
      diveAngleDeg,
      recoveryG: args.recoveryG,
      gOnsetTimeSec: args.gOnsetTimeSec,
      bombTofSec: bomb.bombTofSec,
      bombRangeFt: bomb.bombRangeFt,
      windAlongFps: -windFps * Math.cos(windRad),
      windCrossFps: -windFps * Math.sin(windRad),
      semEnd: args.semEnd,
      csemTargetFpaDeg: args.csemTargetFpaDeg,
      semTurn: args.semTurn ?? null,
      csemTurn: args.csemTurn ?? null,
    });
  } catch (error) {
    if (error?.semErrors) return null;
    throw error;
  }
  const cylinder = fragmentCylinder({ weapon, targetElevationMslFt, fragmentHeightMarginPercent: args.fragmentHeightMarginPercent, fragmentMarginAppliesTo: args.fragmentMarginAppliesTo });
  return {
    releaseAltitudeMslFt,
    bombTofSec: bomb.bombTofSec,
    semMinimumAltitudeMslFt: sem.semMinimumAltitudeMslFt,
    fragmentRadiusFt: cylinder.radiusFt,
    fragmentTopMslFt: targetElevationMslFt + cylinder.heightAglFt,
    // >= 0: never inside the full cylinder from impact to the end of the fragment time.
    cylinderClearanceFt: cylinderClearance(sem.samples, {
      impactSec: bomb.bombTofSec,
      endSec: bomb.bombTofSec + cylinder.timeSec,
      impactDownFt: bomb.bombRangeFt,
      impactCrossFt: -windFps * Math.sin(windRad) * bomb.bombTofSec,
      windAlongFps: -windFps * Math.cos(windRad),
      radiusFt: cylinder.radiusFt,
      topMslFt: targetElevationMslFt + cylinder.heightAglFt,
    }),
  };
}

function holds(trial, args) {
  return trial !== null && trial.semMinimumAltitudeMslFt > args.targetElevationMslFt && trial.cylinderClearanceFt >= 0;
}

// Returns { model, nltReleaseMslFt, solved, iterations, atNlt }. `pullNltReleaseMslFt` is the §6.3 NLT.
// Inside an owning BE call (the Common calculation cache) the solve runs once per exact argument set.
export function calculateNltAfterImpact(args, { pullNltReleaseMslFt }) {
  const model = { ...NLT_AFTER_IMPACT_MODEL_V0_1 };
  return cachedCalculation("nlt-after-impact", { model, args, pullNltReleaseMslFt }, () => {
    const top = evaluateNltTrial(args, pullNltReleaseMslFt);
    // The CSEM cannot be flown at the pull NLT (the SEM is then INVALID): the pull NLT stands.
    if (!holds(top, args)) return { model, nltReleaseMslFt: pullNltReleaseMslFt, solved: false, iterations: 1, atNlt: top };
    // Safeguarded secant (Illinois) on f(R) = cylinder clearance; a trial that fails outright (no SEM, bottom at the
    // Target) counts as f < 0. The kept answer is always a Release that holds.
    const cfg = NLT_AFTER_IMPACT_MODEL_V0_1;
    const floor = args.targetElevationMslFt + 1;
    const f = (trial) => (trial !== null && trial.semMinimumAltitudeMslFt > args.targetElevationMslFt ? trial.cylinderClearanceFt : -Infinity);
    let high = pullNltReleaseMslFt;
    let highEval = top;
    let fHigh = f(top);
    let low = null;
    let fLow = null;
    let iterations = 1;
    // Downward until bracketed: step by f (the clearance falls about one for one with Release).
    while (low === null) {
      if (high <= floor) return { model, nltReleaseMslFt: high, solved: true, iterations, atNlt: highEval };
      // Clearance already ~0 (at MINALT inside the radius): one Release-tolerance step down confirms the root.
      const step = fHigh <= cfg.clearanceToleranceFt ? cfg.releaseToleranceFt : Math.max(fHigh, cfg.minStepFt);
      const next = Math.max(floor, high - step);
      const trial = evaluateNltTrial(args, next);
      iterations += 1;
      const value = f(trial);
      if (value >= 0) {
        [high, highEval, fHigh] = [next, trial, value];
      } else {
        [low, fLow] = [next, value];
      }
    }
    let side = 0;
    while (high - low > cfg.releaseToleranceFt && iterations < cfg.maxIterations) {
      // Regula falsi point (Illinois-weighted); bisection when the low side has no finite value.
      let next = Number.isFinite(fLow) ? high - (fHigh * (high - low)) / (fHigh - fLow) : (low + high) / 2;
      if (!(next > low && next < high)) next = (low + high) / 2;
      const trial = evaluateNltTrial(args, next);
      iterations += 1;
      const value = f(trial);
      if (value >= 0) {
        [high, highEval, fHigh] = [next, trial, value];
        if (side === 1 && Number.isFinite(fLow)) fLow /= 2;
        side = 1;
      } else {
        [low, fLow] = [next, value];
        if (side === -1) fHigh /= 2;
        side = -1;
      }
    }
    return { model, nltReleaseMslFt: high, solved: true, iterations, atNlt: highEval };
  });
}
