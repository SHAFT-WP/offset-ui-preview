// Wheel-BOX route geometry v0.7 — the whole Wheel-BOX attack route as stations and paths, built from the Wheel-BOX
// v0.9 composition (AG/bombing/wheel-attack/SPEC.md §18). The view only projects them. v0.6's stations and paths
// (Downwind Angle 0° in v0.9); the validation follows v0.9's Min Wheel Radius (the geometry minimum or the Wheel turn's
// performance minimum, no Base Distance floor) and reports turn limits that are NOT_EVALUATED as warnings.
//
// Frame (NM), BOX's: alongNm along the Attack Heading from the Target (+ past it), sideNm toward the pattern side
// (right of the Attack Heading for RIGHT, left for LEFT). The route:
//   Wheel (Target-centred circle, flown toward Abeam) → Abeam → Abeam Extension (Downwind heading) → Base Turn (Common
//   onset level turn, its samples) → Base Leg → OA1 / Roll-in → Tracking → Release.
// iBT is retired (as BOX): the end of the Abeam Extension is `baseTurnStart`.

import { formatWheelRadiusNm } from "./wheel-box-geometry-v0.6.mjs";

export const WHEEL_BOX_GEOMETRY_MODEL_V0_7 = Object.freeze({
  id: "wheel-box-geometry-v0.7",
  version: "0.7.0",
  status: "Work / Pure Geometry / Not Official",
  source: "wheel-box-be-v0.9 result (wheel + pattern + turns + orbit)",
  frame: "ATTACK_ALONG_PATTERN_SIDE",
});

const CIRCLE_SAMPLES = 96;
const EPS_NM = 0.5 / 1852; // the BOX validation tolerance (0.5 m)
const DEG = Math.PI / 180;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

const at = (alongNm, sideNm) => ({ alongNm, sideNm });
// Radii are stated as v0.6 states them (the Wheel Radius field's 0.01 NM step, rounded up).
export { formatWheelRadiusNm };
// Circle around the Target from angle φ0 to φ1 (rad, 0 = ahead on the attack axis, + toward the pattern side).
const arc = (radiusNm, from, to, samples) => Array.from({ length: samples + 1 }, (_, index) => {
  const phi = from + ((to - from) * index) / samples;
  return at(radiusNm * Math.cos(phi), radiusNm * Math.sin(phi));
});
// An onset turn's samples (its own forward / turn-side frame) placed at `start`, with the entry heading along
// `forward` and the turn toward `turnSide` (unit vectors in the along / side frame).
const placeTurn = (samples, start, forward, turnSide) => samples.map((sample) => at(
  start.alongNm + sample.forwardNm * forward.alongNm + sample.turnSideNm * turnSide.alongNm,
  start.sideNm + sample.forwardNm * forward.sideNm + sample.turnSideNm * turnSide.sideNm,
));

export function buildWheelBoxGeometryV0_7(result) {
  const semantic = result?.bombDelivery?.visualization?.semanticState;
  const base = result?.turns?.base;
  if (!semantic || !result?.wheel || !result?.pattern || !base) {
    throw new TypeError("result must be a Wheel-BOX v0.9 result with its BDP, Wheel, pattern and Base Turn");
  }
  const { wheel, pattern } = result;
  const target = semantic.stations.target;
  // BDP semantic frame (forward = pre-roll-in heading, turn side = Attack Heading) → attack frame.
  const toAttack = (point, name) => at(
    finite(`${name}.turnSideNm`, point.turnSideNm) - target.turnSideNm,
    target.forwardNm - finite(`${name}.forwardNm`, point.forwardNm),
  );

  const radiusNm = finite("wheel.radiusNm", wheel.radiusNm);
  const a = finite("pattern.downwindAngleDeg", pattern.downwindAngleDeg) * DEG;
  const downwind = at(-Math.cos(a), -Math.sin(a));
  const turnSide = at(Math.sin(a), -Math.cos(a));
  const extensionNm = finite("pattern.abeamExtensionSignedNm", pattern.abeamExtensionSignedNm);

  const abeam = at(0, radiusNm);
  const baseTurnStart = at(abeam.alongNm + extensionNm * downwind.alongNm, abeam.sideNm + extensionNm * downwind.sideNm);
  const baseTurn = placeTurn(base.samples, baseTurnStart, downwind, turnSide);
  const baseTurnEnd = baseTurn.at(-1);
  const oa1 = toAttack(semantic.stations.rollInStart, "rollInStart");
  const trackPoint = toAttack(semantic.stations.trackPoint, "trackPoint");
  const release = toAttack(semantic.stations.release, "release");

  const stations = {
    target: at(0, 0),
    trackPoint,
    release,
    // The Wheel is flown toward Abeam (+φ): from the attack axis ahead of the Target, a quarter of the Wheel.
    wheelEntry: at(radiusNm, 0),
    abeam,
    baseTurnStart,
    baseTurnEnd,
    oa1,
  };
  const paths = {
    wheel: arc(radiusNm, 0, 2 * Math.PI, CIRCLE_SAMPLES),
    wheelArc: arc(radiusNm, 0, Math.PI / 2, CIRCLE_SAMPLES / 4),
    minWheel: arc(wheel.minWheelRadiusNm, 0, 2 * Math.PI, CIRCLE_SAMPLES),
    orbit: result.orbit ? arc(result.orbit.orbitRadiusNm, 0, 2 * Math.PI, CIRCLE_SAMPLES) : null,
    tracking: [trackPoint, release],
    abeamExtension: [abeam, baseTurnStart],
    baseTurn,
    baseLeg: [baseTurnEnd, oa1],
    rollIn: semantic.paths.rollIn.map((point) => toAttack(point, "rollIn")),
  };

  // Validation (BOX's rules and Wheel's): a radius below Min Wheel Radius is reported with the radius that fixes it
  // (never clamped); a negative straight segment is never flown backwards. The Wheel turn outside its source limits is an
  // error (Mach cannot be fixed by the radius); limits NOT_EVALUATED (a weapon outside the profile) are a warning, as
  // is anything about the Orbit (not in the attack path).
  const errors = [];
  if (radiusNm + EPS_NM < wheel.minWheelRadiusNm) {
    const why = radiusNm + EPS_NM < wheel.geometryMinWheelRadiusNm ? "the Base Leg would be negative" : "the Wheel turn would exceed its load factor limit";
    errors.push(`Wheel Radius is below Min Wheel Radius (${why}). Required >= ${formatWheelRadiusNm(wheel.minWheelRadiusNm)} NM.`);
  }
  if (extensionNm < -EPS_NM) errors.push("Abeam Extension Distance must be 0 or greater (the Base Turn does not fit inside Base Distance).");
  const warnings = [];
  if (wheel.performance.valid === false) errors.push(`Wheel turn is outside the source-bounded performance (${wheel.performance.issues.join(", ")}).`);
  if (wheel.performance.valid === null) warnings.push(`Wheel turn limits not evaluated: ${wheel.performance.reason}.`);
  if (result.orbit?.performance.valid === false) warnings.push(`Orbit turn is outside the source-bounded performance (${result.orbit.performance.issues.join(", ")}).`);
  if (result.orbit && result.orbit.performance.valid === null) warnings.push(`Orbit turn limits not evaluated: ${result.orbit.performance.reason}.`);

  return {
    model: { ...WHEEL_BOX_GEOMETRY_MODEL_V0_7 },
    frame: WHEEL_BOX_GEOMETRY_MODEL_V0_7.frame,
    direction: result.direction,
    stations,
    paths,
    values: {
      wheelRadiusNm: radiusNm,
      minWheelRadiusNm: wheel.minWheelRadiusNm,
      geometryMinWheelRadiusNm: wheel.geometryMinWheelRadiusNm,
      abeamExtensionDistanceNm: extensionNm,
      abeamExtensionTimeSec: pattern.abeamExtensionTimeSec,
      baseLegNm: pattern.baseLegSignedNm,
      baseLegTimeSec: pattern.baseLegTimeSec,
      baseDistanceNm: pattern.baseDistanceNm,
      rollInRangeNm: result.bombDelivery.public.rollInRangeNm,
      patternSpeedKcas: pattern.patternSpeedKcas,
      // Closure residuals (0 when consistent): the Base Turn ends on the Base Leg line into OA1, heading along it.
      baseLegClosureNm: Math.abs(baseTurnEnd.alongNm - oa1.alongNm),
      baseLegLengthResidualNm: baseTurnEnd.sideNm - oa1.sideNm - pattern.baseLegSignedNm,
    },
    validation: { valid: errors.length === 0, errors, warnings },
  };
}
