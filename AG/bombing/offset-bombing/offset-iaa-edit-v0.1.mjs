// IAA as an input of the Offset / POP-UP Flight (owner 2026-11-22: "bdp에 iaa 입력 필드 넣어줄 것. 처음은 iaa를 건드리면
// 롤인 고도와 release 고도가 바뀐다"). IAA (= Aim-off Angle, BDP SPEC §IAA) stays a BDP result; a typed IAA is turned into
// the Release Altitude that gives it, so nothing else in the Flight changes:
// - Roll-in Altitude not LOCKed: the Tracking Time shown is held (entered, 0.1 s) and the Release Altitude is solved;
//   the Roll-in Altitude follows (BDP time mode). Both altitudes move.
// - Roll-in Altitude LOCKed: the Roll-in Altitude holds, the Release Altitude is solved and the Tracking Time follows
//   (BDP height mode).
// The solve is a secant on the aircraft's own BDP canonical input (the geometry it flew), repeated on the Flight's
// answer while the geometry (Angle-Off, wind) moves. Every answer's nextInput carries values.iaaDeg = the IAA flown
// (profile.local.aimOffAngleDeg, Full value; the page shows it like any solved field). An IAA no Release Altitude reaches is a WARNING on that
// aircraft and the Flight stays as it was.
import { calculateBombDeliveryV0_4Full } from "../bomb-delivery-planner/bomb-delivery-planner-v0.4.mjs";

export const OFFSET_IAA_EDIT_V0_1 = Object.freeze({
  id: "offset-iaa-edit-v0.1",
  version: "0.1.0",
  key: "iaaDeg",
  toleranceDeg: 0.001,
  // Accepted residual: under half the page's 0.1° step, so the field shows the IAA typed (POP-UP's AUTO angle moves the
  // geometry in small steps, so its last pass can be a few hundredths off).
  acceptDeg: 0.04,
  iterations: 24,
  geometryPasses: 4,
  firstStepFt: 400,
});

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const roundTrackingTime = (value) => Math.round(value * 10) / 10;
const isIaaEdit = (edit) => edit?.key === OFFSET_IAA_EDIT_V0_1.key;

function editsOf(input) {
  return [...(input?.edit ? [input.edit] : []), ...(input?.edits ?? [])];
}

// The input with no IAA edit and no values.iaaDeg (what the Flight itself is given; a session's prepare too).
export function withoutIaa(input) {
  if (!input || typeof input !== "object" || !input.aircraft || typeof input.aircraft !== "object") return input;
  const next = { ...input, aircraft: { ...input.aircraft } };
  if (next.edit && isIaaEdit(next.edit)) delete next.edit;
  if (next.edits) next.edits = next.edits.filter((edit) => !isIaaEdit(edit));
  for (const n of Object.keys(next.aircraft)) {
    const record = next.aircraft[n];
    if (record?.values && Object.hasOwn(record.values, OFFSET_IAA_EDIT_V0_1.key)) {
      const { [OFFSET_IAA_EDIT_V0_1.key]: _iaa, ...values } = record.values;
      next.aircraft[n] = { ...record, values };
    }
  }
  return next;
}

const iaaOf = (entry) => entry?.result?.profile?.local?.aimOffAngleDeg;

// Every aircraft's nextInput gets the IAA it flies (null without a result).
function withIaaValues(output) {
  const aircraft = output?.nextInput?.aircraft;
  if (!aircraft) return output;
  for (const n of Object.keys(aircraft)) {
    const values = aircraft[n]?.values;
    if (!values) continue;
    const iaa = iaaOf(output.aircraftResults?.[n]);
    values[OFFSET_IAA_EDIT_V0_1.key] = isNumber(iaa) ? iaa : null;
  }
  return output;
}

const rollInLocked = (record, number) => (Number(number) === 1 ? record?.locks?.rollInAltitudeMslFt === true : record?.options?.rollInAltitudeLocked === true);

// The Release Altitude whose BDP (canonical input of the flown geometry) gives iaaDeg. mode "time" holds the Tracking
// Time (the Roll-in Altitude follows), "height" the Roll-in Altitude.
export function solveReleaseAltitudeForIaa({ canonicalInputs, iaaDeg, releaseAltitudeMslFt, mode, trackingTimeSec, rollInAltitudeMslFt }) {
  const cfg = OFFSET_IAA_EDIT_V0_1;
  const floorFt = canonicalInputs.targetElevationMslFt + 100;
  const base = mode === "time"
    ? { ...canonicalInputs, solveMode: "time", trackingTimeSec, allowNegativeTrackingTime: true }
    : { ...canonicalInputs, solveMode: "height", initialAltitudeMslFt: rollInAltitudeMslFt, allowNegativeTrackingTime: true };
  const f = (release) => {
    const out = calculateBombDeliveryV0_4Full({ ...base, releaseAltitudeMslFt: release });
    const p = out.public;
    // Below the NLT the BDP releases at the NLT: that Release does not give a new IAA.
    if (isNumber(p.effectiveReleaseAltitudeMslFt) && Math.abs(p.effectiveReleaseAltitudeMslFt - release) > 0.5) return { value: NaN, clamped: true };
    return { value: out.local.aimOffAngleDeg - iaaDeg, clamped: false };
  };
  let x0 = Math.max(floorFt, releaseAltitudeMslFt);
  let r0 = f(x0);
  if (!isNumber(r0.value)) return { value: null, reason: r0.clamped ? "below the NLT" : "no IAA at this Release Altitude" };
  if (Math.abs(r0.value) <= cfg.toleranceDeg) return { value: x0 };
  let x1 = x0 + (r0.value > 0 ? -cfg.firstStepFt : cfg.firstStepFt);
  let clampedSeen = false;
  for (let index = 0; index < cfg.iterations; index += 1) {
    if (x1 < floorFt) x1 = floorFt;
    let r1;
    try { r1 = f(x1); } catch { r1 = { value: NaN, clamped: false }; }
    if (!isNumber(r1.value)) {
      clampedSeen ||= r1.clamped;
      // Step back halfway toward the last good point.
      x1 = (x0 + x1) / 2;
      if (Math.abs(x1 - x0) < 1) break;
      continue;
    }
    if (Math.abs(r1.value) <= cfg.toleranceDeg) return { value: x1 };
    const slope = (r1.value - r0.value) / (x1 - x0);
    if (!isNumber(slope) || Math.abs(slope) < 1e-9) break;
    x0 = x1;
    r0 = r1;
    x1 -= r1.value / slope;
  }
  return { value: null, reason: clampedSeen ? "the Release Altitude it needs is below the NLT" : "no Release Altitude gives it" };
}

// calculate(input) → a Flight output (calculateOffsetFlightFull's / calculatePopupFlightFull's contract).
export function calculateWithIaaEdit(input, calculate) {
  const iaaEdits = editsOf(input).filter((edit) => isIaaEdit(edit) && edit.kind === "set");
  const baseInput = withoutIaa(input);
  let output = calculate(baseInput);
  if (!iaaEdits.length) return withIaaValues(output);
  const cfg = OFFSET_IAA_EDIT_V0_1;
  // The last IAA edit per aircraft.
  const byAircraft = new Map(iaaEdits.map((edit) => [String(edit.aircraft ?? 1), edit]));
  for (const [n] of byAircraft) {
    const target = input.aircraft?.[n]?.values?.[cfg.key];
    if (!isNumber(target)) continue;
    const warn = (text) => {
      const entry = output.aircraftResults?.[n];
      if (!entry) return;
      entry.warnings = [...(entry.warnings ?? []), `IAA ${target.toFixed(1)}°: ${text}`];
      if (entry.status === "VALID") entry.status = "WARNING";
    };
    let first = true;
    for (let pass = 0; pass < cfg.geometryPasses; pass += 1) {
      const entry = output.aircraftResults?.[n];
      const profile = entry?.result?.profile;
      if (!profile?.canonicalInputs) { warn("no BDP result to solve from"); break; }
      if (!(profile.canonicalInputs.diveAngleDeg > 0)) { warn("a level delivery has no IAA"); break; }
      if (isNumber(iaaOf(entry)) && Math.abs(iaaOf(entry) - target) <= cfg.acceptDeg && !first) break;
      const record = output.nextInput?.aircraft?.[n];
      if (!record?.values) break;
      const locked = rollInLocked(record, n);
      const shownTracking = isNumber(record.values.trackingTimeSec) ? record.values.trackingTimeSec : profile.public.trackingTimeSec;
      const trackingTimeSec = roundTrackingTime(shownTracking);
      let solved;
      try {
        solved = solveReleaseAltitudeForIaa({
          canonicalInputs: profile.canonicalInputs,
          iaaDeg: target,
          releaseAltitudeMslFt: profile.public.effectiveReleaseAltitudeMslFt ?? profile.canonicalInputs.releaseAltitudeMslFt,
          mode: locked ? "height" : "time",
          trackingTimeSec,
          rollInAltitudeMslFt: profile.public.resolvedInitialAltitudeMslFt,
        });
      } catch (error) {
        solved = { value: null, reason: error?.message ?? String(error) };
      }
      if (!isNumber(solved.value)) { warn(solved.reason); break; }
      const next = structuredClone(output.nextInput);
      const values = next.aircraft[n].values;
      delete values[cfg.key];
      values.releaseAltitudeMslFt = solved.value;
      const edits = [];
      if (!locked && first) {
        values.trackingTimeSec = trackingTimeSec;
        edits.push({ aircraft: Number(n), kind: "set", key: "trackingTimeSec", commit: true });
      }
      edits.push({ aircraft: Number(n), kind: "set", key: "releaseAltitudeMslFt", commit: true });
      const attempt = calculate(withoutIaa({ ...next, edits }));
      if (!attempt?.aircraftResults?.[n]?.result) { warn("the Flight did not fly that Release Altitude"); break; }
      output = attempt;
      first = false;
    }
  }
  return withIaaValues(output);
}
