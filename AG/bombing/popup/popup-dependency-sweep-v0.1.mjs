import { calculatePopupFlightFull } from "./popup-flight-v0.1.mjs?v=0.1.19";

// POP-UP dependency sweep (owner 2026-11-18, Design tab graph: "고정방식 해보자", "지금껏 그림 그려서 해석했던 방식을
// 프로그램에서"): how one result depends on one input, under the page's current conditions, VALID or not.
//   Baseline: #1 as the page answered it, every automatic choice frozen at what it gave: the Offset Angle (driver
//   Offset Angle, unless VRP Range is swept) and the Popup angle (driver ANGLE, LOCKed). The Roll-in Speed stays the
//   MIL arrival of the climb flown (physics, not a fit; a LOCKed Roll-in Speed would solve the Pop-up Speed instead).
//   Nothing is fitted (no AUTO angle raise): each point is one direct Flight solve.
//   The page's mode stays: Tracking Time fixed (solveMode "time") or Roll-in Altitude fixed ("height").
//   A point carries its status; INVALID / WARNING points are drawn, only marked.
// Pure calculation: no DOM, no storage.
export const POPUP_DEPENDENCY_SWEEP_V0_1 = Object.freeze({ id: "popup-dependency-sweep-v0.1", version: "0.1.1" });

// Inputs that can be the X axis or the condition. `mode`: only in that solve mode. `slow`: re-solves the Offset Angle.
export const POPUP_SWEEP_INPUTS = Object.freeze({
  offsetAngleDeg: { label: "Offset Angle", unit: "°", step: 0.5 },
  vrpRangeNm: { label: "VRP Range", unit: "NM", step: 0.1, slow: true },
  offsetSpeedValue: { label: "Offset Speed", unit: "KCAS", step: 5 },
  offsetG: { label: "Offset G", unit: "G", step: 0.1 },
  popupAngleDeg: { label: "Popup Angle", unit: "°", step: 0.5 },
  popupG: { label: "Popup G", unit: "G", step: 0.1 },
  diveAngleDeg: { label: "Dive Angle", unit: "°", step: 0.5 },
  trackingTimeSec: { label: "Tracking Time", unit: "s", step: 0.1, mode: "time" },
  rollInAltitudeMslFt: { label: "Roll-in Altitude", unit: "ft", step: 50, mode: "height" },
  releaseAltitudeMslFt: { label: "Release Altitude", unit: "ft", step: 50 },
  rollInG: { label: "Roll-in G", unit: "G", step: 0.1 },
});

// Results that can be the Y axis: label, unit, and the value from one aircraft result (null when absent).
const num = (v) => (Number.isFinite(v) ? v : null);
export const POPUP_SWEEP_OUTPUTS = Object.freeze({
  approachRangeNm: { label: "Approach Range", unit: "NM", of: (ar) => num(ar.result?.resolved?.approachRangeNm) },
  popToRollInNm: { label: "Pop to Roll-in Distance", unit: "NM", of: (ar) => num(ar.popup?.groundDistanceNm) },
  offsetPopupRangeNm: { label: "Offset-Popup Range", unit: "NM", of: (ar) => num(ar.popup?.holdDownNm) },
  // Signed: a negative Offset-Popup Range is flown as a negative time at the Offset speed (the Flight's own is ≥ 0).
  offsetPopupTimeSec: { label: "Offset-Popup Time", unit: "s", of: (ar) => {
    const nm = ar.popup?.holdDownNm;
    const tas = ar.result?.resolved?.offsetTasKt;
    if (Number.isFinite(nm) && nm < 0 && tas > 0) return (nm / tas) * 3600;
    return num(ar.popup?.holdDownSec);
  } },
  exposureTimeSec: { label: "Exposure (Pop → Apex)", unit: "s", of: (ar) => num(ar.popup?.exposureTimeSec) },
  apexKcas: { label: "Apex Speed", unit: "KCAS", of: (ar) => num(ar.popup?.apexKcas) },
  popupRangeNm: { label: "Pop-up Range", unit: "NM", of: (ar) => num(ar.popup?.popToTargetNm) },
  mapNm: { label: "MAP", unit: "NM", of: (ar) => num(ar.result?.profile?.public?.groundRangeNm) },
  rollInAltitudeMslFt: { label: "Roll-in Altitude", unit: "ft", of: (ar) => num(ar.result?.profile?.public?.resolvedInitialAltitudeMslFt) },
  trackingTimeSec: { label: "Tracking Time", unit: "s", of: (ar) => num(ar.result?.profile?.public?.trackingTimeSec) },
  angleOffDeg: { label: "Angle Off", unit: "°", of: (ar) => num(ar.result?.resolved?.angleOffDeg) },
  offsetAngleDeg: { label: "Offset Angle", unit: "°", of: (ar) => num(ar.result?.resolved?.offsetAngleDeg) },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

// The solve mode of a record ("time" = Tracking Time fixed, "height" = Roll-in Altitude fixed).
export const sweepModeOf = (record) => (record?.state?.solveMode === "height" ? "height" : "time");

// The baseline record of aircraft `number` from the page's last answer ({ input, output }): its own record with the
// automatic choices frozen. `keepVrp`: the VRP Range is swept, so the Offset Angle stays solved from it.
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
  const popup = ar.popup;
  if (popup && Number.isFinite(popup.popupAngleDeg)) {
    base.values.popupAngleDeg = popup.popupAngleDeg;
    base.state.popupDriver = "ANGLE";
  }
  if (Number.isFinite(popup?.popupG)) base.values.popupG = popup.popupG;
  base.state.popupLocks = { ...(base.state.popupLocks ?? {}), angle: true, rollInSpeed: false };
  // The page's mode, with its current value.
  const pub = ar.result.profile?.public ?? {};
  if (sweepModeOf(base) === "time" && Number.isFinite(pub.trackingTimeSec)) {
    base.values.trackingTimeSec = pub.trackingTimeSec;
    base.state.enteredTrackingTimeSec = pub.trackingTimeSec;
  } else if (sweepModeOf(base) === "height" && Number.isFinite(pub.resolvedInitialAltitudeMslFt)) {
    base.values.rollInAltitudeMslFt = pub.resolvedInitialAltitudeMslFt;
  }
  return base;
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
    if (!(key in POPUP_SWEEP_INPUTS)) throw new Error(`Unknown sweep input ${key}`);
    record.values[key] = value;
    if (key === "trackingTimeSec") record.state.enteredTrackingTimeSec = value;
    if (key === "offsetAngleDeg") record.state.driver = "offsetAngleDeg";
    if (key === "vrpRangeNm") { record.state.driver = "vrpRangeNm"; record.state.vrpRangeExplicit = true; }
    if (key === "offsetG") record.state.turnDriver = "offsetG";
  }
  return record;
}

// One point: the Flight of the one aircraft with the inputs set. { status, messages, y: { outputKey: value|null } }.
export function sweepPoint(base, assignments, calculate = calculatePopupFlightFull) {
  const record = withSweepInputs(base, assignments);
  let ar;
  try {
    ar = calculate({ schemaVersion: 2, flightSize: 1, aircraft: { 1: record } })?.aircraftResults?.[1];
  } catch (error) {
    return { status: "FAILED", messages: [error.message], y: {} };
  }
  const y = {};
  for (const [key, output] of Object.entries(POPUP_SWEEP_OUTPUTS)) y[key] = ar ? output.of(ar) : null;
  return { status: ar?.status ?? "FAILED", messages: [...(ar?.errors ?? []), ...(ar?.warnings ?? [])].slice(0, 3), y };
}

// Evenly spaced X values from `from` to `to` (inclusive), `count` of them (≥ 2).
export function sweepValues(from, to, count) {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

// The whole graph in one call (tests, scripts): curves[c] = { value (condition, or null), points: [{ x, ...point }] }.
export function sweepPopupDependency(answer, { xKey, xValues, conditionKey = null, conditionValues = [null], number = 1 }, calculate) {
  const base = sweepBaseline(answer, number, { keepVrp: xKey === "vrpRangeNm" || conditionKey === "vrpRangeNm" });
  return (conditionKey ? conditionValues : [null]).map((value) => ({
    value,
    points: xValues.map((x) => ({ x, ...sweepPoint(base, { ...(conditionKey ? { [conditionKey]: value } : {}), [xKey]: x }, calculate) })),
  }));
}
