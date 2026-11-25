// Offset Design tab step 5, #2 Top View (owner 2026-11-25: "2번기 angle off와 attack heading 구하는 탑뷰에서 1번기의 영역도
// 구해줘", option "5단계에 #2 Top View 새로"): the possible region of a follower. With the whole Flight as the page sends it,
// the follower's Angle Off is swept (its Angle Off LOCK, everything else of #n as set, #1 unchanged); each point is one
// Flight solve, read as the #1 region points are (offset-design-region-v0.1 regionPoint): Roll-in Point, Attack Heading,
// Offset Angle, Approach, level (VALID / WARNING / not drawn), plus the release time from the predecessor's impact.
// Pure calculation: no DOM, no storage.
import { calculateOffsetFlightUnfittedFull } from "./offset-flight-v0.1.mjs?v=0.1.22";
import { releaseFromPredecessorImpactSec, withFollowerKnob } from "./offset-follower-time-v0.1.mjs?v=0.1.4";

export const OFFSET_FOLLOWER_REGION_V0_1 = Object.freeze({ id: "offset-follower-region-v0.1", version: "0.1.0", minTrackingSec: 2 });

const finite = (v) => Number.isFinite(v);

// The region point of #number at one Angle Off. input = the whole Flight (followerTimeBaseline).
export function followerRegionPoint(input, number, angleOffDeg, calculate = calculateOffsetFlightUnfittedFull) {
  let output;
  try {
    output = calculate(withFollowerKnob(input, number, "angleOff", angleOffDeg));
  } catch (error) {
    return { angleOffDeg, status: "FAILED", level: "bad", messages: [error.message] };
  }
  const ar = output?.aircraftResults?.[number];
  const g = ar?.result?.geometry;
  const messages = [...(ar?.errors ?? []), ...(ar?.warnings ?? [])].slice(0, 2);
  if (!g?.points?.rollStart) return { angleOffDeg, status: ar?.status ?? "FAILED", level: "bad", messages };
  const approachRangeNm = finite(g.approachRangeNm) ? g.approachRangeNm : null;
  const pub = ar.result?.profile?.public ?? {};
  const trackingTimeSec = finite(pub.trackingTimeSec) ? pub.trackingTimeSec : null;
  const shortTrack = trackingTimeSec !== null && trackingTimeSec < OFFSET_FOLLOWER_REGION_V0_1.minTrackingSec - 0.05;
  if (shortTrack) messages.unshift(`Tracking Time ${trackingTimeSec.toFixed(1)} s < ${OFFSET_FOLLOWER_REGION_V0_1.minTrackingSec} s`);
  const level = approachRangeNm === null || approachRangeNm < 0 || shortTrack ? "bad" : ar.status === "VALID" ? "ok" : ar.status === "WARNING" ? "warn" : "bad";
  return {
    angleOffDeg,
    status: ar.status,
    level,
    rollDirection: g.direction?.rollDirection ?? null,
    messages: messages.slice(0, 2),
    trackingTimeSec,
    attackHeadingDeg: g.attackHeadingDeg,
    offsetAngleDeg: g.offsetAngleDeg,
    approachRangeNm,
    approachSec: finite(ar.result?.timing?.approachSec) ? ar.result.timing.approachSec : null,
    rollIn: { x: g.points.rollStart.x, y: g.points.rollStart.y },
    rollInRangeNm: g.rollInRangeNm,
    mapNm: g.groundRangeNm,
    releaseFromLeadImpactSec: releaseFromPredecessorImpactSec(output, number),
  };
}
