// Wheel Attack route geometry v0.1 — the Wheel (V2) as stations and paths, built from the Wheel Attack v0.1
// composition (AG/bombing/wheel-attack/SPEC.md §20). The view only projects them.
//
// Frame (NM), the Wheel-BOX / BOX attack frame: alongNm along the Attack Heading from the Target (+ past it), sideNm
// toward the Wheel side (right of the Attack Heading for RIGHT, left for LEFT). The Wheel is the Target-centred circle;
// on it φ (rad) is measured from the attack axis ahead of the Target toward the Wheel side, so every aircraft flies the
// Wheel toward + φ (clockwise for RIGHT, counter-clockwise for LEFT, in true).
// The route: the Wheel → Roll-in Start (on the Wheel, tangent, the Target abeam on the Wheel side) → Roll-in (BDP v0.4
// samples) → Track Point → Tracking → Release.

export const WHEEL_ATTACK_GEOMETRY_MODEL_V0_1 = Object.freeze({
  id: "wheel-attack-geometry-v0.1",
  version: "0.1.0",
  status: "Work / Pure Geometry / Not Official",
  source: "wheel-attack-be-v0.1 result (BDP semantic state, Wheel, Flight slots)",
  frame: "ATTACK_ALONG_WHEEL_SIDE",
});

const CIRCLE_SAMPLES = 96;
const DEG = Math.PI / 180;
// The arc drawn as flown into the Roll-in Start: a quarter of the Wheel.
const FLOWN_ARC_RAD = Math.PI / 2;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

const at = (alongNm, sideNm) => ({ alongNm, sideNm });
const arc = (radiusNm, from, to, samples) => Array.from({ length: samples + 1 }, (_, index) => {
  const phi = from + ((to - from) * index) / samples;
  return at(radiusNm * Math.cos(phi), radiusNm * Math.sin(phi));
});

// The Wheel position φ (rad) → its place, the true heading flown there (tangent, toward + φ) and the Target → place
// true bearing (the radial).
export function wheelPlace(radiusNm, phi, attackHeadingDeg, sign) {
  const norm = (deg) => ((deg % 360) + 360) % 360;
  return {
    ...at(radiusNm * Math.cos(phi), radiusNm * Math.sin(phi)),
    radialDeg: norm(attackHeadingDeg + sign * (phi / DEG)),
    headingDeg: norm(attackHeadingDeg + sign * (phi / DEG + 90)),
  };
}

export function buildWheelAttackGeometryV0_1(result) {
  const semantic = result?.bombDelivery?.visualization?.semanticState;
  if (!semantic || !result?.wheel || !result?.flight) throw new TypeError("result must be a Wheel Attack v0.1 result with its BDP, Wheel and Flight");
  const psi = finite("angleOffDeg", result.angleOffDeg) * DEG;
  const target = semantic.stations.target;
  // BDP semantic frame (forward = the Roll-in Start heading, turn side = the Roll-in turn's side) → attack frame: the
  // Attack Heading is (cos ψ, sin ψ) there and the Wheel side (cos(ψ + 90°), sin(ψ + 90°)), for RIGHT and LEFT alike.
  const toAttack = (point, name) => {
    const f = finite(`${name}.forwardNm`, point.forwardNm) - target.forwardNm;
    const s = finite(`${name}.turnSideNm`, point.turnSideNm) - target.turnSideNm;
    return at(f * Math.cos(psi) + s * Math.sin(psi), -f * Math.sin(psi) + s * Math.cos(psi));
  };
  const radiusNm = finite("wheel.radiusNm", result.wheel.radiusNm);
  const rollInStart = toAttack(semantic.stations.rollInStart, "rollInStart");
  const trackPoint = toAttack(semantic.stations.trackPoint, "trackPoint");
  const release = toAttack(semantic.stations.release, "release");
  const startPhi = Math.atan2(rollInStart.sideNm, rollInStart.alongNm);

  const stations = { target: at(0, 0), rollInStart, oa1: rollInStart, trackPoint, release };
  const paths = {
    wheel: arc(radiusNm, 0, 2 * Math.PI, CIRCLE_SAMPLES),
    // Flown into the Roll-in Start (+ φ).
    wheelArc: arc(radiusNm, startPhi - FLOWN_ARC_RAD, startPhi, CIRCLE_SAMPLES / 4),
    rollIn: semantic.paths.rollIn.map((point) => toAttack(point, "rollIn")),
    tracking: [trackPoint, release],
    // The Target → Roll-in Start radius (the tangent: square to the heading flown there).
    radius: [at(0, 0), rollInStart],
  };

  // Validation: the tangent closure (the Target abeam of the Roll-in Start), the Wheel turn's source limits (as
  // Wheel-BOX: outside them an error, NOT_EVALUATED a warning) and the Flight against the Aircraft Count.
  const errors = [];
  const warnings = [];
  const closureNm = Math.abs(result.tangent.closureNm);
  if (!(closureNm <= result.model.tangentToleranceNm)) errors.push(`Tangent closure ${closureNm.toFixed(6)} NM is outside its tolerance.`);
  const performance = result.wheel.performance;
  if (performance.valid === false) errors.push(`Wheel turn is outside the source-bounded performance (${performance.issues.join(", ")}).`);
  if (performance.valid === null) warnings.push(`Wheel turn limits not evaluated: ${performance.reason}.`);

  return {
    model: { ...WHEEL_ATTACK_GEOMETRY_MODEL_V0_1 },
    frame: WHEEL_ATTACK_GEOMETRY_MODEL_V0_1.frame,
    direction: result.direction,
    stations,
    paths,
    values: {
      wheelRadiusNm: radiusNm,
      rollInStartPhiRad: startPhi,
      rollInRangeNm: result.bombDelivery.public.rollInRangeNm,
      // The tangent residuals: the Roll-in Start's range from the Target against the Wheel Radius, and the Target's
      // bearing from it against abeam (90° off the heading flown).
      radiusResidualNm: Math.hypot(rollInStart.alongNm, rollInStart.sideNm) - radiusNm,
      abeamResidualNm: result.tangent.closureNm,
    },
    validation: { valid: errors.length === 0, errors, warnings },
  };
}
