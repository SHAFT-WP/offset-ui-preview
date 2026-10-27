import { WHEEL_BOX_BE_MODEL_V0_9, calculateWheelBoxV0_9Full } from "./wheel-box-be-v0.9.mjs";
import { WHEEL_RETURN_MODEL_V0_1, calculateWheelReturnV0_1 } from "./wheel-return-v0.1.mjs";
import { buildWheelBoxGeometryV0_8 } from "./wheel-box-geometry-v0.8.mjs";
import { tasToCas } from "../../../common/airspeed/airspeed-v0.1.mjs";
import { truncateBeOutput } from "../../../common/ui/display-precision-v0.1.mjs";

// Wheel-BOX v0.10 composition (owner 2026-10-26: "Csem이후 완만한 선회로 원을 그리게 … 전반구 wheel로 들어감",
// "고도 속도 리커버리 하면서", "레벨이 되면, g를 더 넣어서 경로로 진입한다 …", "상승 중에 속도가 감속된다 추력 모델, box
// be 참조"; Wheel SPEC §19). v0.9's composition unchanged (the attack route, Min Wheel Radius, Base Turn G, OA1), with
// the Return: after a CSEM (SEM End CLIMB), from the CSEM End back into the Wheel at Abeam on the Downwind heading
// (wheel-return-v0.1: BOX OUT's MIL Climb, OUT Turn and energy leg; the Roll-in Altitude only by Abeam, "고도만 맞추는").
// The circuit (Abeam → … → Release → SEM → Return → Abeam) is given with the Return.
// DED OA2 is the Base Turn start (owner 2026-10-26: "익스텐션 타임이 애매하다. 이를 비쥬얼 레퍼런스로 처리하겠다. Base Turn
// 시작점을 oa2로 한다"): the Abeam Extension is flown to it, not timed; it replaces v0.9's OA2 (10 NM past OA1).
// v0.4–v0.9 stay as they were.
export const WHEEL_BOX_BE_MODEL_V0_10 = Object.freeze({
  ...WHEEL_BOX_BE_MODEL_V0_9,
  id: "wheel-box-be-v0.10",
  version: "0.10.0",
  attackRouteSource: WHEEL_BOX_BE_MODEL_V0_9.id,
  returnSource: WHEEL_RETURN_MODEL_V0_1.id,
  routeSource: "wheel-box-geometry-v0.8 (v0.7's stations, paths and validation; SEM and Return)",
  defaultReturnTurnG: WHEEL_RETURN_MODEL_V0_1.defaultTurnG,
  dedOa2: "BASE_TURN_START",
});

// Public entrypoint: result truncated to 5 decimals (docs/FE-BE-RULES.md). BE-to-BE composition uses the Full form.
export function calculateWheelBoxV0_10(input) {
  return truncateBeOutput(calculateWheelBoxV0_10Full(input));
}

// The Return, or why there is none: it starts at the CSEM End, so a Level SEM (or no SEM, Dive below 10°, or a CSEM that
// cannot be flown) has none.
function wheelReturn(result, returnTurnG) {
  const sem = result.bombDelivery.public.sem;
  const samples = result.bombDelivery.visualization?.semPathSamples ?? [];
  if (!sem || sem.end !== "CLIMB" || sem.status !== "VALID" || samples.length === 0) {
    const reason = !sem ? "no SEM (Dive Angle below 10°)" : sem.end !== "CLIMB" ? "the SEM End is LEVEL; the Return starts at a CSEM End" : "the CSEM cannot be flown";
    return { model: { ...WHEEL_RETURN_MODEL_V0_1 }, status: "NOT_CALCULATED", reason, inputs: { turnG: returnTurnG }, errors: [], warnings: [], samples: [] };
  }
  const end = samples.at(-1);
  const release = result.geometry.stations.release;
  return calculateWheelReturnV0_1({
    start: {
      alongNm: release.alongNm + end.downRangeNm,
      sideNm: release.sideNm + result.turnSideSign * end.crossRangeNm,
      altitudeMslFt: end.altitudeMslFt,
      casKt: tasToCas(end.tasKt, end.altitudeMslFt),
      fpaDeg: end.fpaDeg,
    },
    abeam: result.geometry.stations.abeam,
    target: { altitudeMslFt: result.pattern.patternAltitudeMslFt, casKt: result.pattern.patternSpeedKcas },
    turnG: returnTurnG,
  });
}

const DEG = Math.PI / 180;
const FT_PER_NM = 6076.11549;
const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

// v0.9's DED point: the Target → point true bearing, range (NM, ft) and the Roll-in altitude. The attack frame's side axis
// is Attack Heading + 90° for RIGHT and − 90° for LEFT.
function dedPoint({ alongNm, sideNm }, attackHeadingDeg, sign, elevationFt) {
  const rangeNm = Math.hypot(alongNm, sideNm);
  return {
    bearingDeg: normalizeDeg(attackHeadingDeg + sign * (Math.atan2(sideNm, alongNm) / DEG)),
    rangeNm,
    rangeFt: rangeNm * FT_PER_NM,
    elevationFt,
  };
}

const pathLengthNm = (points) => points.reduce((sum, point, index) => (index ? sum + Math.hypot(point.alongNm - points[index - 1].alongNm, point.sideNm - points[index - 1].sideNm) : 0), 0);

// The circuit flown once around (ground distance, time), when the Return is solved. Attack legs at the pattern TAS;
// Roll-in, Tracking and SEM from the BDP; the Return its own.
function circuit(result) {
  const ret = result.return;
  if (!ret || !ret.samples?.length) return null;
  const p = result.pattern;
  const pub = result.bombDelivery.public;
  const legs = [
    { leg: "Abeam Extension", distanceNm: p.abeamExtensionDistanceNm, timeSec: p.abeamExtensionTimeSec },
    { leg: "Base Turn", distanceNm: (p.patternTasKt * result.turns.base.timeSec) / 3600, timeSec: result.turns.base.timeSec },
    { leg: "Base Leg", distanceNm: p.baseLegNm, timeSec: p.baseLegTimeSec },
    { leg: "Roll-in", distanceNm: pub.rollInGroundArcNm, timeSec: pub.rollInTimeSec },
    { leg: "Tracking", distanceNm: pathLengthNm(result.geometry.paths.tracking), timeSec: pub.trackingTimeSec },
    { leg: "SEM", distanceNm: pathLengthNm(result.geometry.paths.sem), timeSec: pub.sem.endTimeSec },
    { leg: "Return", distanceNm: ret.distanceNm, timeSec: ret.timeSec },
  ];
  return {
    legs,
    distanceNm: legs.reduce((sum, leg) => sum + leg.distanceNm, 0),
    timeSec: legs.reduce((sum, leg) => sum + leg.timeSec, 0),
  };
}

// input: v0.9's (bombDeliveryInput, attackHeadingDeg, direction, downwindAngleDeg 0, wheelRadiusNm, baseTurnG, Wheel /
// Orbit options), plus
//   returnTurnG       Return Turn G: the 90° bank part of the turn (BOX OUT's), > 1 and ≤ 3 G (default 1.5); the level
//                     part's Join G is the result's
export function calculateWheelBoxV0_10Full({
  returnTurnG = WHEEL_BOX_BE_MODEL_V0_10.defaultReturnTurnG,
  ...input
}) {
  if (typeof returnTurnG !== "number" || !Number.isFinite(returnTurnG)) throw new TypeError("returnTurnG must be finite");
  if (!(returnTurnG > 1 && returnTurnG <= WHEEL_RETURN_MODEL_V0_1.maxTurnG)) throw new RangeError(`Return Turn G must be > 1 and <= ${WHEEL_RETURN_MODEL_V0_1.maxTurnG} G`);
  const attack = calculateWheelBoxV0_9Full(input);
  const result = { ...attack, model: { ...WHEEL_BOX_BE_MODEL_V0_10 } };
  result.ded = { ...attack.ded, oa2: dedPoint(attack.geometry.stations.baseTurnStart, attack.attackHeadingDeg, attack.turnSideSign, attack.ded.oa1.elevationFt) };
  result.return = wheelReturn(result, returnTurnG);
  // The SEM path is the geometry's; the circuit needs it before the geometry is rebuilt with the Return.
  result.geometry = buildWheelBoxGeometryV0_8({ ...result, circuit: null });
  result.circuit = circuit(result);
  result.geometry = buildWheelBoxGeometryV0_8(result);
  return result;
}
