// POP-UP Design tab step 4 Fine tune (owner 2026-11-20, DESIGN-STEPS.md §4; S4): finds the value of one existing input
// that gives the target the user typed, by calling the existing POP-UP Flight a few times (secant). No new formula.
//   target "holdDownSec"           Approach-Pop (Hold-Down) Time, whole seconds (owner: "정수 단위").
//   target "rollInAltitudeMslFt"   Roll-in Altitude.         } one of the two (owner: they move together,
//   target "pullDownAltitudeMslFt" Pull Down Altitude.       }  "둘중에 하나를 선택")
//   knob "apex"   (the default) the Apex side: Roll-in Altitude in height mode, Tracking Time in time mode (the Roll-in
//                 Altitude solved from it). The MAP and the Tracking Time move with it (DESIGN-STEPS.md §4).
//   knob "offset" the Offset Angle, through the step-3 LOCK (Angle Off, else Attack Heading) with the VRP held. Weak
//                 and not always one way (Hold-Down 4.5 / 4.3 / 4.7 s at Angle Off 35 / 50 / 65°): scanned, then refined.
// The Apex is never an input (owner: "APEX는 유저가 튜닝할 필요는 없어"). The answer is the input value to type; the
// page then flies it as any other edit. Pure calculation: no DOM, no storage.
import { calculatePopupFlightFull } from "./popup-flight-v0.1.mjs?v=0.1.25";

export const POPUP_FINE_TUNE_V0_1 = Object.freeze({
  id: "popup-fine-tune-v0.1",
  version: "0.1.0",
  maxRuns: 8,
  tolerance: Object.freeze({ holdDownSec: 0.1, rollInAltitudeMslFt: 15, pullDownAltitudeMslFt: 15 }),
  // Field precision of each knob (the value typed back).
  step: Object.freeze({ rollInAltitudeMslFt: 10, trackingTimeSec: 0.1, angleOffDeg: 1, attackHeadingDeg: 1 }),
  minTrackingTimeSec: 2,
  offsetScanDeg: Object.freeze([-30, -20, -10, 10, 20, 30]),
});

const finite = (v) => Number.isFinite(v);
const clone = (v) => structuredClone(v);
const TARGETS = Object.freeze({
  holdDownSec: (ar) => ar?.popup?.holdDownSec,
  rollInAltitudeMslFt: (ar) => ar?.result?.profile?.public?.resolvedInitialAltitudeMslFt,
  pullDownAltitudeMslFt: (ar) => ar?.popup?.events?.find((e) => e.name === "PULL_DOWN")?.altitudeMslFt,
});

// The baseline: #1's record as the page will send it next (the answer's nextInput: its drivers, LOCKs and AUTO choices
// as they are), so the value found is the one the page flies. Nothing is frozen: an AUTO Popup angle or a VRP-driven
// Offset Angle is solved again for each trial, as the page would.
export function fineTuneBaseline(answer) {
  const record = answer?.output?.nextInput?.aircraft?.[1] ?? answer?.input?.aircraft?.[1];
  if (!record?.values) throw new Error("No #1 record to fine tune");
  const base = clone(record);
  base.state ||= {};
  return base;
}

// The knob for a request: { key, value } now (the page's value).
export function fineTuneKnob(base, knob = "apex") {
  if (knob === "offset") {
    const key = base.locks?.attackHeadingDeg === true && base.locks?.angleOffDeg !== true ? "attackHeadingDeg" : "angleOffDeg";
    return { key, value: Number(base.values[key]) };
  }
  if (base.state?.solveMode === "height") return { key: "rollInAltitudeMslFt", value: Number(base.values.rollInAltitudeMslFt) };
  return { key: "trackingTimeSec", value: Number(base.state?.enteredTrackingTimeSec ?? base.values.trackingTimeSec) };
}

function fly(base, key, value, calculate) {
  const record = clone(base);
  record.values[key] = value;
  if (key === "trackingTimeSec") record.state.enteredTrackingTimeSec = value;
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
export function fineTune(base, request, calculate = calculatePopupFlightFull) {
  const { target, knob = "apex" } = request ?? {};
  const measure = TARGETS[target];
  if (!measure) return { status: "FAILED", runs: 0, message: `Unknown target ${target}` };
  // Approach-Pop Time: whole seconds (owner).
  const want = target === "holdDownSec" ? Math.round(Number(request.value)) : Number(request.value);
  if (!finite(want)) return { status: "FAILED", runs: 0, message: "목표값을 넣어 주세요" };
  const { key, value: start } = fineTuneKnob(base, knob);
  if (!finite(start)) return { status: "FAILED", runs: 0, message: `${key} has no value` };
  const cfg = POPUP_FINE_TUNE_V0_1;
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
    const r = { x, y: ok ? m - want : null, achieved: ok ? m : null, status: ar?.status ?? "FAILED" };
    tried.set(x, r);
    return r;
  };
  const best = () => [...tried.values()].filter((r) => r.y !== null).sort((a, b) => Math.abs(a.y) - Math.abs(b.y))[0] ?? null;
  let a = f(start);
  if (a.y !== null && Math.abs(a.y) <= tol) return done("OK");
  if (knob === "offset") {
    // Weak and not one way: scan around the page's value, then refine between the bracketing pair.
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
  // Apex side: secant from the page's value (first trial step 200 ft / 0.5 s).
  let b = f(start + (key === "trackingTimeSec" ? 0.5 : 200));
  for (let i = 0; runs < cfg.maxRuns; i += 1) {
    if (a.y === null || b.y === null || b.y === a.y) break;
    const next = b.x - (b.y * (b.x - a.x)) / (b.y - a.y);
    const c = f(next);
    if (c.y === null) break;
    if (Math.abs(c.y) <= tol || c.x === b.x) break;
    a = b; b = c;
  }
  return done(best() && Math.abs(best().y) <= tol ? "OK" : "CLOSEST");

  function done(status) {
    const r = best();
    if (!r) return { status: "FAILED", key, runs, message: "이 범위에서 날 수 있는 값이 없습니다" };
    return {
      status: status === "OK" ? "OK" : "CLOSEST",
      key,
      value: r.x,
      target,
      want,
      achieved: r.achieved,
      runs,
      message: status === "OK" ? "" : `정확히 맞는 값이 없어 가장 가까운 값입니다 (차이 ${r.y.toFixed(target === "holdDownSec" ? 2 : 0)})`,
    };
  }
}
