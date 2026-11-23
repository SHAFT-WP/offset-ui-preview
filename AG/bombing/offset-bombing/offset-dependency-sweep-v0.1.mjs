import { calculateOffsetFlightUnfittedFull } from "./offset-flight-v0.1.mjs?v=0.1.22";

// Offset dependency sweep (owner 2026-11-23: "오프셋에도 디자인 탭을 만들어주자"; the POP-UP Design graph of POP-UP SPEC
// §13.8z on the Offset page): how one result depends on one input, under the page's current conditions, VALID or not.
//   Baseline: #1 as the page answered it, with the Offset Angle frozen at the answer's (driver Offset Angle; VRP Range
//   kept as driver only when it is swept). The turn driver (Offset G / Bank / Radius) stays the page's.
//   Nothing is fitted (no cleared-field fit): each point is one direct Offset Flight solve of that one aircraft.
//   The page's mode stays: Roll-in Altitude fixed ("height"), Tracking Time fixed ("time"), or both fixed with the
//   Release Altitude solved ("release", Roll-in LOCK).
//   A point carries its status; INVALID / WARNING points are drawn, only marked.
// Pure calculation: no DOM, no storage.
export const OFFSET_DEPENDENCY_SWEEP_V0_1 = Object.freeze({ id: "offset-dependency-sweep-v0.1", version: "0.1.0" });

// Inputs that can be the X axis or the condition. `modes`: only in those solve modes. `slow`: re-solves the Offset Angle.
export const OFFSET_SWEEP_INPUTS = Object.freeze({
  offsetAngleDeg: { label: "Offset Angle", unit: "°", step: 0.5 },
  vrpRangeNm: { label: "VRP Range", unit: "NM", step: 0.1, slow: true },
  attackHeadingDeg: { label: "Attack Heading", unit: "°", step: 1 },
  offsetSpeedValue: { label: "Offset Speed", unit: "KCAS", step: 5 },
  offsetG: { label: "Offset G", unit: "G", step: 0.1 },
  initialSpeedValue: { label: "Initial Speed", unit: "KCAS", step: 5 },
  diveAngleDeg: { label: "Dive Angle", unit: "°", step: 0.5 },
  trackingTimeSec: { label: "Tracking Time", unit: "s", step: 0.1, modes: ["time", "release"] },
  rollInAltitudeMslFt: { label: "Roll-in Altitude", unit: "ft", step: 50, modes: ["height", "release"] },
  releaseAltitudeMslFt: { label: "Release Altitude", unit: "ft", step: 50, modes: ["height", "time"] },
  releaseSpeedKcas: { label: "Release Speed", unit: "KCAS", step: 5 },
  rollInG: { label: "Roll-in G", unit: "G", step: 0.1 },
});

export const sweepInputInMode = (key, mode) => {
  const def = OFFSET_SWEEP_INPUTS[key];
  return !!def && (!def.modes || def.modes.includes(mode));
};

// Results that can be the Y axis: label, unit, and the value from one aircraft result (null when absent).
const num = (v) => (Number.isFinite(v) ? v : null);
const pub = (ar) => ar.result?.profile?.public ?? {};
export const OFFSET_SWEEP_OUTPUTS = Object.freeze({
  approachRangeNm: { label: "Approach Range", unit: "NM", of: (ar) => num(ar.result?.resolved?.approachRangeNm) },
  approachSec: { label: "Approach Time", unit: "s", of: (ar) => num(ar.result?.timing?.approachSec) },
  actionRangeNm: { label: "Action Range", unit: "NM", of: (ar) => num(ar.result?.resolved?.actionRangeNm) },
  vrpRangeNm: { label: "VRP Range", unit: "NM", of: (ar) => num(ar.result?.resolved?.vrpRangeNm) },
  offsetRadiusNm: { label: "Offset Radius", unit: "NM", of: (ar) => num(ar.result?.resolved?.offsetRadiusNm) },
  offsetTurnSec: { label: "Offset Turn Time", unit: "s", of: (ar) => num(ar.result?.timing?.offsetTurnSec) },
  ipToReleaseSec: { label: "IP → Release Time", unit: "s", of: (ar) => num(ar.result?.timing?.offsetIpToReleaseSec) },
  angleOffDeg: { label: "Angle Off", unit: "°", of: (ar) => num(ar.result?.resolved?.angleOffDeg) },
  offsetAngleDeg: { label: "Offset Angle", unit: "°", of: (ar) => num(ar.result?.resolved?.offsetAngleDeg) },
  rollInRangeNm: { label: "Roll-in Range (OA1)", unit: "NM", of: (ar) => num(pub(ar).rollInRangeNm) },
  mapNm: { label: "MAP", unit: "NM", of: (ar) => num(pub(ar).groundRangeNm) },
  rollInAltitudeMslFt: { label: "Roll-in Altitude", unit: "ft", of: (ar) => num(pub(ar).resolvedInitialAltitudeMslFt) },
  trackingTimeSec: { label: "Tracking Time", unit: "s", of: (ar) => num(pub(ar).trackingTimeSec) },
  releaseAltitudeMslFt: { label: "Release Altitude", unit: "ft", of: (ar) => num(pub(ar).effectiveReleaseAltitudeMslFt) },
  minAltMslFt: { label: "MINALT", unit: "ft", of: (ar) => num(pub(ar).minAltMslFt) },
  leadAngleDeg: { label: "Roll-in Lead Angle", unit: "°", of: (ar) => num(pub(ar).leadAngleDeg) },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

// The solve mode of a record: "height" (Roll-in Altitude fixed), "time" (Tracking Time fixed), "release" (both, Roll-in LOCK).
export const sweepModeOf = (record) => {
  const mode = record?.state?.solveMode;
  if (mode === "release") return record?.locks?.rollInAltitudeMslFt === true ? "release" : "time";
  return mode === "time" ? "time" : "height";
};

// The baseline record of aircraft `number` from the page's last answer ({ input, output }): its own record with the
// Offset Angle frozen. `keepVrp`: the VRP Range is swept, so the Offset Angle stays solved from it.
export function sweepBaseline(answer, number = 1, { keepVrp = false } = {}) {
  const record = answer?.input?.aircraft?.[number];
  const ar = answer?.output?.aircraftResults?.[number];
  if (!record || !ar?.result?.resolved) throw new Error(`No result for #${number} to start the graph from`);
  const base = clone(record);
  base.values ||= {};
  base.state ||= {};
  const resolved = ar.result.resolved;
  if (keepVrp) {
    base.values.vrpRangeNm = resolved.vrpRangeNm ?? base.values.vrpRangeNm;
    base.state.driver = "vrpRangeNm";
    base.state.vrpRangeExplicit = true;
  } else if (Number.isFinite(resolved.offsetAngleDeg)) {
    base.values.offsetAngleDeg = resolved.offsetAngleDeg;
    base.state.driver = "offsetAngleDeg";
  }
  // The page's mode, with its current values.
  const p = pub(ar);
  const mode = sweepModeOf(base);
  if (mode !== "height" && Number.isFinite(p.trackingTimeSec)) {
    base.values.trackingTimeSec = p.trackingTimeSec;
    base.state.enteredTrackingTimeSec = p.trackingTimeSec;
  }
  if (mode !== "time" && Number.isFinite(p.resolvedInitialAltitudeMslFt)) setRollInAltitude(base, p.resolvedInitialAltitudeMslFt);
  if (mode !== "release" && Number.isFinite(p.effectiveReleaseAltitudeMslFt)) base.values.releaseAltitudeMslFt = p.effectiveReleaseAltitudeMslFt;
  return base;
}

// A Roll-in Altitude LINKed to the Initial Altitude moves both (as the page's edit does).
function setRollInAltitude(record, value) {
  record.values.rollInAltitudeMslFt = value;
  if (record.state.rollInAltitudeLinked) record.values.initialAltitudeMslFt = value;
}

// The baseline value of an input (the X axis default range is centred on it).
export function sweepInputValue(base, key) {
  if (key === "trackingTimeSec") return Number(base.state?.enteredTrackingTimeSec ?? base.values.trackingTimeSec);
  return Number(base.values?.[key]);
}

// The record with the given inputs set ({ key: value }).
export function withSweepInputs(base, assignments) {
  const record = clone(base);
  for (const [key, value] of Object.entries(assignments ?? {})) {
    if (!(key in OFFSET_SWEEP_INPUTS)) throw new Error(`Unknown sweep input ${key}`);
    if (key === "rollInAltitudeMslFt") { setRollInAltitude(record, value); continue; }
    record.values[key] = value;
    if (key === "trackingTimeSec") record.state.enteredTrackingTimeSec = value;
    if (key === "offsetAngleDeg") record.state.driver = "offsetAngleDeg";
    if (key === "vrpRangeNm") { record.state.driver = "vrpRangeNm"; record.state.vrpRangeExplicit = true; }
    if (key === "offsetG") record.state.turnDriver = "offsetG";
  }
  return record;
}

// One point: the Flight of the one aircraft with the inputs set. { status, messages, y: { outputKey: value|null } }.
export function sweepPoint(base, assignments, calculate = calculateOffsetFlightUnfittedFull) {
  const record = withSweepInputs(base, assignments);
  let ar;
  try {
    ar = calculate({ schemaVersion: 2, flightSize: 1, aircraft: { 1: record } })?.aircraftResults?.[1];
  } catch (error) {
    return { status: "FAILED", messages: [error.message], y: {} };
  }
  const y = {};
  for (const [key, output] of Object.entries(OFFSET_SWEEP_OUTPUTS)) y[key] = ar ? output.of(ar) : null;
  return { status: ar?.status ?? "FAILED", messages: [...(ar?.errors ?? []), ...(ar?.warnings ?? [])].map((m) => (typeof m === "string" ? m : m?.message ?? String(m))).slice(0, 3), y };
}

// Evenly spaced X values from `from` to `to` (inclusive), `count` of them (≥ 2).
export function sweepValues(from, to, count) {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

// The whole graph in one call (tests, scripts): curves[c] = { value (condition, or null), points: [{ x, ...point }] }.
export function sweepOffsetDependency(answer, { xKey, xValues, conditionKey = null, conditionValues = [null], number = 1 }, calculate) {
  const base = sweepBaseline(answer, number, { keepVrp: xKey === "vrpRangeNm" || conditionKey === "vrpRangeNm" });
  return (conditionKey ? conditionValues : [null]).map((value) => ({
    value,
    points: xValues.map((x) => ({ x, ...sweepPoint(base, { ...(conditionKey ? { [conditionKey]: value } : {}), [xKey]: x }, calculate) })),
  }));
}
