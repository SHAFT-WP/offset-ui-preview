// BOX pattern geometry v0.3 — the whole BOX racetrack as world stations and paths, built from the BOX v0.3
// composition (AG/bombing/box-pattern/SPEC.md "BOX v0.3 BE — BDP v0.4 and onset level turns").
// Same racetrack and Rev1.5 validation as v0.2, with the Crosswind and Base Turns flown as Common onset level turns
// (owner 2026-10-23/25): a 90° turn moves `advance` along its entry heading and `transfer` along its exit heading,
// which replace the one radius v0.2 used for both. The OUT Turn keeps the Rev1.5 mirror of the Roll-in (radius =
// Roll-in Long. D). iBT is retired (owner 2026-10-25): the end of the Abeam Extension is `baseTurnStart`.
//
// Frame (NM), Rev1.5's local frame: alongNm along the Attack Heading from the Target (+ past it), sideNm toward the
// pattern side, which is to the right of the Attack Heading (RIGHT pattern).

export const BOX_PATTERN_GEOMETRY_MODEL_V0_3 = Object.freeze({
  id: "box-pattern-geometry-v0.3",
  version: "0.3.0",
  status: "Work / Pure Geometry / Not Official",
  source: "box-v2-composition-v0.3 result (pattern + turns + out + outClosure + crossLeg)",
  frame: "ATTACK_ALONG_PATTERN_SIDE",
});

const ARC_SAMPLES = 24;
const EPS_NM = 0.5 / 1852; // Rev1.5 validation tolerance (0.5 m)

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

const at = (alongNm, sideNm) => ({ alongNm, sideNm });
// The required minimum is stated rounded up to the NM display step, so entering it satisfies it.
const formatMinimumNm = (nm) => (Math.ceil(nm * 10 - 1e-9) / 10).toFixed(1);
const quarter = (fn) => Array.from({ length: ARC_SAMPLES + 1 }, (_, index) => fn((Math.PI / 2) * (index / ARC_SAMPLES)));
// An onset turn's samples (its own forward / turn-side frame) placed at `start`, with the entry heading along
// `forward` and the turn toward `turnSide` (unit vectors in the along / side frame).
const placeTurn = (samples, start, forward, turnSide) => samples.map((sample) => at(
  start.alongNm + sample.forwardNm * forward.alongNm + sample.turnSideNm * turnSide.alongNm,
  start.sideNm + sample.forwardNm * forward.sideNm + sample.turnSideNm * turnSide.sideNm,
));

export function buildBoxPatternGeometryV0_3(boxResult) {
  const semantic = boxResult?.bombDelivery?.visualization?.semanticState;
  const turns = boxResult?.turns;
  if (!semantic || !boxResult?.pattern || !turns?.base || !turns?.cross || !boxResult?.out || !boxResult?.outClosure || !boxResult?.crossLeg) {
    throw new TypeError("boxResult must be a BOX v0.3 pattern result with its turns, OUT Maneuver and closure");
  }
  const pattern = boxResult.pattern;
  const out = boxResult.out;
  const target = semantic.stations.target;
  // BDP semantic frame (forward = pre-roll-in heading, turn side = Attack Heading) → attack frame.
  const toAttack = (point, name) => at(
    finite(`${name}.turnSideNm`, point.turnSideNm) - target.turnSideNm,
    target.forwardNm - finite(`${name}.forwardNm`, point.forwardNm),
  );

  const rollInSideNm = finite("pattern.rollInLongitudinalDistanceNm", pattern.rollInLongitudinalDistanceNm);
  const outTurnRadiusNm = rollInSideNm;
  const crossLegNm = finite("pattern.crossLegExtensionNm", pattern.crossLegExtensionNm);
  const abeamExtensionNm = finite("pattern.abeamExtensionDistanceNm", pattern.abeamExtensionDistanceNm);
  const baseLegNm = finite("pattern.baseLegNm", pattern.baseLegNm);
  const widthNm = finite("pattern.patternWidthNm", pattern.patternWidthNm);
  const cross = turns.cross;
  const base = turns.base;

  // OUT Turn Start = max(OUT distance, geometry minimum) from the composition's closure.
  const { effectiveOutNm, outAutoExtensionNm, climbCrossMinNm } = boxResult.outClosure;
  const crossTurnStart = at(effectiveOutNm + outTurnRadiusNm, outTurnRadiusNm + crossLegNm);
  const baseTurnStart = at(-abeamExtensionNm, widthNm);
  // Crosswind Turn: entry heading +side, turning toward −along (onto the Downwind).
  const crossTurn = placeTurn(cross.samples, crossTurnStart, at(0, 1), at(-1, 0));
  // Base Turn: entry heading −along (Abeam Extension), turning toward −side (onto the Base Leg).
  const baseTurn = placeTurn(base.samples, baseTurnStart, at(-1, 0), at(0, -1));
  const downwindNm = effectiveOutNm + outTurnRadiusNm - cross.transferNm;

  const oa1 = toAttack(semantic.stations.rollInStart, "rollInStart");
  const trackPoint = toAttack(semantic.stations.trackPoint, "trackPoint");
  const release = toAttack(semantic.stations.release, "release");
  const stations = {
    target: at(0, 0),
    trackPoint,
    release,
    recoveryEnd: at(out.recoveryEndTargetNm, 0),
    outTurnStart: at(effectiveOutNm, 0),
    outTurnEnd: at(effectiveOutNm + outTurnRadiusNm, outTurnRadiusNm),
    crossTurnStart,
    crossTurnEnd: crossTurn.at(-1),
    abeam: at(0, widthNm),
    baseTurnStart,
    baseTurnEnd: baseTurn.at(-1),
    oa1,
  };
  const paths = {
    tracking: [trackPoint, release],
    outManeuver: [release, stations.outTurnStart],
    outTurn: quarter((t) => at(effectiveOutNm + outTurnRadiusNm * Math.sin(t), outTurnRadiusNm * (1 - Math.cos(t)))),
    crossLeg: [stations.outTurnEnd, crossTurnStart],
    crossTurn,
    downwind: [stations.crossTurnEnd, stations.abeam],
    abeamExtension: [stations.abeam, baseTurnStart],
    baseTurn,
    baseLeg: [stations.baseTurnEnd, oa1],
    rollIn: semantic.paths.rollIn.map((point) => toAttack(point, "rollIn")),
  };

  // Rev1.5 validateGeometry on the onset quantities (advance / transfer in place of the radius).
  const errors = [...out.validation.errors];
  if (!(outTurnRadiusNm > 0)) errors.push("Roll-in Long. D / OUT Turn Radius must be greater than 0.");
  if (abeamExtensionNm < -EPS_NM) errors.push("Abeam Extension Distance must be 0 or greater (the Base Turn advance exceeds Base Distance).");
  // A USER Crosswind Leg below the minimum is kept and reported; DEFAULT was raised by the composition.
  const minCrossLegNm = boxResult.crossLeg.minimumNm;
  if (crossLegNm + EPS_NM < minCrossLegNm) errors.push(`Crosswind Leg Extension is below minimum. Required >= ${formatMinimumNm(minCrossLegNm)} NM.`);
  if (widthNm + EPS_NM < outTurnRadiusNm + base.transferNm) errors.push("Pattern Width must be >= Roll-in Long. D + Base Turn transfer.");
  if (baseLegNm < -EPS_NM) errors.push("Base Leg is negative; the Base Turn cannot connect to the Roll-in.");

  const speedKt = finite("pattern.patternTasKt", pattern.patternTasKt);
  const legTimeSec = (distanceNm) => (Math.abs(distanceNm) * 3600) / speedKt;

  return {
    model: { ...BOX_PATTERN_GEOMETRY_MODEL_V0_3 },
    frame: BOX_PATTERN_GEOMETRY_MODEL_V0_3.frame,
    direction: "RIGHT",
    stations,
    paths,
    values: {
      patternWidthNm: widthNm,
      rollInLongitudinalDistanceNm: rollInSideNm,
      outTurnRadiusNm,
      crossLegExtensionNm: crossLegNm,
      abeamExtensionDistanceNm: abeamExtensionNm,
      baseLegNm,
      baseDistanceNm: pattern.baseDistanceNm,
      rollInRangeNm: boxResult.bombDelivery.public.rollInRangeNm,
      effectiveOutNm,
      outAutoExtensionNm,
      climbCrossMinNm,
      crossLegMinimumNm: minCrossLegNm,
      crossLegAutoExtended: boxResult.crossLeg.autoExtended,
      downwindNm,
      downwindTimeSec: legTimeSec(downwindNm),
      baseLegTimeSec: legTimeSec(baseLegNm),
      patternSpeedKcas: pattern.patternSpeedKcas,
      // Closure residuals (0 when consistent): the Base Turn ends on the Base Leg line into OA1, and the Crosswind
      // Turn ends on the Downwind line (side = Pattern Width).
      baseLegClosureNm: Math.hypot(
        stations.baseTurnEnd.alongNm - oa1.alongNm,
        stations.baseTurnEnd.sideNm - baseLegNm - oa1.sideNm,
      ),
      crossTurnEndSideResidualNm: stations.crossTurnEnd.sideNm - widthNm,
    },
    validation: { valid: errors.length === 0, errors },
  };
}
