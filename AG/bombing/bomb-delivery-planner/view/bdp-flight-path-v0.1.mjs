import { tasToCas } from "../../../../common/airspeed/airspeed-v0.1.mjs";

// BDP flight path v0.1 (owner 2026-10-15, BDP update R6; plan §4.6): the aircraft's 3D path and attitude from a
// BDP v0.4.1 result — Roll-in (0.1 s samples with bank, FPA, G), tracking along the FPM line to Release, then the
// SEM (BDP SPEC §6.6) — for the 3D and HUD views. Pure: no DOM. Display only; it calculates nothing new.
// Frame (ft): origin on the ground under the Roll-in Point, y = the Initial heading, x = its right, z = height
// above the Target. Headings are relative to the Initial heading (right +), bank is right wing down +.

export const BDP_FLIGHT_PATH_V0_1 = Object.freeze({
  id: "bdp-flight-path-v0.1",
  // 0.1.1 (2026-10-18, owner handoff §3.1): `approach` — the host's flown path before the Roll-in Point (Offset:
  // the approach leg and the onset Offset Turn), so the HUD can start at Roll-in −3 s on the real path;
  // `hudStartSec` (−3). Before the earliest known state the straight, level extension stays (stand-alone BDP).
// The tracking line ends at Release + Overshoot KCAS, the SEM's start (no speed jump at Release); `sem` carries the
// BDP v0.4.2 SEM record; the fragment envelope sits on the BE's impact point (cross range included).
  // 0.1.2 (2026-10-19, owner): the Level SEM turn (BDP v0.4.3) — SEM samples placed with their cross range (+ =
  // right of the Attack Heading), heading change and bank.
  // 0.1.3 (2026-10-19, owner): the 3D Profile / HUD window — from Roll-in −3 s (`startT`) to 1 s after the SEM ends
  // (`endT`; the SEM's end is the level-off, the end of the Level SEM turn or the CSEM End; Release without a SEM).
  // The path is cut to it (the approach starts at `startT`; the last sample is at `endT`, on the level carry or
  // straight on from the SEM's end) and every state is clamped to it.
  version: "0.1.3",
  window: Object.freeze({ startSec: -3, afterSemEndSec: 1 }),
  hudStartSec: -3,
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
// approach (optional): [{ t (s, ≤ 0, from the Roll-in Point), x, y (ft, this frame), headingDeg, bankDeg,
// loadFactor }] in time order, ending at the Roll-in Point; height and speed are the Roll-in Point's (level).
export function buildBdpFlightPath(result, { rollDirection = "RIGHT", approach = null } = {}) {
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
  // The SEM starts at Release + Overshoot (BDP SPEC §6.6, owner 2026-10-18): the tracking line runs up to it, so
  // the speed shown does not jump at Release (display only; the BDP's release geometry is unchanged).
  const releaseKcas = input.releaseSpeedKcas + (input.speedOvershootKcas ?? 0);
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
  // SEM (BDP v0.4.1): ground distance from the Release point along the attack axis; 0.1.2: the cross range to its
  // right, the heading change and the bank of the Level SEM turn (BDP v0.4.3).
  const right = { x: along.y, y: -along.x };
  const sem = result.visualization.semPathSamples ?? [];
  sem.forEach((s, index) => {
    if (index === 0) return;
    const crossFt = (s.crossRangeNm ?? 0) * FT_PER_NM;
    samples.push({
      t: release.t + s.timeSec,
      x: release.x + along.x * s.downRangeNm * FT_PER_NM + right.x * crossFt,
      y: release.y + along.y * s.downRangeNm * FT_PER_NM + right.y * crossFt,
      z: s.altitudeAglFt,
      headingDeg: attackDeg + (s.headingChangeDeg ?? 0),
      fpaDeg: s.fpaDeg,
      bankDeg: s.bankDeg ?? 0,
      loadFactor: s.loadFactorG,
      kcas: kcasAt(s.tasKt, s.altitudeAglFt),
      phase: "sem",
      semPhase: s.phase,
    });
  });
  // 0.1.3: the window ends 1 s after the SEM's end (its last sample before the level carry).
  const endT = cutAtWindowEnd(samples);
  const target = { x: side * result.diagnostics.targetTurnSideNm * FT_PER_NM, y: result.diagnostics.targetForwardNm * FT_PER_NM, z: 0 };
  // Aim-off Point: where the Track Point's FPM line meets the Target plane.
  const aimRangeFt = trackPoint.z / Math.tan(diveDeg * DEG);
  const aim = diveDeg > 0 ? { x: trackPoint.x + along.x * aimRangeFt, y: trackPoint.y + along.y * aimRangeFt, z: 0 } : null;
  // Fragment envelope on the BE's impact point: Release + impact down range along the attack axis, plus the
  // impact cross range (wind; + = right of the Attack Heading, BDP SPEC §6.6) — 0.1.1.
  const fragment = pub.fragmentCheck?.applicable ? {
    ...pub.fragment,
    impactT: release.t + pub.fragment.impactTimeSec,
    impact: {
      x: release.x + (along.x * (pub.fragment.impactDownRangeNm ?? 0) + along.y * (pub.fragment.impactCrossNm ?? 0)) * FT_PER_NM,
      y: release.y + (along.y * (pub.fragment.impactDownRangeNm ?? 0) - along.x * (pub.fragment.impactCrossNm ?? 0)) * FT_PER_NM,
      z: 0,
    },
  } : null;
  return {
    model: { ...BDP_FLIGHT_PATH_V0_1 },
    samples,
    target,
    aim,
    trackPoint: { ...trackPoint },
    release: { ...release },
    trackPointT: trackPoint.t,
    releaseT: release.t,
    startT: BDP_FLIGHT_PATH_V0_1.window.startSec,
    endT,
    plannedIaaDeg: result.local?.aimOffAngleDeg ?? null,
    diveDeg,
    rollDirection: side > 0 ? "RIGHT" : "LEFT",
    fragment,
    // The SEM flown and its conditions (BDP v0.4 public.sem when the BE gives it; else the level SEM of v0.4.1).
    sem: pub.sem ?? (pub.fragmentCheck?.applicable ? {
      end: "LEVEL",
      recoveryG: input.recoveryG,
      gOnsetTimeSec: input.gOnsetTimeSec,
      recoverySpeedKcas: pub.semRecoverySpeedKcas ?? result.diagnostics?.semRecoverySpeedKcas ?? null,
      targetFpaDeg: null,
      gReleaseStartFpaDeg: null,
      terminalG: null,
      levelOffAltitudeMslFt: pub.semMinimumAltitudeMslFt ?? null,
      endAltitudeMslFt: null,
    } : null),
    targetElevationMslFt: elevation,
    // TAS at the Roll-in Point: the straight, level approach before it (flightStateAt at t < 0).
    initialTasKt: roll[0].tasKt,
    approach: approachSamples(approach, samples[0], BDP_FLIGHT_PATH_V0_1.window.startSec, roll[0].tasKt),
    minAltAglFt: pub.minAltMslFt - elevation,
    semMinAglFt: pub.semMinimumAltitudeAglFt ?? null,
  };
}

// The approach from the window start to the Roll-in Point: the host's samples where they reach back that far
// (interpolated at the start), else the straight, level extension at the Roll-in TAS before the earliest one.
function approachSamples(approach, rollIn, startT, rollInTasKt) {
  const given = (Array.isArray(approach) ? approach : [])
    .filter((a) => [a?.t, a?.x, a?.y, a?.headingDeg].every(Number.isFinite) && a.t < rollIn.t)
    .map((a) => ({ ...rollIn, t: a.t, x: a.x, y: a.y, headingDeg: a.headingDeg, bankDeg: Number.isFinite(a.bankDeg) ? a.bankDeg : 0, loadFactor: Number.isFinite(a.loadFactor) ? a.loadFactor : 1, phase: a.phase ?? "approach" }))
    .sort((a, b) => a.t - b.t);
  const known = [...given, { ...rollIn }];
  let start;
  if (known[0].t <= startT) {
    let j = 1;
    while (known[j].t < startT) j += 1;
    start = between(known[j - 1], known[j], startT);
  } else {
    const first = known[0];
    const back = (first.t - startT) * rollInTasKt * KT_TO_FPS;
    const h = first.headingDeg * DEG;
    start = { ...first, t: startT, x: first.x - Math.sin(h) * back, y: first.y - Math.cos(h) * back, bankDeg: 0, loadFactor: 1, phase: "approach" };
  }
  return [start, ...known.filter((sample) => sample.t > startT + 1e-9)];
}

// Cuts the samples 1 s after the SEM's end (in place) and returns that time: on the level carry where it reaches
// that far, else straight on from the last state (its ground velocity; level when its FPA is 0).
function cutAtWindowEnd(samples) {
  let last = samples.length - 1;
  while (last > 0 && samples[last].semPhase === "level") last -= 1;
  const endT = samples[last].t + BDP_FLIGHT_PATH_V0_1.window.afterSemEndSec;
  let i = last;
  while (i + 1 < samples.length && samples[i + 1].t <= endT) i += 1;
  const next = samples[i + 1];
  const end = samples[i];
  samples.length = i + 1;
  if (next) {
    samples.push(between(end, next, endT));
  } else if (endT > end.t) {
    const before = samples[i - 1] ?? end;
    const dt = end.t - before.t;
    const rate = (key) => (dt > 0 ? (end[key] - before[key]) / dt : 0);
    const span = endT - end.t;
    samples.push({ ...end, t: endT, x: end.x + rate("x") * span, y: end.y + rate("y") * span, z: end.z + (end.fpaDeg === 0 ? 0 : rate("z") * span) });
  }
  return endT;
}

function between(a, b, t) {
  const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const mix = (key) => a[key] + (b[key] - a[key]) * k;
  let dh = b.headingDeg - a.headingDeg;
  dh -= 360 * Math.round(dh / 360);
  return {
    t,
    x: mix("x"), y: mix("y"), z: mix("z"),
    headingDeg: a.headingDeg + dh * k, fpaDeg: mix("fpaDeg"), bankDeg: mix("bankDeg"),
    loadFactor: mix("loadFactor"), kcas: mix("kcas"),
    phase: b.phase,
  };
}

// State at time t (s from the Roll-in Point): linear between samples, clamped to the window (0.1.3: Roll-in −3 s
// to 1 s after the SEM's end; a time that is not a number is the window start). Before the Roll-in Point: the
// approach samples.
export function flightStateAt(path, t) {
  const s = path.samples;
  const early = path.approach ?? [s[0]];
  const startT = Number.isFinite(path.startT) ? path.startT : early[0].t;
  t = Number.isFinite(t) ? Math.max(t, startT) : startT;
  if (!(t > early[0].t)) return { ...early[0] };
  if (path.approach && t < s[0].t) {
    let j = 1;
    while (early[j].t < t) j += 1;
    return { ...between(early[j - 1], early[j], t), phase: early[j - 1].phase };
  }
  if (t >= s[s.length - 1].t) return { ...s[s.length - 1] };
  let i = 1;
  while (s[i].t < t) i += 1;
  return between(s[i - 1], s[i], t);
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
