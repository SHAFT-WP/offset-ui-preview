// Ground-referenced tracking flight path in wind (BDP SPEC §8, user decision 2026-09-29).
//
// Dive Angle is the flight-path angle over the horizontal ground plane — the FPM line; angle of
// attack is not modelled. Wind does not tilt that line: the aircraft keeps flying it at its true
// airspeed, so its speed along the line is the ground speed for which |ground velocity − wind| = TAS.
// The bomb leaves with that ground velocity and then drifts with the wind, so Bomb Range, MAP and AOD
// change while the Aim-off Point (where the FPM line meets the ground) does not.

export const FLIGHT_PATH_WIND_V0_1 = Object.freeze({
  id: "flight-path-wind-v0.1",
  version: "0.1.0",
  reference: "GROUND",
});

// Wind "from" direction relative to Attack Heading (0° = headwind) → air-mass velocity along the
// attack track (+forward) and across it, in the unit of `windSpeed`. Same convention as ballistics.
export function windComponents(windDirectionDeg, windSpeed) {
  const rad = (windDirectionDeg * Math.PI) / 180;
  return { along: -windSpeed * Math.cos(rad), cross: -windSpeed * Math.sin(rad) };
}

// Speed along a descending ground-referenced path of `pathAngleDeg` (0 = level) for true airspeed
// `airspeed`; all speeds share one unit. Still air returns the airspeed exactly.
export function groundSpeedAlongPath({ airspeed, pathAngleDeg, windAlong = 0, windCross = 0 }) {
  if (windAlong === 0 && windCross === 0) return airspeed;
  const rad = (pathAngleDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const radicand = airspeed * airspeed - windAlong * windAlong * sin * sin - windCross * windCross;
  const speed = windAlong * Math.cos(rad) + Math.sqrt(Math.max(radicand, 0));
  if (!(radicand > 0) || !(speed > 0)) {
    throw new RangeError("Wind is too strong for the airspeed to hold the Dive Angle flight path");
  }
  return speed;
}
