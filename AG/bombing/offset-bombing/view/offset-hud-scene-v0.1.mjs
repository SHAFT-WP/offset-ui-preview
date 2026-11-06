import { offsetTimeline, offsetApproachInBdpFrame } from './offset-time-path-v0.1.mjs?v=0.1.4';
import { buildBdpFlightPath, flightStateAt } from '../../bomb-delivery-planner/view/bdp-flight-path-v0.1.mjs?v=0.1.6';
import { tasToCas } from '../../../../common/airspeed/airspeed-v0.1.mjs';

// Display adapter only: all aircraft share the existing IP clock and one target-elevation datum.
// 0.1.3: the time path 0.1.3 (POP-UP approach: Hold-Down, then the climb).
export const OFFSET_HUD_SCENE_V0_1 = Object.freeze({ version: '0.1.3' });
const FT = 6076.11549;
export function offsetHudWorldPoint(p, origin, headingDeg, elevationDelta = 0, timeOffset = 0) {
  if (!p) return null;
  const h = headingDeg * Math.PI / 180;
  return { ...p, x: origin.x * FT + p.x * Math.cos(h) + p.y * Math.sin(h),
    y: origin.y * FT - p.x * Math.sin(h) + p.y * Math.cos(h), z: p.z + elevationDelta,
    ...(Number.isFinite(p.t) ? { t: p.t + timeOffset } : {}),
    ...(Number.isFinite(p.headingDeg) ? { headingDeg: ((p.headingDeg + headingDeg) % 360 + 360) % 360 } : {}) };
}
export function buildOffsetHudAircraft(result, { number = 1, groundElevationMslFt, approachOverride = null } = {}) {
  if (!result?.profile) throw Error('No BDP flight data');
  const timeline = offsetTimeline(result);
  const rollSec = timeline.legs.find(l => l.phase === 'roll-in').startSec;
  const elevation = result.profile.canonicalInputs.targetElevationMslFt;
  const datum = groundElevationMslFt ?? elevation;
  const altitude = result.resolved.offsetAltitudeMslFt;
  const tas = result.resolved.offsetTasKt;
  if (![rollSec, elevation, datum, altitude, tas].every(Number.isFinite)) throw Error('Missing Offset altitude/speed');
  let approach = (offsetApproachInBdpFrame(result, rollSec) ?? []).map(s => ({ ...s, z: altitude - elevation, fpaDeg: 0, kcas: tasToCas(tas, altitude) }));
  if (approachOverride?.approach?.length) {
    const first = approachOverride.approach[0].t;
    approach = [...approach.filter(s => s.t < first), ...approachOverride.approach];
  }
  const local = buildBdpFlightPath(result.profile, { rollDirection: result.geometry.direction.rollDirection, approach, startSec: -rollSec });
  // No vertical transition exists in the ordinary Offset BE for independent unequal altitudes.
  const preRollUnavailable = !approachOverride && Math.abs(altitude - result.profile.public.resolvedInitialAltitudeMslFt) > 1;
  const convert = p => offsetHudWorldPoint(p, result.geometry.points.rollStart, result.geometry.offsetHeadingDeg, elevation - datum, rollSec);
  const path = { ...local, samples: local.samples.map(convert), approach: preRollUnavailable ? [convert(local.samples[0])] : local.approach.map(convert), bomb: local.bomb.map(convert),
    target: convert(local.target), aim: convert(local.aim), trackPoint: convert(local.trackPoint), release: convert(local.release),
    startT: preRollUnavailable ? rollSec : 0, endT: local.endT + rollSec, releaseT: local.releaseT + rollSec, trackPointT: local.trackPointT + rollSec,
    timeOriginLabel: 'IP',
    fragment: local.fragment ? { ...local.fragment, impact: convert(local.fragment.impact), impactT: local.fragment.impactT + rollSec } : null };
  return { number, path, rollSec, startSec: path.startT, endSec: path.endT,
    warning: result.state === 'INVALID' ? `#${number} INVALID: ${(result.errors ?? []).join('; ') || 'Check flight results'}` : '',
    at(t) {
      if (!Number.isFinite(t) || t < 0 || t > path.endT) return null;
      if (preRollUnavailable && t < rollSec) return null;
      return flightStateAt(path, t);
    },
    unavailableReason: preRollUnavailable ? 'Offset / Roll-in altitude transition unavailable' : 'Outside flight window' };
}
// 0.1.2 (Play speed): each path's ground extent is kept per path object; the clock asks for the step every frame.
const pathExtents = new WeakMap();
function pathExtent(path) {
  let e = pathExtents.get(path);
  if (!e) {
    e = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of [...path.approach, ...path.samples]) { e[0] = Math.min(e[0], p.x); e[1] = Math.max(e[1], p.x); e[2] = Math.min(e[2], p.y); e[3] = Math.max(e[3], p.y); }
    pathExtents.set(path, e);
  }
  return e;
}
export function offsetHudGridStep(aircraft) {
  const extents = aircraft.map(a => pathExtent(a.path)).filter(e => Number.isFinite(e[0]));
  if (!extents.length) return FT;
  const span = Math.max(Math.max(...extents.map(e => e[1])) - Math.min(...extents.map(e => e[0])), Math.max(...extents.map(e => e[3])) - Math.min(...extents.map(e => e[2]))) / FT;
  return ([.25, .5, 1, 2, 5, 10].find(n => span / n <= 10) ?? 10) * FT;
}
