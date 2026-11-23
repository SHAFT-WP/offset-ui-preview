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

export const OFFSET_DESIGN_REGION_V0_1 = Object.freeze({ id: "offset-design-region-v0.1", version: "0.1.0" });

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
