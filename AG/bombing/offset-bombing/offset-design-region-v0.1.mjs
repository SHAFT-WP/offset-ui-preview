// Offset Design tab step 2 (owner 2026-11-23, "핍업 부분 뺀 나머지를 옮겨줘": the POP-UP planning steps without the
// pop-up parts; POP-UP's step 3, popup-offset-region-v0.1, on the Offset Flight): the possible region on the Top View.
// With the VRP held, the Angle Off is swept; each point is one direct Offset Flight solve (VRP LOCK + Angle Off LOCK,
// the Offset Angle / Attack Heading / Approach solved by the BE as on the page). No new formula: this module only calls
// the existing Flight on a grid and reads its answers.
//   point → Roll-in Point (Roll-in Start), Attack Heading, Offset Angle, Approach Range / Time.
//   level → "ok" VALID (solid), "warn" WARNING (light), "bad" INVALID, no solution or Approach Range < 0 (not drawn).
//   The Offset has no Approach-Pop: the level is the Flight's own status (no new threshold).
// Both Roll-in sides: the BE keeps the side of the Attack Heading it is given, so the other side is the same sweep from
// a baseline with the Attack Heading mirrored about the Run-In (regionMirrorBaseline).
// Pure calculation: no DOM, no storage.
import { calculateOffsetFlightUnfittedFull } from "./offset-flight-v0.1.mjs?v=0.1.22";
import { sweepBaseline } from "./offset-dependency-sweep-v0.1.mjs?v=0.1.0";

// 0.2.0 (owner 2026-11-24: "1. bdp 셋팅 2. offset 조건 셋팅 (vrp, offset angle, roll in 고도 변경 유무 체크) 3. angle off 가용범위
// 도시 4. 미세튜닝"): the Angle Off range for a set VRP and Offset Angle (angleOffCandidate). With the VRP, the Offset
// Angle and the Angle Off all held the geometry is closed by the BDP alone, so:
//   Roll-in Altitude held   → each Angle Off gives its own Offset Angle (VRP + Angle Off LOCK, Offset Angle solved by the
//                             BE); the Angle Off that fits is where that Offset Angle crosses the set one (one or a few).
//   Roll-in Altitude free   → for each Angle Off the Roll-in Altitude (height mode, 10 ft) is searched so the solved
//                             Offset Angle equals the set one; the Angle Off range is where such an altitude flies.
export const OFFSET_DESIGN_REGION_V0_1 = Object.freeze({
  id: "offset-design-region-v0.1",
  version: "0.2.1",
  offsetToleranceDeg: 0.2,
  altitudeStepFt: 10,
  altitudeScanFt: Object.freeze({ aboveReleaseFt: 1000, maxFt: 35000, stepFt: 2000 }),
});

const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(6));
// Angle Off grid (5°): coarse points (every 15°) are solved first so the region shows early.
export const ANGLE_OFF_GRID = Object.freeze(range(5, 175, 5));
export const coarseFirst = (grid) => [...grid].sort((a, b) => ((a % 15 === 0 ? 0 : 1) - (b % 15 === 0 ? 0 : 1)) || a - b);

const finite = (v) => Number.isFinite(v);
const clone = (v) => structuredClone(v);

// The step-2 baseline from the page's last answer: #1's record (sweepBaseline with the VRP kept) with the VRP LOCKed.
export function regionBaseline(answer) {
  const base = sweepBaseline(answer, 1, { keepVrp: true });
  base.locks = { ...(base.locks ?? {}), vrpReference: true };
  return base;
}

// The other Roll-in side: the Attack Heading mirrored about the Run-In heading (an Attack Heading on the Run-In, which
// has no side, is moved 10° off it first). Everything else is the same baseline.
export function regionMirrorBaseline(base, answer) {
  const mirror = clone(base);
  const g = answer?.output?.aircraftResults?.[1]?.result?.geometry;
  const runIn = Number(g?.runInHeadingDeg ?? mirror.values.runInHeadingDeg ?? 0);
  let atk = Number(g?.attackHeadingDeg ?? mirror.values.attackHeadingDeg);
  if (!finite(atk)) atk = runIn + 30;
  let delta = ((atk - runIn + 540) % 360) - 180;
  if (Math.abs(delta) < 1) delta = 10;
  mirror.values.attackHeadingDeg = +(((runIn - delta) % 360 + 360) % 360).toFixed(6);
  return mirror;
}

// One Angle Off: VRP + Angle Off LOCKed, the Attack Heading / Offset Angle / Action / Approach solved by the BE.
export function regionPoint(base, angleOffDeg, calculate = calculateOffsetFlightUnfittedFull) {
  const record = clone(base);
  record.values.angleOffDeg = angleOffDeg;
  record.locks = { ...(record.locks ?? {}), angleOffDeg: true, attackHeadingDeg: false, offsetAngleDeg: false, actionRangeNm: false, approachRangeNm: false, vrpReference: true };
  let ar;
  try {
    ar = calculate({ schemaVersion: 2, flightSize: 1, aircraft: { 1: record } })?.aircraftResults?.[1];
  } catch (error) {
    return { angleOffDeg, status: "FAILED", level: "bad", messages: [error.message] };
  }
  const g = ar?.result?.geometry;
  const messages = [...(ar?.errors ?? []), ...(ar?.warnings ?? [])].slice(0, 2);
  if (!g?.points?.rollStart) return { angleOffDeg, status: ar?.status ?? "FAILED", level: "bad", messages };
  const approachRangeNm = finite(g.approachRangeNm) ? g.approachRangeNm : null;
  const level = approachRangeNm === null || approachRangeNm < 0 ? "bad" : ar.status === "VALID" ? "ok" : ar.status === "WARNING" ? "warn" : "bad";
  return {
    angleOffDeg,
    status: ar.status,
    level,
    rollDirection: g.direction?.rollDirection ?? null,
    messages,
    attackHeadingDeg: g.attackHeadingDeg,
    offsetAngleDeg: g.offsetAngleDeg,
    approachRangeNm,
    approachSec: finite(ar.result?.timing?.approachSec) ? ar.result.timing.approachSec : null,
    rollIn: { x: g.points.rollStart.x, y: g.points.rollStart.y },
    rollInRangeNm: g.rollInRangeNm,
    mapNm: g.groundRangeNm,
  };
}

// The region from the solved points: the Angle Off / Attack Heading range at each end of the drawn arcs (VALID or
// WARNING, and VALID for the recommended part). Points in Angle Off order.
export function regionSummary(points, side = null) {
  const pts = [...points].filter((p) => p && finite(p.angleOffDeg) && (!side || p.rollDirection === side)).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
  const span = (ok) => {
    const kept = pts.filter((p) => ok(p.level));
    if (!kept.length) return null;
    const headings = kept.map((p) => p.attackHeadingDeg).filter(finite);
    return {
      angleOffFromDeg: kept[0].angleOffDeg,
      angleOffToDeg: kept[kept.length - 1].angleOffDeg,
      attackHeadingFromDeg: headings.length ? kept[0].attackHeadingDeg : null,
      attackHeadingToDeg: headings.length ? kept[kept.length - 1].attackHeadingDeg : null,
      offsetAngleFromDeg: kept[0].offsetAngleDeg,
      offsetAngleToDeg: kept[kept.length - 1].offsetAngleDeg,
    };
  };
  return { possible: span((l) => l === "ok" || l === "warn"), recommended: span((l) => l === "ok") };
}

// Whether a value lies in a summary span (Angle Off or Attack Heading), for the "outside the region" message.
export function insideSpan(span, key, value) {
  if (!span || !finite(value)) return null;
  const from = span[`${key}FromDeg`];
  const to = span[`${key}ToDeg`];
  if (!finite(from) || !finite(to)) return null;
  return value >= Math.min(from, to) - 0.5 && value <= Math.max(from, to) + 0.5;
}

const offsetOf = (p) => (finite(p?.offsetAngleDeg) ? Math.abs(p.offsetAngleDeg) : null);

// The record with a Roll-in Altitude typed (height mode; a LINKed Initial Altitude moves with it, as on the page).
export function withRollInAltitude(base, altitudeFt) {
  const record = clone(base);
  record.values.rollInAltitudeMslFt = altitudeFt;
  if (record.state?.rollInAltitudeLinked) record.values.initialAltitudeMslFt = altitudeFt;
  record.state = { ...(record.state ?? {}), solveMode: "height" };
  return record;
}

// One Angle Off for a set Offset Angle. Returns the region point (regionPoint) with
//   offsetResidualDeg  solved |Offset Angle| − set one (Roll-in Altitude held), or after the altitude search;
//   rollInAltitudeMslFt the Roll-in Altitude used (found when rollInFree);
//   fits               |residual| ≤ tolerance and the point flies (level ok / warn).
export function angleOffCandidate(base, angleOffDeg, { offsetAngleDeg, rollInFree = false, startAltitudeFt = null } = {}, calculate = calculateOffsetFlightUnfittedFull) {
  const cfg = OFFSET_DESIGN_REGION_V0_1;
  const want = Math.abs(Number(offsetAngleDeg));
  const heldAlt = Number(base.values.rollInAltitudeMslFt);
  const at = (alt) => {
    const p = regionPoint(alt === null ? base : withRollInAltitude(base, alt), angleOffDeg, calculate);
    const oa = offsetOf(p);
    return { ...p, rollInAltitudeMslFt: alt ?? (finite(heldAlt) ? heldAlt : null), offsetResidualDeg: oa === null || p.level === "bad" ? null : oa - want };
  };
  const finish = (p, runs) => ({ ...p, targetOffsetAngleDeg: want, rollInFree, runs, fits: p.offsetResidualDeg !== null && Math.abs(p.offsetResidualDeg) <= cfg.offsetToleranceDeg && p.level !== "bad" });
  if (!finite(want)) return finish(at(null), 1);
  if (!rollInFree) return finish(at(null), 1);
  // Search the Roll-in Altitude (0.2.1, owner 2026-11-24 "16초면 팝업보다 오래 걸려"): the solved Offset Angle moves
  // smoothly with the altitude, so a secant from the page's altitude (or the caller's start) usually lands in 3–5
  // solves; only when it does not, a coarse scan (4,000 ft) and bisection.
  const step = cfg.altitudeStepFt;
  const snap = (v) => Math.round(v / step) * step;
  const lowRaw = snap(Number(base.values.releaseAltitudeMslFt) + cfg.altitudeScanFt.aboveReleaseFt);
  const low = finite(lowRaw) ? lowRaw : 8000;
  const high = cfg.altitudeScanFt.maxFt;
  const clampAlt = (v) => Math.min(high, Math.max(low, snap(v)));
  const tried = new Map();
  const f = (alt) => { const x = clampAlt(alt); if (!tried.has(x)) tried.set(x, at(x)); return tried.get(x); };
  const good = (p) => p.offsetResidualDeg !== null && Math.abs(p.offsetResidualDeg) <= cfg.offsetToleranceDeg / 2;
  const best = () => [...tried.values()].filter((p) => p.offsetResidualDeg !== null).sort((a, b) => Math.abs(a.offsetResidualDeg) - Math.abs(b.offsetResidualDeg))[0] ?? at(null);
  const start = clampAlt(finite(startAltitudeFt) ? startAltitudeFt : finite(heldAlt) ? heldAlt : (low + high) / 2);
  let p = f(start);
  if (good(p)) return finish(p, tried.size);
  let q = f(start + (start + 2000 <= high ? 2000 : -2000));
  for (let i = 0; i < 5 && p.offsetResidualDeg !== null && q.offsetResidualDeg !== null && !good(q); i += 1) {
    const dy = q.offsetResidualDeg - p.offsetResidualDeg;
    if (dy === 0) break;
    const x = clampAlt(q.rollInAltitudeMslFt - (q.offsetResidualDeg * (q.rollInAltitudeMslFt - p.rollInAltitudeMslFt)) / dy);
    if (tried.has(x)) break;
    p = q;
    q = f(x);
  }
  if (good(best())) return finish(best(), tried.size);
  // Fallback: a coarse scan, then bisection on the bracket nearest the start.
  for (let a = low; a <= high; a += 4000) f(a);
  const pts = [...tried.values()].filter((r) => r.offsetResidualDeg !== null).sort((a, b) => a.rollInAltitudeMslFt - b.rollInAltitudeMslFt);
  const pairs = [];
  for (let i = 1; i < pts.length; i += 1) if (Math.sign(pts[i - 1].offsetResidualDeg) !== Math.sign(pts[i].offsetResidualDeg)) pairs.push([pts[i - 1], pts[i]]);
  if (!pairs.length) return finish(best(), tried.size);
  pairs.sort((u, v) => Math.abs((u[0].rollInAltitudeMslFt + u[1].rollInAltitudeMslFt) / 2 - start) - Math.abs((v[0].rollInAltitudeMslFt + v[1].rollInAltitudeMslFt) / 2 - start));
  [p, q] = pairs[0];
  for (let i = 0; i < 12 && q.rollInAltitudeMslFt - p.rollInAltitudeMslFt > step; i += 1) {
    let x = p.rollInAltitudeMslFt - (p.offsetResidualDeg * (q.rollInAltitudeMslFt - p.rollInAltitudeMslFt)) / (q.offsetResidualDeg - p.offsetResidualDeg);
    if (!(x > p.rollInAltitudeMslFt + step / 2 && x < q.rollInAltitudeMslFt - step / 2)) x = (p.rollInAltitudeMslFt + q.rollInAltitudeMslFt) / 2;
    const m = f(x);
    if (m.offsetResidualDeg === null) break;
    if (good(m)) break;
    if (Math.sign(m.offsetResidualDeg) === Math.sign(p.offsetResidualDeg)) p = m; else q = m;
  }
  return finish(best(), tried.size);
}

// Roll-in Altitude held: the Angle Offs where the solved Offset Angle crosses the set one, from a sweep of
// angleOffCandidate points (rollInFree false), refined by bisection to 0.1°. Returns the fitting candidates.
export function heldAltitudeSolutions(base, points, offsetAngleDeg, calculate = calculateOffsetFlightUnfittedFull) {
  const pts = [...points].filter((p) => p && p.offsetResidualDeg !== null && p.offsetResidualDeg !== undefined).sort((a, b) => a.angleOffDeg - b.angleOffDeg);
  const out = [];
  for (let i = 1; i < pts.length; i += 1) {
    let p = pts[i - 1];
    let q = pts[i];
    if (Math.sign(p.offsetResidualDeg) === Math.sign(q.offsetResidualDeg) || q.angleOffDeg - p.angleOffDeg > 10) continue;
    let m = null;
    for (let k = 0; k < 12 && q.angleOffDeg - p.angleOffDeg > 0.1; k += 1) {
      const x = +((p.angleOffDeg + q.angleOffDeg) / 2).toFixed(2);
      m = angleOffCandidate(base, x, { offsetAngleDeg }, calculate);
      if (m.offsetResidualDeg === null) break;
      if (Math.abs(m.offsetResidualDeg) <= OFFSET_DESIGN_REGION_V0_1.offsetToleranceDeg / 4) break;
      if (Math.sign(m.offsetResidualDeg) === Math.sign(p.offsetResidualDeg)) p = m; else q = m;
    }
    const best = [p, q, m].filter((c) => c && c.offsetResidualDeg !== null).sort((a, b) => Math.abs(a.offsetResidualDeg) - Math.abs(b.offsetResidualDeg))[0];
    if (best) out.push({ ...best, angleOffDeg: +best.angleOffDeg.toFixed(1), fits: Math.abs(best.offsetResidualDeg) <= OFFSET_DESIGN_REGION_V0_1.offsetToleranceDeg && best.level !== "bad" });
  }
  return out;
}
