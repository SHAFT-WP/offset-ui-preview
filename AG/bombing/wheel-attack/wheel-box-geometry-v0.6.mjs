// Wheel-BOX route geometry v0.6 — the whole Wheel-BOX attack route as stations and paths, built from the Wheel-BOX
// v0.8 composition (AG/bombing/wheel-attack/SPEC.md "Wheel-BOX v0.8"). The view only projects them.
//
// Frame (NM), BOX's: alongNm along the Attack Heading from the Target (+ past it), sideNm toward the pattern side
// (right of the Attack Heading for RIGHT, left for LEFT). The route:
//   Wheel (Target-centred circle, flown toward Abeam) → Abeam → Abeam Extension (Downwind heading) → Base Turn (Common
//   onset level turn, its samples) → Base Leg → OA1 / Roll-in → Tracking → Release.
// iBT is retired (as BOX): the end of the Abeam Extension is `baseTurnStart`.

export const WHEEL_BOX_GEOMETRY_MODEL_V0_6 = Object.freeze({
  id: "wheel-box-geometry-v0.6",
  version: "0.6.0",
  status: "Work / Pure Geometry / Not Official",
  source: "wheel-box-be-v0.8 result (wheel + pattern + turns + orbit)",
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
// A Wheel radius is stated rounded up to the Wheel Radius field's step (0.01 NM): a required minimum entered as stated
// satisfies it (BOX's rule on the Wheel Radius field), and the MIN radius typed back as shown is never below it. The
// views and the page show radii with it.
export const formatWheelRadiusNm = (nm) => (Math.ceil(nm * 100 - 1e-9) / 100).toFixed(2);
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

export function buildWheelBoxGeometryV0_6(result) {
  const semantic = result?.bombDelivery?.visualization?.semanticState;
  const base = result?.turns?.base;
  if (!semantic || !result?.wheel || !result?.pattern || !base) {
    throw new TypeError("result must be a Wheel-BOX v0.8 result with its BDP, Wheel, pattern and Base Turn");
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

  // Validation (BOX's rules and Wheel's): a radius below the minimum, a negative Abeam Extension or Base Leg are
  // reported with what fixes them; a negative straight segment is never flown backwards.
  const errors = [];
  if (wheel.radiusMode === "MANUAL" && radiusNm + EPS_NM < wheel.minWheelRadiusNm) {
    errors.push(`Wheel Radius is below Min Wheel Radius. Required >= ${formatWheelRadiusNm(wheel.minWheelRadiusNm)} NM.`);
  }
  if (extensionNm < -EPS_NM) errors.push("Abeam Extension Distance must be 0 or greater (the Base Turn does not fit inside Base Distance at this Downwind Angle).");
  if (pattern.baseLegSignedNm < -EPS_NM) {
    errors.push(`Base Leg is negative; the Base Turn cannot connect to the Roll-in. Wheel Radius >= ${formatWheelRadiusNm(wheel.minimumUsableWheelRadiusNm)} NM gives a forward Base Leg.`);
  }
  if (!wheel.performance.valid) errors.push(`Wheel turn is outside the source-bounded performance (${wheel.performance.issues.join(", ")}).`);
  const warnings = [];
  if (result.orbit && !result.orbit.performance.valid) warnings.push(`Orbit turn is outside the source-bounded performance (${result.orbit.performance.issues.join(", ")}).`);

  return {
    model: { ...WHEEL_BOX_GEOMETRY_MODEL_V0_6 },
    frame: WHEEL_BOX_GEOMETRY_MODEL_V0_6.frame,
    direction: result.direction,
    stations,
    paths,
    values: {
      wheelRadiusNm: radiusNm,
      minWheelRadiusNm: wheel.minWheelRadiusNm,
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
