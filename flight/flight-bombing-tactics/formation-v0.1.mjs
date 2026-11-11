// Formation position convention (Flight Bombing Tactics SPEC "Formation angle — 2026-11-02").
//
// A wingman's place is given relative to its reference aircraft (#2 and #3 on #1, #4 on #3): a Side (LEFT / RIGHT
// of the reference aircraft's heading, not of the screen), a bearing and a distance. Since 2026-11-02 (owner) the
// bearing is measured from the reference aircraft's ABEAM line, aft positive: 0 = abeam, +90 = directly behind, 0…90
// only (0.3.0: no wingman ahead of abeam). Offset, BOX and Wheel-BOX place their followers with this one rule.
//
// Before 2026-11-02 the bearing was measured from the reference aircraft's TAIL (0 = behind, 90 = abeam, 180 = ahead).
// The same place in the new convention is 90 - old; a stored record is converted once, by its format version, and
// never guessed from the number.
//
// 0.2.0 (2026-11-02, owner): the Flight's formation name (SPEC "Formation names — owner 2026-11-02"): each link's
// angle code (#2 → #1, #3 → #1, #4 → #3), the named 2 / 3 / 4-ship formations, NA for every undefined case, the attack
// type (ech / pin / mix) from each aircraft's attack side, and #1 Impact − #2 Release. Metadata only: no position,
// equation or result of any pattern changes.
// 0.3.0 (2026-11-02, owner, later the same day): no wingman is ahead of #1's abeam line ("1번기 보다 앞으로 나가는
// 편대기는 없으므로 음수 값은 기각"): the bearing is 0…90°, a negative one is refused (a stored tail record that was
// ahead converts to a negative bearing and fails its aircraft with the reason; it is never moved). CT starts at 70°
// ("70도 이상은 CT(유사 trail)"), FW is 60…70°; a split 2-ship is a Pincer ("2기일 때 서로 찢어지면 핀서"). The
// formation templates (Flight-size lists, positions) and the longitudinal / lateral range of a place (#3's fields);
// formationName also gives every aircraft's place in #1's frame (places) for the Formation top view.
// 0.4.0 (2026-11-12, owner "NA 대신 가장 가까운 이름"): a formation the rules do not name takes the nearest named one,
// marked approximate ("4S_BOX~_L", approximate: true): the named formation of that Flight size whose template link
// bearings (#2 → #1, #3 → #1, #4 → #3) are closest in total to the places' (the 3-ship has only ARW). NA stays only
// where a place cannot be read (no side, a bearing outside 0…90°, no range).
//
// Pure: no DOM, storage or FE import.

export const FLIGHT_FORMATION_V0_1 = Object.freeze({
  id: "flight-formation-v0.1",
  version: "0.4.0",
  status: "work",
});

// Recorded in saved records and HTML snapshots that carry formation bearings in this convention.
export const FORMATION_ANGLE_CONVENTION = "abeam-zero-aft-positive-v1";
export const FORMATION_BEARING_MIN_DEG = 0;
export const FORMATION_BEARING_MAX_DEG = 90;

const norm = (deg) => ((deg % 360) + 360) % 360;

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function assertFormationBearing(bearingDeg, name = "bearingDeg") {
  finite(name, bearingDeg);
  if (!(bearingDeg >= FORMATION_BEARING_MIN_DEG && bearingDeg <= FORMATION_BEARING_MAX_DEG)) {
    throw new RangeError(`${name} must be between ${FORMATION_BEARING_MIN_DEG} and ${FORMATION_BEARING_MAX_DEG} deg (0 abeam, 90 behind; no place ahead of abeam)`);
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
// negative (refused by the BE since 0.3.0, with the reason); nothing is clamped or mirrored. Finite numbers only; the
// caller keeps blanks and invalid text as they are.
export function formationBearingFromTailDeg(tailBearingDeg) {
  finite("tailBearingDeg", tailBearingDeg);
  // toPrecision(12) drops binary noise from 90 - x (90 - 33.3 = 56.7, not 56.699999...); exact for typed values.
  return Number((90 - tailBearingDeg).toPrecision(12));
}

// ---- Formation names (owner 2026-11-02) ------------------------------------------------------------------------------

// One link's angle code, from the full-precision abeam bearing (never the rounded display). Ahead of abeam (< 0°) has
// no code (NA). Boundaries: LAB 0–20, CW (20, 30), WED 30–60, FW (60, 70), CT [70, 80), TRA 80–90 (owner 0.3.0).
export const FORMATION_LINK_CODES = Object.freeze(["LAB", "CW", "WED", "FW", "CT", "TRA"]);
export function formationLinkCode(bearingDeg) {
  if (typeof bearingDeg !== "number" || !Number.isFinite(bearingDeg) || bearingDeg < 0 || bearingDeg > 90) return null;
  if (bearingDeg <= 20) return "LAB";
  if (bearingDeg < 30) return "CW";
  if (bearingDeg <= 60) return "WED";
  if (bearingDeg < 70) return "FW";
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
  if (typeof bearingDeg !== "number" || !Number.isFinite(bearingDeg) || bearingDeg < FORMATION_BEARING_MIN_DEG || bearingDeg > FORMATION_BEARING_MAX_DEG) {
    return { number, reference: REFERENCE[number], side, code: null, reason: `#${number} Formation bearing is not a bearing from 0 to 90° (no place ahead of abeam)` };
  }
  if (typeof distanceNm !== "number" || !Number.isFinite(distanceNm) || !(distanceNm > 0)) {
    return { number, reference: REFERENCE[number], side, bearingDeg, code: null, reason: `#${number} Formation range must be more than 0 NM (no direction at 0)` };
  }
  return { number, reference: REFERENCE[number], side, bearingDeg, distanceNm, ...formationComponentsNm({ bearingDeg, distanceNm }), code: formationLinkCode(bearingDeg), reason: null };
}

// formation: { 2: { side, bearingDeg, distanceNm }, 3: …, 4: … } (the followers' Formation records, abeam bearings).
// Returns { flightSize, name (code, the nearest code when approximate, or "NA" for an unreadable place; null for one
// aircraft), approximate (true when the places match no named formation), side ("L" / "R" of #2; null for one
// aircraft), text ("4S_BOX_L", "4S_BOX~_L" approximate, "3S_NA_R", null for one aircraft), links, reason (why NA or
// approximate, or null) }.
// Every aircraft's place in #1's frame (every aircraft flies #1's heading): rightNm to #1's right, behindNm behind #1.
// A follower whose link (or reference aircraft) cannot be read has none (null).
function flightPlaces(flightSize, links) {
  const places = { 1: { rightNm: 0, behindNm: 0 } };
  for (let number = 2; number <= flightSize; number += 1) {
    const link = links[number];
    const reference = places[REFERENCE[number]];
    places[number] = link.code === null || !reference ? null : {
      rightNm: reference.rightNm + (link.side === "RIGHT" ? 1 : -1) * link.lateralNm,
      behindNm: reference.behindNm + link.longitudinalNm,
    };
  }
  return places;
}

export function formationName({ flightSize, formation = {} }) {
  if (!Number.isInteger(flightSize) || flightSize < 1 || flightSize > 4) throw new RangeError("flightSize must be an integer from 1 to 4");
  if (flightSize === 1) return { flightSize, name: null, side: null, text: null, links: {}, places: flightPlaces(1, {}), reason: "One aircraft: no formation name (enter the file name)" };
  const links = {};
  for (let number = 2; number <= flightSize; number += 1) links[number] = readLink(number, formation[number]);
  const places = flightPlaces(flightSize, links);
  const sideLetter = links[2].side === "RIGHT" ? "R" : links[2].side === "LEFT" ? "L" : null;
  const finish = (name, reason = null, approximate = false) => {
    const shown = approximate ? `${name}~` : name;
    return { flightSize, name, approximate, side: sideLetter, text: sideLetter ? `${flightSize}S_${shown}_${sideLetter}` : `${flightSize}S_${shown}`, links, places, reason };
  };
  // 0.4.0: not a named formation → the nearest named one (approximate), with why.
  const nearest = (reason) => {
    const name = nearestFormationName(flightSize, links);
    return name ? finish(name, `${reason}; nearest ${name}`, true) : finish("NA", reason);
  };
  const unreadable = Object.values(links).find((link) => link.code === null);
  if (unreadable) return finish("NA", unreadable.reason);
  const code = (number) => links[number].code;
  if (flightSize === 2) return finish(code(2));
  const at = { 1: { x: 0, aft: 0 }, 2: relative(links[2]), 3: relative(links[3]) };
  if (flightSize === 3) {
    // ARW (Arrow Head): #1 ahead; #2 and #3 behind #1 on opposite sides, line abreast of each other (LAB, 0–20°).
    const between = Math.atan2(Math.abs(at[3].aft - at[2].aft), Math.abs(at[3].x - at[2].x)) / DEG;
    const arrow = at[2].aft > 0 && at[3].aft > 0 && Math.sign(at[2].x) * Math.sign(at[3].x) < 0 && formationLinkCode(between) === "LAB";
    return arrow ? finish("ARW") : nearest("Not a defined 3-ship formation (only ARW is defined)");
  }
  for (const [name, inElement, elementLink] of FOUR_SHIP_RULES) {
    if (inElement.includes(code(2)) && inElement.includes(code(4)) && elementLink.includes(code(3))) return finish(name);
  }
  // OBX (Offset Box): Line Abreast elements, #3 behind #1 and anywhere between #1 and #2 across (owner sketch
  // 2026-11-02: "OBox는 1~2번 사이에 3만 있어도 됨"); #3 exactly behind #1 is BOX (above).
  const between12 = at[2].x !== 0 && Math.sign(at[3].x) === Math.sign(at[2].x) && Math.abs(at[3].x) <= Math.abs(at[2].x);
  if (code(2) === "LAB" && code(4) === "LAB" && at[3].aft > 0 && between12) return finish("OBX");
  return nearest(`Not a defined 4-ship formation (#2 ${code(2)}, #3 ${code(3)}, #4 ${code(4)})`);
}
// The named formation (a template of this Flight size) whose link bearings are closest in total to the read links:
// Σ |bearing − template bearing| over #2 → #1, #3 → #1, #4 → #3 (0…90° each); the first in the template list wins a
// tie. The names are defined by those bearings (link codes), so the nearest is measured on them. Null when none.
function nearestFormationName(flightSize, links) {
  const templates = FORMATION_TEMPLATES[flightSize] ?? [];
  let best = null;
  for (const template of templates) {
    const places = formationTemplatePositions({ flightSize, name: template.name, side: links[2].side });
    let total = 0;
    for (let number = 2; number <= flightSize; number += 1) total += Math.abs(links[number].bearingDeg - places[number].bearingDeg);
    if (!best || total < best.total - 1e-9) best = { name: template.name, total };
  }
  return best?.name ?? null;
}

// Attack type (owner 2026-11-02) from each aircraft's attack side (LEFT / RIGHT of its Run-In): every aircraft from
// one side = ech (Echelon); each element from one side and the two elements from opposite sides = pin (Pincer); a
// 2-ship whose #1 and #2 split = pin (0.3.0); any other = mix. One aircraft, or any aircraft without a side: null.
export function flightAttackType({ flightSize, attackSides = {} }) {
  if (flightSize < 2) return { value: null, reason: "One aircraft: no attack type" };
  const sides = [];
  for (let number = 1; number <= flightSize; number += 1) {
    const side = attackSides[number];
    if (side !== "LEFT" && side !== "RIGHT") return { value: null, reason: `#${number} has no attack side` };
    sides[number] = side;
  }
  if (sides.slice(1).every((side) => side === sides[1])) return { value: "ech", reason: null };
  if (flightSize === 2) return { value: "pin", reason: null };
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

// ---- Longitudinal / lateral range and the formation templates (owner 2026-11-02, 0.3.0) --------------------------------

// A place as its longitudinal range (NM behind the reference aircraft, along its heading) and lateral range (NM to the
// Side, across): the same place as bearing / distance (linked parameters, owner sketch: "#3는 각도 Range 외에
// Longitudinal Range, Lateral Range 추가. 서로 연동되는 Parameter"). Both are 0 or more (no place ahead, no minus).
export function formationComponentsNm({ bearingDeg, distanceNm }) {
  assertFormationBearing(bearingDeg);
  if (typeof distanceNm !== "number" || !Number.isFinite(distanceNm) || distanceNm < 0) throw new RangeError("distanceNm must be 0 NM or more");
  return { longitudinalNm: distanceNm * Math.sin(bearingDeg * DEG), lateralNm: distanceNm * Math.cos(bearingDeg * DEG) };
}

export function formationFromComponentsNm({ longitudinalNm, lateralNm }) {
  for (const [name, value] of [["longitudinalNm", longitudinalNm], ["lateralNm", lateralNm]]) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
    if (value < 0) throw new RangeError(`${name} must be 0 NM or more (no place ahead, no minus)`);
  }
  const distanceNm = Math.hypot(longitudinalNm, lateralNm);
  return { bearingDeg: distanceNm === 0 ? 0 : Math.atan2(longitudinalNm, lateralNm) / DEG, distanceNm };
}

// Templates (owner 2026-11-02): what a Form choice fills in for #2–#4. A template only fills the places; the saved
// name is always the one the places give (formationName), so an edited place may name it otherwise or NA.
// Link places: LAB 0° 1.0 NM ("lab은 0도 (직각)으로 픽스", "Lab은 1.0nm"); Wedge 45° and Fighting Wing 65° at 0.5 NM
// ("FW, wedge는 기본 0.5nm"); Trail and every other longitudinal spacing 1.5 NM ("나머지는 롱지튜디얼은 1.5nm").
// Arrow Head #2 / #3 and Offset Box #3: 1.5 NM behind #1, 0.5 NM across (#2 and #3 of the Arrow Head 1.0 NM apart, LAB).
const LINK = Object.freeze({
  LAB: Object.freeze({ bearingDeg: 0, distanceNm: 1 }),
  WED: Object.freeze({ bearingDeg: 45, distanceNm: 0.5 }),
  FW: Object.freeze({ bearingDeg: 65, distanceNm: 0.5 }),
  TRA: Object.freeze({ bearingDeg: 90, distanceNm: 1.5 }),
});
const BEHIND_ACROSS = formationFromComponentsNm({ longitudinalNm: 1.5, lateralNm: 0.5 });
const OTHER = (side) => (side === "LEFT" ? "RIGHT" : "LEFT");
const place = (side, link) => ({ side, bearingDeg: link.bearingDeg, distanceNm: link.distanceNm });

export const FORMATION_TEMPLATES = Object.freeze({
  2: Object.freeze([
    Object.freeze({ name: "LAB", label: "2 Ship LAB" }),
    Object.freeze({ name: "WED", label: "2 Ship Wedge" }),
    Object.freeze({ name: "FW", label: "2 Ship Fighting Wing" }),
    Object.freeze({ name: "TRA", label: "2 Ship Trail" }),
  ]),
  3: Object.freeze([Object.freeze({ name: "ARW", label: "3 Ship Arrow Head" })]),
  4: Object.freeze([
    Object.freeze({ name: "BOX", label: "4 Ship Box" }),
    Object.freeze({ name: "OBX", label: "4 Ship Offset Box" }),
    Object.freeze({ name: "WED", label: "4 Ship Wedge" }),
    Object.freeze({ name: "FLD", label: "4 Ship Fluid Four" }),
    Object.freeze({ name: "LAB", label: "4 Ship LAB" }),
    Object.freeze({ name: "TRA", label: "4 Ship Trail" }),
  ]),
});

// The places a template gives. side: #2's side (L / R of the name); the other aircraft follow the drawings:
// 4-ship Wedge, LAB and Fluid Four put element 2 (#3, #4) on the other side, Box and Offset Box on #2's side.
export function formationTemplatePositions({ flightSize, name, side }) {
  if (side !== "LEFT" && side !== "RIGHT") throw new TypeError('side must be "LEFT" or "RIGHT"');
  const known = FORMATION_TEMPLATES[flightSize]?.some((template) => template.name === name);
  if (!known) throw new RangeError(`${name} is not a ${flightSize}-ship formation template`);
  const other = OTHER(side);
  if (flightSize === 2) return { 2: place(side, LINK[name]) };
  if (flightSize === 3) return { 2: place(side, BEHIND_ACROSS), 3: place(other, BEHIND_ACROSS) };
  const trail = (distanceNm) => ({ bearingDeg: 90, distanceNm });
  switch (name) {
    case "BOX": return { 2: place(side, LINK.LAB), 3: place(side, trail(1.5)), 4: place(side, LINK.LAB) };
    case "OBX": return { 2: place(side, LINK.LAB), 3: place(side, BEHIND_ACROSS), 4: place(side, LINK.LAB) };
    case "WED": return { 2: place(side, LINK.WED), 3: place(other, trail(1.5)), 4: place(other, LINK.WED) };
    case "FLD": return { 2: place(side, LINK.WED), 3: place(other, LINK.LAB), 4: place(other, LINK.WED) };
    case "LAB": return { 2: place(side, LINK.LAB), 3: place(other, LINK.LAB), 4: place(other, LINK.LAB) };
    case "TRA": return { 2: place(side, LINK.TRA), 3: place(side, trail(3)), 4: place(side, LINK.TRA) };
    default: throw new RangeError(`${name} is not a 4-ship formation template`);
  }
}
