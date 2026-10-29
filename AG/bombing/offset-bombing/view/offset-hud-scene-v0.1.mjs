import { offsetTimeline, offsetApproachInBdpFrame } from './offset-time-path-v0.1.mjs?v=0.1.2';
import { buildBdpFlightPath, flightStateAt } from '../../bomb-delivery-planner/view/bdp-flight-path-v0.1.mjs?v=0.1.5';
import { tasToCas } from '../../../../common/airspeed/airspeed-v0.1.mjs';

// Display adapter only: all aircraft share the existing IP clock and one target-elevation datum.
export const OFFSET_HUD_SCENE_V0_1 = Object.freeze({ version: '0.1.0' });
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
  if (!result || result.state === 'INVALID') throw Error('No valid flight path');
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
  const path = { ...local, samples: local.samples.map(convert), approach: local.approach.map(convert), bomb: local.bomb.map(convert),
    target: convert(local.target), aim: convert(local.aim), trackPoint: convert(local.trackPoint), release: convert(local.release),
    startT: 0, endT: local.endT + rollSec, releaseT: local.releaseT + rollSec, trackPointT: local.trackPointT + rollSec,
    timeOriginLabel: 'IP',
    fragment: local.fragment ? { ...local.fragment, impact: convert(local.fragment.impact), impactT: local.fragment.impactT + rollSec } : null };
  return { number, path, rollSec, startSec: 0, endSec: path.endT,
    at(t) {
      if (!Number.isFinite(t) || t < 0 || t > path.endT) return null;
      if (preRollUnavailable && t < rollSec) return null;
      return flightStateAt(path, t);
    },
    unavailableReason: preRollUnavailable ? 'Offset / Roll-in altitude transition unavailable' : 'Outside flight window' };
}
export function offsetHudGridStep(aircraft) {
  const points = aircraft.flatMap(a => [...a.path.approach, ...a.path.samples]);
  if (!points.length) return FT;
  const span = Math.max(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))) / FT;
  return ([.25, .5, 1, 2, 5, 10].find(n => span / n <= 10) ?? 10) * FT;
}
