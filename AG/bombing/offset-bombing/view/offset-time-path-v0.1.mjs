// Offset time path — where an aircraft is T seconds after crossing its IP (user request 2026-10-02:
// the Top View "Time" dial shows the path flown up to T and the velocity vector at T).
// Pure world-frame helper (NM, x east, y north) built from a solved Offset result; the Top View
// draws it. Time zero is the aircraft's own IP, the same reference as the drop-order ΔTime
// (offset-formation-v0.1 computeDropOrderDelta), so every aircraft of a Flight shares one clock.
// Legs and their durations are the BE's (result.timing, profile.public):
//   ingress  IP → Action Point                  timing.ingressSec
//   turn     Offset turn arc → Turn End         timing.offsetTurnSec
//   approach Turn End → Roll-in                 timing.approachSec
//   roll-in  Roll-in trajectory → Track Point   profile.public.rollInTimeSec (samples every 0.1 s)
//   tracking Track Point → Release              profile.public.trackingTimeSec (a negative value flies 0 s)
//   bomb     Release → Target                   profile.public.bombTofSec (the bomb; the aircraft stays at Release)
// A negative leg (an INVALID geometry) is flown in 0 s.

export const OFFSET_TIME_PATH_V0_1 = Object.freeze({
  id: "offset-time-path-v0.1",
  version: "0.1.0",
  phases: Object.freeze(["ingress", "turn", "approach", "roll-in", "tracking", "bomb"]),
});

const ROLL_SAMPLE_SEC = 0.1;

function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
function lerp(a, b, f) { return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
function unit(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-12 ? { x: dx / length, y: dy / length } : null;
}
const nonNegative = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

// Leg from a polyline with a time per vertex (strictly increasing within the leg).
function polylineLeg(phase, points, times) {
  return { phase, points, times, durationSec: times[times.length - 1] - times[0] };
}
function straightLeg(phase, from, to, durationSec) {
  return polylineLeg(phase, [from, to], [0, nonNegative(durationSec)]);
}

function arcPoints(center, start, end, turnDirection, steps = 48) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  // x east / y north: a LEFT turn is counter-clockwise.
  if (turnDirection === "LEFT") while (endAngle <= startAngle) endAngle += Math.PI * 2;
  else while (endAngle >= startAngle) endAngle -= Math.PI * 2;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

export function offsetTimeline(result) {
  const geometry = result?.geometry;
  const points = geometry?.points;
  const timing = result?.timing;
  const profile = result?.profile?.public;
  if (!points || !timing || !profile) throw new TypeError("a solved Offset result is required");

  const legs = [];
  legs.push(straightLeg("ingress", points.ip, points.realActionPoint, timing.ingressSec));

  const turnSec = nonNegative(timing.offsetTurnSec);
  if (finitePoint(points.offsetCenter) && turnSec > 0) {
    const arc = arcPoints(points.offsetCenter, points.realActionPoint, points.turnEnd, geometry.direction?.offsetDirection);
    legs.push(polylineLeg("turn", arc, arc.map((_, index) => (turnSec * index) / (arc.length - 1))));
  } else {
    legs.push(straightLeg("turn", points.realActionPoint, points.turnEnd, 0));
  }

  legs.push(straightLeg("approach", points.turnEnd, points.rollStart, timing.approachSec));

  const rollSec = nonNegative(profile.rollInTimeSec);
  const samples = (geometry.rollInTrajectorySamples ?? []).filter(finitePoint);
  if (samples.length >= 2 && rollSec > 0) {
    // Samples are taken every 0.1 s of the roll-in; the last one is the roll-out (Track Point).
    const times = samples.map((_, index) => (index === samples.length - 1 ? rollSec : Math.min(index * ROLL_SAMPLE_SEC, rollSec)));
    for (let index = 1; index < times.length; index += 1) times[index] = Math.max(times[index], times[index - 1]);
    legs.push(polylineLeg("roll-in", samples, times));
  } else {
    legs.push(straightLeg("roll-in", points.rollStart, points.trackPoint, rollSec));
  }

  const trackSec = nonNegative(profile.trackingTimeSec);
  const attack = unit(points.trackPoint, points.target);
  const travelNm = trackSec > 0 ? nonNegative(profile.downRangeTravelNm) : 0;
  const release = attack ? { x: points.trackPoint.x + attack.x * travelNm, y: points.trackPoint.y + attack.y * travelNm } : points.trackPoint;
  legs.push(straightLeg("tracking", points.trackPoint, release, trackSec));
  legs.push(straightLeg("bomb", release, points.target, profile.bombTofSec));

  let clock = 0;
  for (const leg of legs) {
    leg.startSec = clock;
    clock += leg.durationSec;
    leg.endSec = clock;
  }
  const bombLeg = legs[legs.length - 1];
  return {
    legs,
    release,
    releaseSec: bombLeg.startSec,
    impactSec: bombLeg.endSec,
    // Aircraft (and, after Release, bomb) state at T seconds after IP. T is clamped to [0, Impact].
    at(timeSec) {
      const t = Math.min(Math.max(Number(timeSec) || 0, 0), bombLeg.endSec);
      const flown = [];
      let aircraft = null;
      let heading = null;
      let phase = "ingress";
      for (const leg of legs) {
        if (leg.phase === "bomb") break;
        const local = t - leg.startSec;
        if (local < 0) break;
        phase = leg.phase;
        const { points: path, times } = leg;
        let index = 1;
        while (index < times.length - 1 && times[index] < local) index += 1;
        // Vertices already passed, then the interpolated current point.
        for (let i = 0; i < index; i += 1) if (times[i] <= local) flown.push(path[i]);
        const span = times[index] - times[index - 1];
        const fraction = span > 0 ? Math.min(1, Math.max(0, (local - times[index - 1]) / span)) : 1;
        aircraft = lerp(path[index - 1], path[index], fraction);
        flown.push(aircraft);
        heading = unit(path[index - 1], path[index]) ?? heading;
        if (local < leg.durationSec) break;
      }
      const released = t >= bombLeg.startSec && bombLeg.durationSec >= 0;
      const bomb = released
        ? lerp(release, points.target, bombLeg.durationSec > 0 ? (t - bombLeg.startSec) / bombLeg.durationSec : 1)
        : null;
      return { timeSec: t, phase: released ? "released" : phase, aircraft, heading, flown, bomb };
    },
  };
}
