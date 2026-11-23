// POP-UP Design tab step 3 (owner 2026-11-20, DESIGN-STEPS.md §3, decision 2 / 3; S3): the possible region on the Top
// View. With the VRP held and the Popup Angle LOCKed (step 2), the Angle Off is swept; each point is one direct POP-UP
// Flight solve (VRP LOCK + Angle Off LOCK, the Offset Angle / Attack Heading / Approach solved by the BE as on the
// page). No new formula: this module only calls the existing Flight on a grid and reads its answers.
//   point  → Roll-in Point (Roll-in Start), Attack Heading, Offset Angle, Approach Range, Approach-Pop (Hold-Down).
//   level  → "ok" Approach-Pop ≥ 2 s (solid), "warn" 0–2 s (light), "bad" < 0 s or no solution (not drawn).
// 0.1.1 (owner 2026-11-20 follow-up, "내가 쭉 왼쪽으로 롤인했을 때 오른쪽 색칠해줘"): both Roll-in sides. The BE keeps the
// side of the Attack Heading it is given (directionRule: Attack Heading right of the Run-In = right Roll-in); the other
// side is the same sweep from a baseline with the Attack Heading mirrored about the Run-In (regionMirrorBaseline).
// Each point carries its rollDirection; regionSummary takes a side.
// Pure calculation: no DOM, no storage.
import { calculatePopupFlightFull } from "./popup-flight-v0.1.mjs?v=0.1.24";
import { sweepBaseline } from "./popup-dependency-sweep-v0.1.mjs?v=0.1.3";

export const POPUP_OFFSET_REGION_V0_1 = Object.freeze({ id: "popup-offset-region-v0.1", version: "0.1.1", recommendedSec: 2 });

const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(6));
// Angle Off grid (5°): coarse points (every 15°) are solved first so the region shows early.
export const ANGLE_OFF_GRID = Object.freeze(range(5, 175, 5));
export const coarseFirst = (grid) => [...grid].sort((a, b) => ((a % 15 === 0 ? 0 : 1) - (b % 15 === 0 ? 0 : 1)) || a - b);

const finite = (v) => Number.isFinite(v);
const clone = (v) => structuredClone(v);

// The step-3 baseline from the page's last answer: #1's record with the automatic choices frozen (sweepBaseline with
// the VRP kept), the Popup Angle LOCKed at the angle flown, and the VRP LOCKed.
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
export function regionPoint(base, angleOffDeg, calculate = calculatePopupFlightFull) {
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
  const p = ar?.popup;
  const messages = [...(ar?.errors ?? []), ...(ar?.warnings ?? [])].slice(0, 2);
  if (!g?.points?.rollStart) return { angleOffDeg, status: ar?.status ?? "FAILED", level: "bad", messages };
  const holdDownSec = finite(p?.holdDownSec) ? p.holdDownSec : null;
  const flies = ar.status === "VALID" || ar.status === "WARNING";
  const level = !flies || holdDownSec === null || holdDownSec < 0 ? "bad" : holdDownSec < POPUP_OFFSET_REGION_V0_1.recommendedSec ? "warn" : "ok";
  return {
    angleOffDeg,
    status: ar.status,
    level,
    rollDirection: g.direction?.rollDirection ?? null,
    messages,
    attackHeadingDeg: g.attackHeadingDeg,
    offsetAngleDeg: g.offsetAngleDeg,
    approachRangeNm: g.approachRangeNm,
    holdDownSec,
    holdDownNm: finite(p?.holdDownNm) ? p.holdDownNm : null,
    rollIn: { x: g.points.rollStart.x, y: g.points.rollStart.y },
    rollInRangeNm: g.rollInRangeNm,
    mapNm: g.groundRangeNm,
  };
}

// The region from the solved points: the Angle Off / Attack Heading range at each end of the drawn arcs (Approach-Pop
// ≥ 0 s, and ≥ 2 s for the recommended part). Points in Angle Off order; each range is the widest run of drawn points.
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
