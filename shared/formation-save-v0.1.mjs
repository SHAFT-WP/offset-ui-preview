// Saved Formation bearings across the 2026-11-02 angle change (bombing app shared FE; Flight Bombing Tactics SPEC
// "Formation angle — 2026-11-02"). Records saved before it hold tail bearings (0 behind, 90 abeam, 180 ahead); the
// pages read them once, by their format version, as abeam bearings (0 abeam, 90 behind, negative ahead): the same
// place is 90 - old. Never guessed from the number. Blank or unreadable text is kept as it is (the BE reports it).
// No calculation of its own: the conversion is the Flight Formation module's.
import { FORMATION_ANGLE_CONVENTION, formationBearingFromTailDeg } from "../flight/flight-bombing-tactics/formation-v0.1.mjs";

export const FORMATION_SAVE_V0_1 = Object.freeze({ id: "bombing-formation-save-v0.1", version: "0.1.0" });
export { FORMATION_ANGLE_CONVENTION };

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// A follower draft's typed text (the Offset page keeps field text). Read as the pages read it (parseFloat).
export function tailBearingTextToAbeam(text) {
  if (typeof text !== "string" || text.trim() === "") return text;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? String(formationBearingFromTailDeg(value)) : text;
}

// A stored number (BOX / Wheel-BOX follower records). null and non-numbers stay.
export function tailBearingValueToAbeam(value) {
  return typeof value === "number" && Number.isFinite(value) ? formationBearingFromTailDeg(value) : value;
}

// BOX / Wheel-BOX saved aircraft { 1: lead, 2–4: { formation: { side, bearingDeg, distanceNm } } }: a converted copy.
export function convertFollowerFormationsFromTail(aircraft) {
  if (!isObject(aircraft)) return aircraft;
  const out = structuredClone(aircraft);
  for (const number of [2, 3, 4]) {
    const formation = out[number]?.formation;
    if (isObject(formation) && "bearingDeg" in formation) formation.bearingDeg = tailBearingValueToAbeam(formation.bearingDeg);
  }
  return out;
}

// Offset / POP-UP follower drafts { aircraft: { 2–4: { bearingDeg: text, solved?, … } } }: a converted copy. A Full
// value saved behind the bearing text would no longer match it, so it is dropped (bearings are typed, never solved).
export function convertOffsetDraftsFromTail(flight) {
  if (!isObject(flight) || !isObject(flight.aircraft)) return flight;
  const out = structuredClone(flight);
  for (const number of [2, 3, 4]) {
    const draft = out.aircraft[number];
    if (!isObject(draft) || !("bearingDeg" in draft)) continue;
    draft.bearingDeg = tailBearingTextToAbeam(draft.bearingDeg);
    if (isObject(draft.solved)) delete draft.solved.bearingDeg;
  }
  return out;
}
