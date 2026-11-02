// Formation position convention (Flight Bombing Tactics SPEC "Formation angle — 2026-11-02").
//
// A wingman's place is given relative to its reference aircraft (#2 and #3 on #1, #4 on #3): a Side (LEFT / RIGHT
// of the reference aircraft's heading, not of the screen), a bearing and a distance. Since 2026-11-02 (owner) the
// bearing is measured from the reference aircraft's ABEAM line, aft positive: 0 = abeam, +90 = directly behind,
// negative = ahead of abeam (-90 = directly ahead). Offset, BOX and Wheel-BOX place their followers with this one rule.
//
// Before 2026-11-02 the bearing was measured from the reference aircraft's TAIL (0 = behind, 90 = abeam, 180 = ahead).
// The same place in the new convention is 90 - old; a stored record is converted once, by its format version, and
// never guessed from the number.
//
// Pure: no DOM, storage or FE import.

export const FLIGHT_FORMATION_V0_1 = Object.freeze({
  id: "flight-formation-v0.1",
  version: "0.1.0",
  status: "work",
});

// Recorded in saved records and HTML snapshots that carry formation bearings in this convention.
export const FORMATION_ANGLE_CONVENTION = "abeam-zero-aft-positive-v1";
export const FORMATION_BEARING_MIN_DEG = -90;
export const FORMATION_BEARING_MAX_DEG = 90;

const norm = (deg) => ((deg % 360) + 360) % 360;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function assertFormationBearing(bearingDeg, name = "bearingDeg") {
  finite(name, bearingDeg);
  if (!(bearingDeg >= FORMATION_BEARING_MIN_DEG && bearingDeg <= FORMATION_BEARING_MAX_DEG)) {
    throw new RangeError(`${name} must be between ${FORMATION_BEARING_MIN_DEG} and ${FORMATION_BEARING_MAX_DEG} deg (0 abeam, +90 behind)`);
  }
  return bearingDeg;
}

// True bearing from the reference aircraft to the wingman. RIGHT: heading + 90 + bearing; LEFT: heading - 90 - bearing.
// Identical to the earlier tail rule heading + 180 ± tailBearing with tailBearing = 90 - bearing, for every place it allowed.
export function formationTrueBearingDeg({ referenceHeadingDeg, bearingDeg, side }) {
  finite("referenceHeadingDeg", referenceHeadingDeg);
  assertFormationBearing(bearingDeg);
  if (side !== "LEFT" && side !== "RIGHT") throw new TypeError('side must be "LEFT" or "RIGHT"');
  return norm(side === "RIGHT" ? referenceHeadingDeg + 90 + bearingDeg : referenceHeadingDeg - 90 - bearingDeg);
}

// One stored tail-convention bearing (0 behind, 90 abeam, 180 ahead) in the abeam convention. Ahead places become
// negative; nothing is clamped or mirrored. Finite numbers only; the caller keeps blanks and invalid text as they are.
export function formationBearingFromTailDeg(tailBearingDeg) {
  finite("tailBearingDeg", tailBearingDeg);
  // toPrecision(12) drops binary noise from 90 - x (90 - 33.3 = 56.7, not 56.699999...); exact for typed values.
  return Number((90 - tailBearingDeg).toPrecision(12));
}
