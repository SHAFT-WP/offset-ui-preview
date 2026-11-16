// Offset SEM & Rejoin — Flight fragment checks (owning contract: ./SPEC.md "Flight fragment checks").
//
// Owner 2026-11-16 (BEM Vol 5 §5.19 two-ship deconfliction, §5.20 egress): the S&R answer says whether an aircraft
// of the Flight passes through ANOTHER aircraft's bomb fragments, and whether a path ends inside the fragment
// radius around the Target. An aircraft's own bomb is the BDP's check (BDP SPEC §6.6 / §6.11) and is not repeated.
//
// The fragment cylinder is the BDP's planning cylinder of that bomb (radius and height with the Fragment Height
// Margin), held at full size from its impact to impact + fragment time (the rule of the NLT after impact). An
// aircraft is hit when it is inside the radius AND below the cylinder top at any checked moment.
//
// Pure: no DOM, no storage. The S&R BE passes the state of an aircraft at a time on the shared IP clock.

export const SEM_REJOIN_FRAGMENT_CHECK_V0_1 = Object.freeze({
  id: "offset-sem-rejoin-fragment-check-v0.1",
  version: "0.1.0",
  stepSec: 0.25,
  heightToleranceFt: 0.5,
  assumptions: Object.freeze([
    "FULL_CYLINDER_HELD: radius and height with the margin, from impact to impact + fragment time",
    "ATTACK_RUN_ALTITUDE_IS_RELEASE: before its Release an aircraft's altitude is not modelled (S&R BACKLOG U11); it is taken as its own Release altitude, the lowest of its final dive",
  ]),
});

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const DEG = Math.PI / 180;
const unit = (headingDeg) => ({ x: Math.sin(headingDeg * DEG), y: Math.cos(headingDeg * DEG) });

// The bomb of one aircraft on the IP clock: impact point, cylinder and its time window. null when the upstream
// has no fragment data (INVALID aircraft, Dive 0°).
export function bombOf(number, aircraftResult, upstreamResult) {
  const release = aircraftResult?.release;
  const pub = upstreamResult?.profile?.public;
  const fragment = pub?.fragment;
  if (!release || !fragment) return null;
  const needed = [release.timeSec, release.point?.x, release.point?.y, release.attackHeadingDeg, fragment.radiusNm, fragment.timeSec, fragment.impactTimeSec, fragment.impactDownRangeNm, pub.minAltMslFt];
  if (!needed.every(isFiniteNumber)) return null;
  const attack = unit(release.attackHeadingDeg);
  const right = unit(release.attackHeadingDeg + 90);
  const cross = isFiniteNumber(fragment.impactCrossNm) ? fragment.impactCrossNm : 0;
  const impactSec = release.timeSec + fragment.impactTimeSec;
  return {
    aircraft: number,
    impactSec,
    endSec: impactSec + fragment.timeSec,
    center: { x: release.point.x + attack.x * fragment.impactDownRangeNm + right.x * cross, y: release.point.y + attack.y * fragment.impactDownRangeNm + right.y * cross },
    radiusNm: fragment.radiusNm,
    topMslFt: pub.minAltMslFt,
    marginPercent: isFiniteNumber(fragment.marginPercent) ? fragment.marginPercent : null,
  };
}

// One bomb against one other aircraft over the bomb's fragment time.
function checkPair(bomb, number, releaseAltitudeMslFt, stateAt) {
  const step = SEM_REJOIN_FRAGMENT_CHECK_V0_1.stepSec;
  const result = {
    bomb: bomb.aircraft, aircraft: number, status: "CLEAR", insideFromSec: null, insideToSec: null, worstSec: null, worstPhase: null,
    minHeightRoomFt: null, closestNm: null, altitudeAssumed: false, notEvaluatedSec: 0, notEvaluatedReason: null,
  };
  const count = Math.ceil((bomb.endSec - bomb.impactSec) / step - 1e-9);
  for (let index = 0; index <= count; index += 1) {
    const timeSec = Math.min(bomb.endSec, bomb.impactSec + index * step);
    const at = stateAt(number, timeSec);
    if (!at?.available) {
      // Before its IP the aircraft is not near the Target; any other gap in the path is reported.
      if (at?.phase !== "before-ip") {
        result.notEvaluatedSec += step;
        result.notEvaluatedReason ??= at?.reason ?? "no path";
      }
      continue;
    }
    const distanceNm = Math.hypot(at.state.x - bomb.center.x, at.state.y - bomb.center.y);
    if (result.closestNm === null || distanceNm < result.closestNm) result.closestNm = distanceNm;
    if (distanceNm > bomb.radiusNm) continue;
    let altitude = at.state.altitudeMslFt;
    let assumed = false;
    if (!isFiniteNumber(altitude)) {
      if (!isFiniteNumber(releaseAltitudeMslFt)) {
        result.notEvaluatedSec += step;
        result.notEvaluatedReason ??= "altitude not available";
        continue;
      }
      altitude = releaseAltitudeMslFt;
      assumed = true;
    }
    const room = altitude - bomb.topMslFt;
    if (result.minHeightRoomFt === null || room < result.minHeightRoomFt) {
      result.minHeightRoomFt = room;
      result.worstSec = timeSec;
      result.worstPhase = at.phase;
      result.altitudeAssumed = assumed;
    }
    // 0.5 ft: a SEM that bottoms out exactly at the cylinder top (its own NLT recovery) is not inside.
    if (room < -SEM_REJOIN_FRAGMENT_CHECK_V0_1.heightToleranceFt) {
      result.insideFromSec ??= timeSec;
      result.insideToSec = timeSec;
    }
  }
  if (result.insideFromSec !== null) result.status = "INSIDE";
  else if (result.notEvaluatedSec > 0) result.status = "NOT_EVALUATED";
  return result;
}

const fmtFt = (value) => Math.round(Math.abs(value)).toLocaleString("en-US");
const fmtSec = (value) => `IP+${Math.round(value)} s`;
const PHASE_TEXT = Object.freeze({ attack: "on its attack run", sem: "in its SEM", row: "after its SEM", continuation: "after its last row" });

function pairMessage(pair, bomb) {
  if (pair.status === "INSIDE") {
    const assumed = pair.altitudeAssumed ? " (attack-run altitude taken as its Release altitude)" : "";
    return `#${pair.aircraft} is inside #${pair.bomb}'s fragment cylinder ${PHASE_TEXT[pair.worstPhase] ?? ""}: ${fmtFt(pair.minHeightRoomFt)} ft below its top ${fmtFt(bomb.topMslFt)} ft MSL, ${fmtSec(pair.insideFromSec)} to ${fmtSec(pair.insideToSec)}${assumed}`.replace("  ", " ");
  }
  if (pair.status === "NOT_EVALUATED") {
    // No state at any checked moment (an aircraft without a path): no duration to state.
    const span = pair.closestNm === null ? "" : ` for ${Math.round(pair.notEvaluatedSec)} s`;
    return `#${pair.aircraft} against #${pair.bomb}'s fragments is not checked${span}: ${pair.notEvaluatedReason}`;
  }
  return null;
}

// aircraft: the S&R per-aircraft results; upstream: semRejoinUpstreamView; stateAt(number, timeSec): the S&R state
// of an aircraft on the IP clock (attack run included).
export function checkFlightFragments({ aircraft, upstream, stateAt }) {
  const numbers = Object.keys(aircraft).map(Number).sort((a, b) => a - b);
  const bombs = {};
  for (const number of numbers) {
    const bomb = bombOf(number, aircraft[number], upstream.aircraft?.[number]?.result);
    if (bomb) bombs[number] = bomb;
  }
  const pairs = [];
  const warnings = [];
  for (const bomb of Object.values(bombs)) {
    for (const number of numbers) {
      if (number === bomb.aircraft) continue;
      const releaseAltitude = upstream.aircraft?.[number]?.result?.profile?.public?.effectiveReleaseAltitudeMslFt ?? null;
      const pair = checkPair(bomb, number, releaseAltitude, stateAt);
      pair.message = pairMessage(pair, bomb);
      pairs.push(pair);
      if (pair.message) warnings.push(pair.message);
    }
  }
  // BEM §5.20: rejoin outside the target area. Here the target area is the largest fragment radius of the Flight
  // around the Target; a path that has rows and ends inside it is reported.
  const radii = Object.values(bombs).map((bomb) => bomb.radiusNm);
  const areaRadiusNm = radii.length ? Math.max(...radii) : null;
  const pathEnds = {};
  for (const number of numbers) {
    const entry = aircraft[number];
    const target = upstream.aircraft?.[number]?.result?.geometry?.points?.target;
    const lastRow = [...(entry.rows ?? [])].reverse().find((row) => row.end);
    if (areaRadiusNm === null || !target || !lastRow) continue;
    const distanceNm = Math.hypot(lastRow.end.x - target.x, lastRow.end.y - target.y);
    const outside = distanceNm > areaRadiusNm;
    const message = outside ? null : `#${number}'s path ends ${distanceNm.toFixed(2)} NM from the Target, inside the fragment radius ${areaRadiusNm.toFixed(2)} NM (rejoin outside the target area)`;
    pathEnds[number] = { aircraft: number, step: lastRow.step, timeSec: lastRow.end.timeSec, distanceNm, areaRadiusNm, outside, message };
    if (message) warnings.push(message);
  }
  const status = pairs.some((pair) => pair.status === "INSIDE") || Object.values(pathEnds).some((end) => !end.outside)
    ? "WARNING"
    : pairs.some((pair) => pair.status === "NOT_EVALUATED") ? "NOT_EVALUATED" : pairs.length ? "CLEAR" : "NOT_APPLICABLE";
  return {
    model: { id: SEM_REJOIN_FRAGMENT_CHECK_V0_1.id, version: SEM_REJOIN_FRAGMENT_CHECK_V0_1.version, stepSec: SEM_REJOIN_FRAGMENT_CHECK_V0_1.stepSec, assumptions: [...SEM_REJOIN_FRAGMENT_CHECK_V0_1.assumptions] },
    status,
    bombs,
    pairs,
    pathEnds,
    areaRadiusNm,
    warnings,
  };
}
