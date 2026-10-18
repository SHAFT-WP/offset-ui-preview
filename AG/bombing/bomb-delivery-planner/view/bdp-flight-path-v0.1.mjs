import { tasToCas } from "../../../../common/airspeed/airspeed-v0.1.mjs";

// BDP flight path v0.1 (owner 2026-10-15, BDP update R6; plan §4.6): the aircraft's 3D path and attitude from a
// BDP v0.4.1 result — Roll-in (0.1 s samples with bank, FPA, G), tracking along the FPM line to Release, then the
// SEM (BDP SPEC §6.6) — for the 3D and HUD views. Pure: no DOM. Display only; it calculates nothing new.
// Frame (ft): origin on the ground under the Roll-in Point, y = the Initial heading, x = its right, z = height
// above the Target. Headings are relative to the Initial heading (right +), bank is right wing down +.

export const BDP_FLIGHT_PATH_V0_1 = Object.freeze({
  id: "bdp-flight-path-v0.1",
  version: "0.1.0",
  // HUD angle of attack (research viewer SPEC §5.4, BMS 4.38.1 fit, PROVISIONAL): a + b·G / CAS² (deg, CAS m/s).
  hudAoa: Object.freeze({ aDeg: -0.31, b: 135700 }),
  padlockRateDegSec: 60,
});

const FT_PER_NM = 6076.11549;
const MPS_PER_KT = 0.514444;
const KT_TO_FPS = 1.687809857;
const DEG = Math.PI / 180;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function hudAoaDeg(loadFactor, casKt) {
  const cas = casKt * MPS_PER_KT;
  return BDP_FLIGHT_PATH_V0_1.hudAoa.aDeg + (BDP_FLIGHT_PATH_V0_1.hudAoa.b * loadFactor) / (cas * cas);
}

// rollDirection: the side the Roll-in turns to (the BDP frame's turn side). LEFT mirrors x, heading and bank.
export function buildBdpFlightPath(result, { rollDirection = "RIGHT" } = {}) {
  const pub = result?.public;
  const input = result?.canonicalInputs;
  const roll = result?.visualization?.rollInTrajectorySamples;
  if (!pub || !input || !Array.isArray(roll) || roll.length < 2) throw new TypeError("a BDP v0.4 result is required");
  if (!Number.isFinite(roll[0].timeSec)) throw new TypeError("Roll-in samples need times (BDP v0.4)");
  const side = rollDirection === "LEFT" ? -1 : 1;
  const elevation = finite("targetElevationMslFt", input.targetElevationMslFt);
  const initialAglFt = pub.resolvedInitialAltitudeMslFt - elevation;
  const kcasAt = (tasKt, aglFt) => tasToCas(tasKt, aglFt + elevation);
  const samples = roll.map((s) => ({
    t: s.timeSec,
    x: side * s.turnSideNm * FT_PER_NM,
    y: s.forwardNm * FT_PER_NM,
    z: initialAglFt - s.altitudeLossFt,
    headingDeg: side * s.headingChangeDeg,
    fpaDeg: s.fpaDeg,
    bankDeg: side * s.bankDeg,
    loadFactor: s.loadFactor,
    kcas: kcasAt(s.tasKt, initialAglFt - s.altitudeLossFt),
    phase: "roll-in",
  }));
  const trackPoint = samples[samples.length - 1];
  const attackDeg = side * input.angleOffDeg;
  const along = { x: Math.sin(attackDeg * DEG), y: Math.cos(attackDeg * DEG) };
  const diveDeg = input.diveAngleDeg;
  const releaseAglFt = pub.effectiveReleaseAltitudeMslFt - elevation;
  const trackingSec = pub.trackingTimeSec;
  const releaseKcas = input.releaseSpeedKcas;
  // Tracking: the FPM line from the Track Point to Release (none when the Tracking Time is not positive).
  let release = { ...trackPoint };
  if (trackingSec > 0) {
    const travelFt = pub.downRangeTravelNm * FT_PER_NM;
    release = {
      t: trackPoint.t + trackingSec,
      x: trackPoint.x + along.x * travelFt,
      y: trackPoint.y + along.y * travelFt,
      z: releaseAglFt,
      headingDeg: attackDeg,
      fpaDeg: -diveDeg,
      bankDeg: 0,
      loadFactor: Math.cos(diveDeg * DEG),
      kcas: releaseKcas,
      phase: "tracking",
    };
    samples.push(release);
  }
  // SEM (BDP v0.4.1): ground distance from the Release point along the attack axis.
  const sem = result.visualization.semPathSamples ?? [];
  sem.forEach((s, index) => {
    if (index === 0) return;
    samples.push({
      t: release.t + s.timeSec,
      x: release.x + along.x * s.downRangeNm * FT_PER_NM,
      y: release.y + along.y * s.downRangeNm * FT_PER_NM,
      z: s.altitudeAglFt,
      headingDeg: attackDeg,
      fpaDeg: s.fpaDeg,
      bankDeg: 0,
      loadFactor: s.loadFactorG,
      kcas: kcasAt(s.tasKt, s.altitudeAglFt),
      phase: "sem",
    });
  });
  const target = { x: side * result.diagnostics.targetTurnSideNm * FT_PER_NM, y: result.diagnostics.targetForwardNm * FT_PER_NM, z: 0 };
  // Aim-off Point: where the Track Point's FPM line meets the Target plane.
  const aimRangeFt = trackPoint.z / Math.tan(diveDeg * DEG);
  const aim = diveDeg > 0 ? { x: trackPoint.x + along.x * aimRangeFt, y: trackPoint.y + along.y * aimRangeFt, z: 0 } : null;
  const fragment = pub.fragmentCheck?.applicable ? { ...pub.fragment, impactT: release.t + pub.fragment.impactTimeSec } : null;
  return {
    model: { ...BDP_FLIGHT_PATH_V0_1 },
    samples,
    target,
    aim,
    trackPoint: { ...trackPoint },
    release: { ...release },
    trackPointT: trackPoint.t,
    releaseT: release.t,
    endT: samples[samples.length - 1].t,
    plannedIaaDeg: result.local?.aimOffAngleDeg ?? null,
    diveDeg,
    rollDirection: side > 0 ? "RIGHT" : "LEFT",
    fragment,
    // TAS at the Roll-in Point: the straight, level approach before it (flightStateAt at t < 0).
    initialTasKt: roll[0].tasKt,
    minAltAglFt: pub.minAltMslFt - elevation,
    semMinAglFt: pub.semMinimumAltitudeAglFt ?? null,
  };
}

// State at time t (s from the Roll-in Point): linear between samples, clamped to the end of the path. Before
// the Roll-in Point the aircraft flies its first state straight and level at the Roll-in TAS (the approach).
export function flightStateAt(path, t) {
  const s = path.samples;
  if (!(t > s[0].t)) {
    const back = Number.isFinite(t) ? (s[0].t - t) * (path.initialTasKt ?? 0) * KT_TO_FPS : 0;
    const h = s[0].headingDeg * DEG;
    return { ...s[0], t: Number.isFinite(t) ? Math.min(t, s[0].t) : s[0].t, x: s[0].x - Math.sin(h) * back, y: s[0].y - Math.cos(h) * back, phase: back > 0 ? "approach" : s[0].phase };
  }
  if (t >= s[s.length - 1].t) return { ...s[s.length - 1] };
  let i = 1;
  while (s[i].t < t) i += 1;
  const a = s[i - 1];
  const b = s[i];
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const mix = (key) => a[key] + (b[key] - a[key]) * k;
  return {
    t,
    x: mix("x"), y: mix("y"), z: mix("z"),
    headingDeg: mix("headingDeg"), fpaDeg: mix("fpaDeg"), bankDeg: mix("bankDeg"),
    loadFactor: mix("loadFactor"), kcas: mix("kcas"),
    phase: b.phase,
  };
}

// Aircraft axes at a state: velocity v and the body right / up vectors (bank about v; right wing down +).
export function aircraftAxes(state) {
  const h = state.headingDeg * DEG;
  const g = state.fpaDeg * DEG;
  const v = [Math.sin(h) * Math.cos(g), Math.cos(h) * Math.cos(g), Math.sin(g)];
  // Wings-level right (horizontal) and up (in the vertical plane through v).
  const r0 = [Math.cos(h), -Math.sin(h), 0];
  const u0 = [r0[1] * v[2] - r0[2] * v[1], r0[2] * v[0] - r0[0] * v[2], r0[0] * v[1] - r0[1] * v[0]];
  const c = Math.cos(state.bankDeg * DEG);
  const s = Math.sin(state.bankDeg * DEG);
  return {
    v,
    right: [r0[0] * c - u0[0] * s, r0[1] * c - u0[1] * s, r0[2] * c - u0[2] * s],
    up: [u0[0] * c + r0[0] * s, u0[1] * c + r0[1] * s, u0[2] * c + r0[2] * s],
  };
}

// Padlock (owner 2026-10-15, plan §0.1 / §4.6): the gaze has turned `progressDeg` from the HUD centre toward the
// Target. Held: it grows at 60°/s and stops at the Target (locked); released: it shrinks back at the same rate;
// held again on the way back: it grows again from where it is. `totalDeg` (HUD centre → Target) may change
// between frames, so the progress is clamped to it.
export function padlockStep(progressDeg, { holding, dtSec, totalDeg }) {
  const rate = BDP_FLIGHT_PATH_V0_1.padlockRateDegSec;
  const total = Math.max(0, totalDeg);
  const next = holding ? progressDeg + rate * dtSec : progressDeg - rate * dtSec;
  return Math.min(total, Math.max(0, next));
}

// Fragment cylinder size at time t (BDP SPEC §6.6): radius and height (ft) or null outside its time.
export function fragmentAt(path, t) {
  const f = path.fragment;
  if (!f) return null;
  const after = t - f.impactT;
  if (!(after > 0 && after < f.timeSec)) return null;
  const k = after <= f.peakAfterImpactSec ? after / f.peakAfterImpactSec : (f.timeSec - after) / (f.timeSec - f.peakAfterImpactSec);
  return { radiusFt: f.radiusFt * k, heightFt: f.heightAglFt * k };
}
