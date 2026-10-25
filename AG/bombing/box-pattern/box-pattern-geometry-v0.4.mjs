// BOX pattern geometry v0.4 — the whole BOX racetrack as world stations and paths, built from the BOX v0.4
// composition (AG/bombing/box-pattern/SPEC.md "BOX v0.4 — MIL OUT"). v0.3's racetrack and validation, with the OUT
// Turn flown by the MIL OUT (owner 2026-10-25): its own path, `advance` along the attack run and `transfer` toward the
// pattern side, in place of v0.3's Roll-in mirror arc. The Crosswind Leg runs from the OUT Turn end. A Crosswind Leg
// shorter than the energy leg (Roll-in Altitude and speed not yet reached) is a warning, not an error.
// iBT is retired (owner 2026-10-25): the end of the Abeam Extension is `baseTurnStart`.
//
// Frame (NM), Rev1.5's local frame: alongNm along the Attack Heading from the Target (+ past it), sideNm toward the
// pattern side, which is to the right of the Attack Heading (RIGHT pattern).

export const BOX_PATTERN_GEOMETRY_MODEL_V0_4 = Object.freeze({
  id: "box-pattern-geometry-v0.4",
  version: "0.4.0",
  status: "Work / Pure Geometry / Not Official",
  source: "box-v2-composition-v0.4 result (pattern + turns + out + outClosure + crossLeg)",
  frame: "ATTACK_ALONG_PATTERN_SIDE",
});

const EPS_NM = 0.5 / 1852; // Rev1.5 validation tolerance (0.5 m)

function finite(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

const at = (alongNm, sideNm) => ({ alongNm, sideNm });
// The required minimum is stated rounded up to the NM display step, so entering it satisfies it.
const formatMinimumNm = (nm) => (Math.ceil(nm * 10 - 1e-9) / 10).toFixed(1);
// An onset turn's samples (its own forward / turn-side frame) placed at `start`, with the entry heading along
// `forward` and the turn toward `turnSide` (unit vectors in the along / side frame).
const placeTurn = (samples, start, forward, turnSide) => samples.map((sample) => at(
  start.alongNm + sample.forwardNm * forward.alongNm + sample.turnSideNm * turnSide.alongNm,
  start.sideNm + sample.forwardNm * forward.sideNm + sample.turnSideNm * turnSide.sideNm,
));

export function buildBoxPatternGeometryV0_4(boxResult) {
  const semantic = boxResult?.bombDelivery?.visualization?.semanticState;
  const turns = boxResult?.turns;
  if (!semantic || !boxResult?.pattern || !turns?.base || !turns?.cross || !boxResult?.out || !boxResult?.outClosure || !boxResult?.crossLeg) {
    throw new TypeError("boxResult must be a BOX v0.4 pattern result with its turns, OUT Maneuver and closure");
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
  const crossLegNm = finite("pattern.crossLegExtensionNm", pattern.crossLegExtensionNm);
  const abeamExtensionNm = finite("pattern.abeamExtensionDistanceNm", pattern.abeamExtensionDistanceNm);
  const baseLegNm = finite("pattern.baseLegNm", pattern.baseLegNm);
  const widthNm = finite("pattern.patternWidthNm", pattern.patternWidthNm);
  const cross = turns.cross;
  const base = turns.base;

  // OUT Turn Start = max(OUT distance, geometry minimum) from the composition's closure; the OUT Turn path is the MIL
  // OUT's (its forward = the Attack Heading, its turn side = the pattern side).
  const { effectiveOutNm, outAutoExtensionNm, outTurnAdvanceNm, outTurnTransferNm } = boxResult.outClosure;
  const outTurnStart = at(effectiveOutNm, 0);
  const outTurn = placeTurn(out.turn.samples, outTurnStart, at(1, 0), at(0, 1));
  const outTurnEnd = at(effectiveOutNm + outTurnAdvanceNm, outTurnTransferNm);
  const crossTurnStart = at(outTurnEnd.alongNm, outTurnEnd.sideNm + crossLegNm);
  const baseTurnStart = at(-abeamExtensionNm, widthNm);
  // Crosswind Turn: entry heading +side, turning toward −along (onto the Downwind).
  const crossTurn = placeTurn(cross.samples, crossTurnStart, at(0, 1), at(-1, 0));
  // Base Turn: entry heading −along (Abeam Extension), turning toward −side (onto the Base Leg).
  const baseTurn = placeTurn(base.samples, baseTurnStart, at(-1, 0), at(0, -1));
  const downwindNm = outTurnEnd.alongNm - cross.transferNm;

  const oa1 = toAttack(semantic.stations.rollInStart, "rollInStart");
  const trackPoint = toAttack(semantic.stations.trackPoint, "trackPoint");
  const release = toAttack(semantic.stations.release, "release");
  const stations = {
    target: at(0, 0),
    trackPoint,
    release,
    recoveryEnd: at(out.recoveryEndTargetNm, 0),
    outTurnStart,
    outTurnEnd,
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
    outTurn,
    crossLeg: [stations.outTurnEnd, crossTurnStart],
    crossTurn,
    downwind: [stations.crossTurnEnd, stations.abeam],
    abeamExtension: [stations.abeam, baseTurnStart],
    baseTurn,
    baseLeg: [stations.baseTurnEnd, oa1],
    rollIn: semantic.paths.rollIn.map((point) => toAttack(point, "rollIn")),
  };

  // v0.3's validation on the MIL OUT Turn (advance / transfer in place of the Roll-in mirror radius).
  const errors = [...out.validation.errors];
  const warnings = [];
  if (!(rollInSideNm > 0)) errors.push("Roll-in Long. D must be greater than 0.");
  if (abeamExtensionNm < -EPS_NM) errors.push("Abeam Extension Distance must be 0 or greater (the Base Turn advance exceeds Base Distance).");
  // A USER Crosswind Leg below the minimum is kept and reported; DEFAULT was raised by the composition.
  const minCrossLegNm = boxResult.crossLeg.minimumNm;
  if (crossLegNm + EPS_NM < minCrossLegNm) errors.push(`Crosswind Leg Extension is below minimum. Required >= ${formatMinimumNm(minCrossLegNm)} NM.`);
  if (widthNm + EPS_NM < rollInSideNm + base.transferNm) errors.push("Pattern Width must be >= Roll-in Long. D + Base Turn transfer.");
  if (baseLegNm < -EPS_NM) errors.push("Base Leg is negative; the Base Turn cannot connect to the Roll-in.");
  // The Crosswind Turn starts before the Roll-in Altitude and speed are reached (a typed leg shorter than the energy leg).
  if (boxResult.crossLeg.shortOfRollInEnergy) warnings.push(`Crosswind Leg ends before the Roll-in Altitude and speed (${formatMinimumNm(boxResult.crossLeg.energyNm)} NM needed).`);
  // The OUT Turn ends with more energy than the Roll-in Altitude and speed need; trading it away is not modelled.
  if (out.energyLeg.excessEnergy) warnings.push("OUT Turn ends above the Roll-in energy (altitude / speed); slowing or descending to it is not modelled.");

  const speedKt = finite("pattern.patternTasKt", pattern.patternTasKt);
  const legTimeSec = (distanceNm) => (Math.abs(distanceNm) * 3600) / speedKt;

  return {
    model: { ...BOX_PATTERN_GEOMETRY_MODEL_V0_4 },
    frame: BOX_PATTERN_GEOMETRY_MODEL_V0_4.frame,
    direction: "RIGHT",
    stations,
    paths,
    values: {
      patternWidthNm: widthNm,
      rollInLongitudinalDistanceNm: rollInSideNm,
      outTurnAdvanceNm,
      outTurnTransferNm,
      crossLegExtensionNm: crossLegNm,
      abeamExtensionDistanceNm: abeamExtensionNm,
      baseLegNm,
      baseDistanceNm: pattern.baseDistanceNm,
      rollInRangeNm: boxResult.bombDelivery.public.rollInRangeNm,
      effectiveOutNm,
      outAutoExtensionNm,
      crossLegMinimumNm: minCrossLegNm,
      crossLegEnergyNm: boxResult.crossLeg.energyNm,
      crossLegAutoNm: boxResult.crossLeg.autoNm,
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
    validation: { valid: errors.length === 0, errors, warnings },
  };
}
