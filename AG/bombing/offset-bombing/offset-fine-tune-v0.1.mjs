// Offset Design tab step 3 Fine tune (owner 2026-11-23, "핍업 부분 뺀 나머지를 옮겨줘": POP-UP's step-4 Fine tune,
// popup-fine-tune-v0.1, without the pop-up targets): finds the value of one existing input that gives the target the
// user typed, by calling the existing Offset Flight a few times (secant). No new formula.
//   target "approachSec"          Approach Time (Turn End → Roll-in Start), 0.1 s.
//   target "approachRangeNm"      Approach Range.
//   target "rollInAltitudeMslFt"  Roll-in Altitude.
//   knob "bdp"    (the default) the BDP side: Roll-in Altitude in height / Roll-in LOCK mode, Tracking Time in time mode
//                 (the Roll-in Altitude solved from it). The MAP and the Roll-in Point move with it.
//   knob "offset" the Offset Angle, through the step-2 LOCK (Angle Off, else Attack Heading) with the VRP held.
//                 Not always one way: scanned around the page's value, then refined.
// The answer is the input value to type; the page then flies it as any other edit. Pure calculation: no DOM, no storage.
// 0.2.0 (owner 2026-11-28: "롤인 고도를 움직이는 이유는 해가 없는 상황을 극복하기 위한 것", "미세 튜닝으로 옮기는 것이 좋겠네",
// "approaching range에서 속도 유지하면서 상승하려면 한계가 클 것"): the Roll-in Altitude make-up moves from Design step 3 to
// here.
//   target "offsetAngleDeg"       |Offset Angle| (0.1°), BDP knob only: with the VRP and the Angle Off (or Attack Heading)
//                                 LOCKed the BE solves the Offset Angle, and the Roll-in Altitude moves it.
//   limits { climbFpm, descentFpm } (positive): the Roll-in Altitude change is flown at the Offset speed (constant) from
//                                 the Approach start to 3 s before the Roll-in Start (as the #2 matcher's pitch,
//                                 offset-follower-time-v0.1 followerPitch): verticalFpm = Δh / (Approach Time − 3 s),
//                                 Δh = new − page's Roll-in Altitude. With the BDP knob and an Approach / Offset Angle
//                                 target, an answer outside −descentFpm…+climbFpm is not typed: the value inside the limit
//                                 closest to the target is (status "LIMIT", with the fpm the exact answer needed). A typed
//                                 Roll-in Alt target is only reported against the limit. Defaults +3,000 / −4,000 fpm
//                                 (about 75 % of the PW-229 MIL research model's constant-CAS climb, ~4,000 fpm at
//                                 16,000 ft / 350 KCAS; research model, not BMS-validated).
import { calculateOffsetFlightUnfittedFull } from "./offset-flight-v0.1.mjs?v=0.1.22";

export const OFFSET_FINE_TUNE_V0_1 = Object.freeze({
  id: "offset-fine-tune-v0.1",
  version: "0.2.0",
  maxRuns: 8,
  limitRuns: 7,
  tolerance: Object.freeze({ approachSec: 0.1, approachRangeNm: 0.01, rollInAltitudeMslFt: 15, offsetAngleDeg: 0.1 }),
  defaultLimits: Object.freeze({ climbFpm: 3000, descentFpm: 4000 }),
  pitchLeadSec: 3,
  // Field precision of each knob (the value typed back).
  step: Object.freeze({ rollInAltitudeMslFt: 10, trackingTimeSec: 0.1, angleOffDeg: 1, attackHeadingDeg: 1 }),
  minTrackingTimeSec: 2,
  offsetScanDeg: Object.freeze([-30, -20, -10, 10, 20, 30]),
});

const finite = (v) => Number.isFinite(v);
const clone = (v) => structuredClone(v);
export const OFFSET_FINE_TUNE_TARGETS = Object.freeze({
  approachSec: (ar) => ar?.result?.timing?.approachSec,
  approachRangeNm: (ar) => ar?.result?.resolved?.approachRangeNm,
  rollInAltitudeMslFt: (ar) => ar?.result?.profile?.public?.resolvedInitialAltitudeMslFt,
  offsetAngleDeg: (ar) => (finite(ar?.result?.geometry?.offsetAngleDeg) ? Math.abs(ar.result.geometry.offsetAngleDeg) : null),
});
const rollInOf = (ar) => ar?.result?.profile?.public?.resolvedInitialAltitudeMslFt;

// The Roll-in Altitude change of an answer from the page's Roll-in Altitude: flown at constant speed from the Approach
// start to 3 s before the Roll-in Start. verticalFpm is ±Infinity when that time is not positive and Δh ≠ 0.
export function altitudeChange(ar, fromFt) {
  return changeFrom(rollInOf(ar), ar?.result?.timing?.approachSec, fromFt);
}
function changeFrom(to, approachSec, fromFt) {
  if (!finite(to) || !finite(fromFt)) return null;
  const deltaFt = to - fromFt;
  const sec = finite(approachSec) ? approachSec - OFFSET_FINE_TUNE_V0_1.pitchLeadSec : null;
  const verticalFpm = Math.abs(deltaFt) < 0.5 ? 0 : sec > 0 ? (deltaFt / sec) * 60 : Math.sign(deltaFt) * Infinity;
  return { fromFt, toFt: to, deltaFt, sec, verticalFpm };
}
export const withinLimits = (change, limits) => !!change && change.verticalFpm <= limits.climbFpm + 1e-9 && change.verticalFpm >= -limits.descentFpm - 1e-9;

// The baseline: #1's record as the page will send it next (the answer's nextInput: its drivers and LOCKs as they are),
// so the value found is the one the page flies.
export function fineTuneBaseline(answer) {
  const record = answer?.output?.nextInput?.aircraft?.[1] ?? answer?.input?.aircraft?.[1];
  if (!record?.values) throw new Error("No #1 record to fine tune");
  const base = clone(record);
  base.state ||= {};
  return base;
}

// The knob for a request: { key, value } now (the page's value).
export function fineTuneKnob(base, knob = "bdp") {
  if (knob === "offset") {
    const key = base.locks?.attackHeadingDeg === true && base.locks?.angleOffDeg !== true ? "attackHeadingDeg" : "angleOffDeg";
    return { key, value: Number(base.values[key]) };
  }
  if (base.state?.solveMode === "time") return { key: "trackingTimeSec", value: Number(base.state?.enteredTrackingTimeSec ?? base.values.trackingTimeSec) };
  return { key: "rollInAltitudeMslFt", value: Number(base.values.rollInAltitudeMslFt) };
}

function fly(base, key, value, calculate) {
  const record = clone(base);
  record.values[key] = value;
  if (key === "trackingTimeSec") record.state.enteredTrackingTimeSec = value;
  // A Roll-in Altitude LINKed to the Initial Altitude moves both (as the page's edit does).
  if (key === "rollInAltitudeMslFt" && record.state.rollInAltitudeLinked) record.values.initialAltitudeMslFt = value;
  if (key === "angleOffDeg" || key === "attackHeadingDeg") {
    record.locks = { ...(record.locks ?? {}), [key]: true, offsetAngleDeg: false, actionRangeNm: false, approachRangeNm: false };
  }
  try {
    return calculate({ schemaVersion: 2, flightSize: 1, aircraft: { 1: record } })?.aircraftResults?.[1] ?? null;
  } catch {
    return null;
  }
}

// request = { target, value, knob }. Returns { status: "OK" | "CLOSEST" | "FAILED", key, value (to type), achieved,
// runs, message }.
export function fineTune(base, request, calculate = calculateOffsetFlightUnfittedFull) {
  const { target } = request ?? {};
  // The Offset Angle and a typed Roll-in Altitude are reached by the BDP side only.
  const knob = target === "offsetAngleDeg" || target === "rollInAltitudeMslFt" ? "bdp" : request?.knob ?? "bdp";
  const measure = OFFSET_FINE_TUNE_TARGETS[target];
  if (!measure) return { status: "FAILED", runs: 0, message: `Unknown target ${target}` };
  const limits = { ...OFFSET_FINE_TUNE_V0_1.defaultLimits };
  for (const k of ["climbFpm", "descentFpm"]) { const v = Number(request?.limits?.[k]); if (finite(v) && v >= 0) limits[k] = v; }
  const limited = knob === "bdp" && target !== "rollInAltitudeMslFt";
  const want = Number(request.value);
  if (!finite(want)) return { status: "FAILED", runs: 0, message: "목표값을 넣어 주세요" };
  const { key, value: start } = fineTuneKnob(base, knob);
  if (!finite(start)) return { status: "FAILED", runs: 0, message: `${key} has no value` };
  const cfg = OFFSET_FINE_TUNE_V0_1;
  const step = cfg.step[key];
  const tol = cfg.tolerance[target];
  const snap = (v) => {
    let x = Math.round(v / step) * step;
    if (key === "trackingTimeSec") x = Math.max(cfg.minTrackingTimeSec, x);
    return +x.toFixed(6);
  };
  let runs = 0;
  const tried = new Map();
  const f = (v) => {
    const x = snap(v);
    if (tried.has(x)) return tried.get(x);
    runs += 1;
    const ar = fly(base, key, x, calculate);
    const m = measure(ar);
    const ok = ar && (ar.status === "VALID" || ar.status === "WARNING") && finite(m);
    const r = { x, y: ok ? m - want : null, achieved: ok ? m : null, status: ar?.status ?? "FAILED", rollInFt: rollInOf(ar), approachSec: ar?.result?.timing?.approachSec };
    tried.set(x, r);
    return r;
  };
  const changeOf = (r) => (knob === "bdp" && r ? changeFrom(r.rollInFt, r.approachSec, fromFt) : null);
  const inLimit = (r) => !limited || withinLimits(changeOf(r), limits);
  const best = (keep = () => true) => [...tried.values()].filter((r) => r.y !== null && keep(r)).sort((a, b) => Math.abs(a.y) - Math.abs(b.y))[0] ?? null;
  let a = f(start);
  // The page's own Roll-in Altitude (the Δh of every other value is from it).
  const fromFt = a.rollInFt;
  if (a.y !== null && Math.abs(a.y) <= tol) return done("OK");
  if (knob === "offset") {
    for (const d of cfg.offsetScanDeg) f(start + d);
    const pts = [...tried.values()].filter((r) => r.y !== null).sort((p, q) => p.x - q.x);
    let pair = null;
    for (let i = 1; i < pts.length; i += 1) if (Math.sign(pts[i - 1].y) !== Math.sign(pts[i].y)) { pair = [pts[i - 1], pts[i]]; break; }
    for (let i = 0; pair && i < 4 && runs < cfg.maxRuns + 6; i += 1) {
      const [p, q] = pair;
      if (Math.abs(q.x - p.x) <= step) break;
      const m = f(p.x - (p.y * (q.x - p.x)) / (q.y - p.y));
      if (m.y === null) break;
      if (Math.abs(m.y) <= tol) break;
      pair = Math.sign(m.y) === Math.sign(p.y) ? [m, q] : [p, m];
    }
    return done(best() && Math.abs(best().y) <= tol ? "OK" : "CLOSEST");
  }
  // BDP side: secant from the page's value (first trial step 200 ft / 0.5 s).
  let b = f(start + (key === "trackingTimeSec" ? 0.5 : 200));
  for (let i = 0; runs < cfg.maxRuns; i += 1) {
    if (a.y === null || b.y === null || b.y === a.y) break;
    const c = f(b.x - (b.y * (b.x - a.x)) / (b.y - a.y));
    if (c.y === null) break;
    if (Math.abs(c.y) <= tol || c.x === b.x) break;
    a = b; b = c;
  }
  return done(best() && Math.abs(best().y) <= tol ? "OK" : "CLOSEST");

  function done(status) {
    const exact = best();
    if (!exact) return { status: "FAILED", key, runs, limits, message: "이 범위에서 날 수 있는 값이 없습니다" };
    let r = exact;
    let over = null;
    if (limited && !inLimit(exact)) {
      over = exact;
      // The limit edge between the page's value (Δh 0, inside) and the answer outside it: bisection on the knob.
      let lo = tried.get(snap(start));
      let hi = exact;
      for (let i = 0; i < cfg.limitRuns && lo && Math.abs(hi.x - lo.x) > step; i += 1) {
        const m = f((lo.x + hi.x) / 2);
        if (m.y !== null && inLimit(m)) lo = m; else hi = m;
      }
      r = best(inLimit);
      if (!r) return { status: "FAILED", key, runs, limits, over: summary(over), message: "Roll-in 고도 변경 한도 안에서 날 수 있는 값이 없습니다" };
    }
    const digits = target === "rollInAltitudeMslFt" ? 0 : target === "offsetAngleDeg" ? 1 : 2;
    const fpm = (v) => `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("en-US")} fpm`;
    return {
      status: over ? "LIMIT" : status === "OK" ? "OK" : "CLOSEST",
      key,
      value: r.x,
      target,
      want,
      achieved: r.achieved,
      runs,
      limits,
      change: changeOf(r),
      // The exact answer the limit kept out: its value, what it reaches and the fpm it needed.
      over: over ? summary(over) : null,
      message: over
        ? `Roll-in 고도 변경 한도(+${limits.climbFpm.toLocaleString("en-US")} / −${limits.descentFpm.toLocaleString("en-US")} fpm) 안에서 가장 가까운 값입니다 (차이 ${r.y.toFixed(digits)}; 정확히 맞추려면 ${finite(changeOf(over)?.verticalFpm) ? fpm(changeOf(over).verticalFpm) : "Approach가 3 s 이하라 고도 변경 불가"})`
        : status === "OK" ? "" : `정확히 맞는 값이 없어 가장 가까운 값입니다 (차이 ${r.y.toFixed(digits)})`,
    };
  }
  function summary(o) { return { value: o.x, achieved: o.achieved, change: changeOf(o) }; }
}
