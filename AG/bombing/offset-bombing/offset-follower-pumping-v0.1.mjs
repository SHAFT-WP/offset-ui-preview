// Offset Design tab, #2 step, pumping (owner 2026-11-24: "a. 맞음. 두번째는 반대 방향으로 / b. pumping 이라고 하고 기본
// 4G라고 해라"): when #2's attack side (its Roll-in direction) is not its formation side, #2 crosses behind the leader
// before the IP:
//   1. a level turn of 90° toward the attack side (Pumping G, default 4 G, at #2's Offset TAS),
//   2. straight across the Run-In, perpendicular to it, until it crosses the leader's track (behind the leader's tail),
//   3. a level turn of 90° the opposite way, back to the Run-In heading.
// The leader flies the Run-In at the same TAS all the while. The result is #2's formation at the end (on the attack
// side, abeam distance = the turn radius) and the time the pumping takes. Echelon = #2 rolls in the same way as #1,
// Bracket = the opposite way (owner 2026-11-24, c).
// Frame: the leader at the origin at the start, flying +y (the Run-In); x to the right. Bearing as the formation
// (offset-formation-v0.1): from the leader's abeam line, aft positive. Pure calculation: no DOM, no storage.
export const OFFSET_FOLLOWER_PUMPING_V0_1 = Object.freeze({ id: "offset-follower-pumping-v0.1", version: "0.1.0", defaultG: 4 });

const G_FPS2 = 32.174;
const FT_PER_NM = 6076.115;
const KT_TO_FPS = FT_PER_NM / 3600;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const finite = (v) => Number.isFinite(v);
const SIDES = new Set(["LEFT", "RIGHT"]);

// Level turn radius (NM) for a load factor and TAS.
export function pumpingRadiusNm(g, tasKt) {
  if (!(g > 1) || !(tasKt > 0)) return null;
  const v = tasKt * KT_TO_FPS;
  return (v * v) / (G_FPS2 * Math.sqrt(g * g - 1)) / FT_PER_NM;
}

// Echelon / Bracket from the two Roll-in directions.
export function attackPairing(leadDirection, followerDirection) {
  if (!SIDES.has(leadDirection) || !SIDES.has(followerDirection)) return null;
  return leadDirection === followerDirection ? "ECHELON" : "BRACKET";
}

// formation { side, bearingDeg, distanceNm }, attackSide "LEFT" | "RIGHT", tasKt, g.
export function pumpingPath({ formation, attackSide, tasKt, g = OFFSET_FOLLOWER_PUMPING_V0_1.defaultG }) {
  const side = formation?.side;
  const b = Number(formation?.bearingDeg);
  const d = Number(formation?.distanceNm);
  if (!SIDES.has(side) || !SIDES.has(attackSide) || !finite(b) || !finite(d)) return { needed: null, message: "포메이션이나 공격방향이 없습니다" };
  if (side === attackSide) return { needed: false };
  const r = pumpingRadiusNm(Number(g), Number(tasKt));
  if (!r) return { needed: true, message: "Pumping G는 1보다 커야 하고 속도가 있어야 합니다" };
  // Work on the right-hand case (#2 on the left, attacking right); mirror x for the other.
  const s = attackSide === "RIGHT" ? 1 : -1;
  const lateral = d * Math.cos(rad(b)); // #2's distance from the leader's track
  const aft0 = d * Math.sin(rad(b)); // behind the leader's abeam line
  // The first turn moves #2 r toward the track, the leg covers the rest up to the track (lateral - r), and the
  // second turn, started on the track, carries #2 r past it. Closer than r: no leg (flagged).
  const leg = lateral - r;
  const tightNm = leg < 0 ? -leg : 0;
  const straight = Math.max(0, leg);
  const v = tasKt * KT_TO_FPS / FT_PER_NM; // NM/s
  const turnSec = (Math.PI / 2) * r / v;
  const legSec = straight / v;
  const timeSec = 2 * turnSec + legSec;
  // Positions (right-hand case): #2 starts at (-lateral, -aft0).
  const y1 = -aft0 + r; // after turn 1, heading +x
  const crossY = y1; // the leg is along x, so it crosses the track at this y
  const leadYAtCross = v * (turnSec + legSec);
  const endY = y1 + r; // after turn 2, heading +y, at x = +r
  const leadYEnd = v * timeSec;
  const aftEnd = leadYEnd - endY;
  const end = { side: attackSide, bearingDeg: +deg(Math.atan2(aftEnd, r)).toFixed(1), distanceNm: +Math.hypot(r, aftEnd).toFixed(2) };
  const behindTail = crossY < leadYAtCross;
  const pts = (x, y) => ({ x: s * x, y });
  return {
    needed: true,
    g: Number(g),
    tasKt: Number(tasKt),
    radiusNm: r,
    legNm: straight,
    tightNm,
    turnSec,
    timeSec,
    behindTail,
    crossBehindNm: leadYAtCross - crossY,
    end,
    // The path for a drawing, in the leader-start frame (NM): start, end of turn 1, track crossing, end.
    points: { start: pts(-lateral, -aft0), turn1End: pts(-lateral + r, y1), cross: pts(-lateral + r + straight, crossY), end: pts(-lateral + r + straight + r, endY) },
    leaderEnd: { x: 0, y: leadYEnd },
    message: !behindTail ? "리더 앞을 지납니다 (꼬리 뒤로 못 지남)" : tightNm > 0 ? `편대 간격이 선회반경보다 ${tightNm.toFixed(2)} NM 좁습니다 (직선 구간 없음)` : "",
  };
}

// The Flight input with #n's formation set to the end of the pumping.
export function withPumpedFormation(input, number, path) {
  const next = structuredClone(input);
  if (!path?.needed || !path.end) return next;
  next.aircraft[number].formation = { ...(next.aircraft[number].formation ?? {}), ...path.end };
  return next;
}
