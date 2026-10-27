// Wheel-BOX route geometry v0.8 — v0.7's stations, paths and validation on the Wheel-BOX v0.10 result, with the SEM and
// the Return (AG/bombing/wheel-attack/SPEC.md §19). The view only projects them.
//
// Frame (NM), v0.7's: alongNm along the Attack Heading from the Target, sideNm toward the pattern side. Added:
//   paths.sem      the BDP SEM path from Release (the CSEM to its End; a Level SEM to its level carry's end)
//   paths.return   the Return from the CSEM End to Abeam (Climb → Extension → Return Turn → Downwind)
//   stations       csemEnd, returnTurnStart, returnLevel (the turn level), returnJoin (on the Abeam line) when solved;
//                  oa2 = baseTurnStart (DED OA2, Wheel-BOX v0.10)
//   values         oa2RangeNm, oa2AngleDeg: OA2 from the Target as the Roll-in point's range / Lead Angle (the angle
//                  off the reciprocal of the Attack Heading toward the pattern side)
// The Return closes the circuit: … → Release → SEM → Return → Abeam → Abeam Extension → … A Return that cannot be flown
// is a warning: the attack route is v0.7's and stays valid.

import { buildWheelBoxGeometryV0_7, formatWheelRadiusNm } from "./wheel-box-geometry-v0.7.mjs";

export const WHEEL_BOX_GEOMETRY_MODEL_V0_8 = Object.freeze({
  id: "wheel-box-geometry-v0.8",
  version: "0.8.0",
  status: "Work / Pure Geometry / Not Official",
  source: "wheel-box-be-v0.10 result (v0.9's + return)",
  frame: "ATTACK_ALONG_PATTERN_SIDE",
});

export { formatWheelRadiusNm };

const at = (alongNm, sideNm) => ({ alongNm, sideNm });

export function buildWheelBoxGeometryV0_8(result) {
  const base = buildWheelBoxGeometryV0_7(result);
  const release = base.stations.release;
  // SEM samples: down range along the Attack Heading from Release; cross range right of it (+), so × the side sign.
  const semSamples = result.bombDelivery.visualization?.semPathSamples ?? [];
  const sem = semSamples.length ? semSamples.map((s) => at(release.alongNm + s.downRangeNm, release.sideNm + result.turnSideSign * s.crossRangeNm)) : null;
  const ret = result.return;
  const solved = ret && Array.isArray(ret.samples) && ret.samples.length > 0;
  const oa2 = base.stations.baseTurnStart;
  const stations = { ...base.stations, oa2 };
  if (solved) Object.assign(stations, {
    csemEnd: ret.stations.csemEnd,
    returnTurnStart: ret.stations.turnStart,
    returnLevel: ret.stations.levelPoint,
    returnJoin: ret.stations.joinPoint,
  });
  const warnings = [...base.validation.warnings];
  if (ret && ret.status === "INVALID") warnings.push(...ret.errors);
  if (ret && Array.isArray(ret.warnings)) warnings.push(...ret.warnings);
  return {
    ...base,
    model: { ...WHEEL_BOX_GEOMETRY_MODEL_V0_8 },
    stations,
    paths: {
      ...base.paths,
      sem,
      return: solved ? ret.samples.map((s) => at(s.alongNm, s.sideNm)) : null,
    },
    values: {
      ...base.values,
      returnStatus: ret?.status ?? null,
      returnTimeSec: solved ? ret.timeSec : null,
      returnDistanceNm: solved ? ret.distanceNm : null,
      // The Return ends at Abeam (0 when consistent).
      returnAbeamClosureNm: solved ? Math.hypot(ret.stations.abeam.alongNm - base.stations.abeam.alongNm, ret.stations.abeam.sideNm - base.stations.abeam.sideNm) : null,
      oa2RangeNm: Math.hypot(oa2.alongNm, oa2.sideNm),
      oa2AngleDeg: Math.atan2(oa2.sideNm, -oa2.alongNm) * (180 / Math.PI),
      circuitDistanceNm: result.circuit?.distanceNm ?? null,
      circuitTimeSec: result.circuit?.timeSec ?? null,
    },
    validation: { valid: base.validation.errors.length === 0, errors: base.validation.errors, warnings },
  };
}
