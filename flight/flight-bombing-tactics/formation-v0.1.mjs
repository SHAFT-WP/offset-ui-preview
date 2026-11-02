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
// 0.2.0 (2026-11-02, owner): the Flight's formation name (SPEC "Formation names — owner 2026-11-02"): each link's
// angle code (#2 → #1, #3 → #1, #4 → #3), the named 2 / 3 / 4-ship formations, NA for every undefined case, the attack
// type (ech / pin / mix) from each aircraft's attack side, and #1 Impact − #2 Release. Metadata only: no position,
// equation or result of any pattern changes.
//
// Pure: no DOM, storage or FE import.

export const FLIGHT_FORMATION_V0_1 = Object.freeze({
  id: "flight-formation-v0.1",
  version: "0.2.0",
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

// ---- Formation names (owner 2026-11-02) ------------------------------------------------------------------------------

// One link's angle code, from the full-precision abeam bearing (never the rounded display). Ahead of abeam (< 0°) has
// no code (NA). Boundaries: LAB 0–20, CW (20, 30), WED 30–60, FW (60, 70], CT (70, 80), TRA 80–90.
export const FORMATION_LINK_CODES = Object.freeze(["LAB", "CW", "WED", "FW", "CT", "TRA"]);
export function formationLinkCode(bearingDeg) {
  if (typeof bearingDeg !== "number" || !Number.isFinite(bearingDeg) || bearingDeg < 0 || bearingDeg > 90) return null;
  if (bearingDeg <= 20) return "LAB";
  if (bearingDeg < 30) return "CW";
  if (bearingDeg <= 60) return "WED";
  if (bearingDeg <= 70) return "FW";
  if (bearingDeg < 80) return "CT";
  return "TRA";
}

// Named formations (owner 2026-11-02). Two elements: #1–#2 (lead #1, the Flight lead) and #3–#4 (lead #3).
// In-element links #2 → #1 and #4 → #3; the element link #3 → #1.
export const FORMATION_NAMES = Object.freeze({
  2: Object.freeze(["LAB", "CW", "WED", "FW", "CT", "TRA"]),
  3: Object.freeze(["ARW"]),
  4: Object.freeze(["TRA", "BOX", "WED", "LAB", "FLD", "OBX"]),
});
const FOUR_SHIP_RULES = Object.freeze([
  // [name, in-element codes allowed for #2 → #1 and #4 → #3, element link code(s) #3 → #1]
  ["TRA", ["TRA"], ["TRA"]],
  ["BOX", ["LAB"], ["TRA"]],
  ["WED", ["WED"], ["TRA"]],
  ["LAB", ["LAB", "CW"], ["LAB"]], // 4 Ship LAB / Spread 4: wingmen 0–30° (owner drawing MCM0312)
  ["FLD", ["WED", "FW"], ["LAB"]], // Fluid Four: wingmen in Wedge or Fighting Wing (30–70°, drawing MCM0311)
]);

const REFERENCE = Object.freeze({ 2: 1, 3: 1, 4: 3 });
const DEG = Math.PI / 180;

// A follower's place in #1's frame: x to #1's right (NM), aft behind #1 (NM). Every aircraft flies one heading.
function relative({ side, bearingDeg, distanceNm }) {
  const sign = side === "RIGHT" ? 1 : -1;
  return { x: sign * distanceNm * Math.cos(bearingDeg * DEG), aft: distanceNm * Math.sin(bearingDeg * DEG) };
}

function readLink(number, record) {
  const side = record?.side;
  const bearingDeg = record?.bearingDeg;
  const distanceNm = record?.distanceNm;
  if (side !== "LEFT" && side !== "RIGHT") return { number, reference: REFERENCE[number], code: null, reason: `#${number} has no Formation side` };
  if (typeof bearingDeg !== "number" || !Number.isFinite(bearingDeg) || bearingDeg < -90 || bearingDeg > 90) {
    return { number, reference: REFERENCE[number], side, code: null, reason: `#${number} Formation bearing is not a bearing from -90 to 90°` };
  }
  if (typeof distanceNm !== "number" || !Number.isFinite(distanceNm) || !(distanceNm > 0)) {
    return { number, reference: REFERENCE[number], side, bearingDeg, code: null, reason: `#${number} Formation range must be more than 0 NM (no direction at 0)` };
  }
  const code = formationLinkCode(bearingDeg);
  return { number, reference: REFERENCE[number], side, bearingDeg, distanceNm, code, reason: code ? null : `#${number} is ahead of #${REFERENCE[number]}'s abeam line` };
}

// formation: { 2: { side, bearingDeg, distanceNm }, 3: …, 4: … } (the followers' Formation records, abeam bearings).
// Returns { flightSize, name (code or "NA"; null for one aircraft), side ("L" / "R" of #2; null for one aircraft), text
// ("4S_BOX_L", "3S_NA_R", null for one aircraft), links, reason (why NA, or null) }.
export function formationName({ flightSize, formation = {} }) {
  if (!Number.isInteger(flightSize) || flightSize < 1 || flightSize > 4) throw new RangeError("flightSize must be an integer from 1 to 4");
  if (flightSize === 1) return { flightSize, name: null, side: null, text: null, links: {}, reason: "One aircraft: no formation name (enter the file name)" };
  const links = {};
  for (let number = 2; number <= flightSize; number += 1) links[number] = readLink(number, formation[number]);
  const sideLetter = links[2].side === "RIGHT" ? "R" : links[2].side === "LEFT" ? "L" : null;
  const finish = (name, reason = null) => ({
    flightSize, name, side: sideLetter, text: sideLetter ? `${flightSize}S_${name}_${sideLetter}` : `${flightSize}S_${name}`, links, reason,
  });
  const unreadable = Object.values(links).find((link) => link.code === null);
  if (unreadable) return finish("NA", unreadable.reason);
  const code = (number) => links[number].code;
  if (flightSize === 2) return finish(code(2));
  const at = { 1: { x: 0, aft: 0 }, 2: relative(links[2]), 3: relative(links[3]) };
  if (flightSize === 3) {
    // ARW (Arrow Head): #1 ahead; #2 and #3 behind #1 on opposite sides, line abreast of each other (LAB, 0–20°).
    const between = Math.atan2(Math.abs(at[3].aft - at[2].aft), Math.abs(at[3].x - at[2].x)) / DEG;
    const arrow = at[2].aft > 0 && at[3].aft > 0 && Math.sign(at[2].x) * Math.sign(at[3].x) < 0 && formationLinkCode(between) === "LAB";
    return arrow ? finish("ARW") : finish("NA", "Not a defined 3-ship formation (only ARW is defined)");
  }
  for (const [name, inElement, elementLink] of FOUR_SHIP_RULES) {
    if (inElement.includes(code(2)) && inElement.includes(code(4)) && elementLink.includes(code(3))) return finish(name);
  }
  // OBX (Offset Box): Line Abreast elements, #3 behind #1 and anywhere between #1 and #2 across (owner sketch
  // 2026-11-02: "OBox는 1~2번 사이에 3만 있어도 됨"); #3 exactly behind #1 is BOX (above).
  const between12 = at[2].x !== 0 && Math.sign(at[3].x) === Math.sign(at[2].x) && Math.abs(at[3].x) <= Math.abs(at[2].x);
  if (code(2) === "LAB" && code(4) === "LAB" && at[3].aft > 0 && between12) return finish("OBX");
  return finish("NA", `Not a defined 4-ship formation (#2 ${code(2)}, #3 ${code(3)}, #4 ${code(4)})`);
}

// Attack type (owner 2026-11-02) from each aircraft's attack side (LEFT / RIGHT of its Run-In): every aircraft from
// one side = ech (Echelon); each element from one side and the two elements from opposite sides = pin (Pincer); any
// other = mix. One aircraft, or any aircraft without a side: null with the reason.
export function flightAttackType({ flightSize, attackSides = {} }) {
  if (flightSize < 2) return { value: null, reason: "One aircraft: no attack type" };
  const sides = [];
  for (let number = 1; number <= flightSize; number += 1) {
    const side = attackSides[number];
    if (side !== "LEFT" && side !== "RIGHT") return { value: null, reason: `#${number} has no attack side` };
    sides[number] = side;
  }
  if (sides.slice(1).every((side) => side === sides[1])) return { value: "ech", reason: null };
  const element1 = [1, 2].filter((n) => n <= flightSize).map((n) => sides[n]);
  const element2 = [3, 4].filter((n) => n <= flightSize).map((n) => sides[n]);
  const one = (list) => list.length > 0 && list.every((side) => side === list[0]);
  if (one(element1) && one(element2) && element1[0] !== element2[0]) return { value: "pin", reason: null };
  return { value: "mix", reason: null };
}

// #1 Impact − #2 Release (s, signed), from the Flight's drop-order timing of #2 (Flight composition dropOrderTiming).
export function leadImpactToWingmanReleaseSec(flightTiming) {
  const second = flightTiming?.[2];
  if (!second) return { value: null, reason: "One aircraft: no #2 Release" };
  if (!second.available || typeof second.predecessorImpactToOwnReleaseSec !== "number") return { value: null, reason: second.cause ?? "#2 timing is not available" };
  return { value: second.predecessorImpactToOwnReleaseSec, reason: null };
}

// The Flight's naming metadata for its file name and HTML snapshot: the formation name, the attack type and
// #1 Impact − #2 Release. Each part may be unavailable with its reason; nothing is made up as 0.
export function flightNameMetadata({ flightSize, formation, attackSides, flightTiming }) {
  return {
    model: `${FLIGHT_FORMATION_V0_1.id} ${FLIGHT_FORMATION_V0_1.version}`,
    angleConvention: FORMATION_ANGLE_CONVENTION,
    formation: formationName({ flightSize, formation }),
    attackSides: { ...attackSides },
    attackType: flightAttackType({ flightSize, attackSides }),
    leadImpactToWingmanReleaseSec: leadImpactToWingmanReleaseSec(flightTiming),
  };
}
