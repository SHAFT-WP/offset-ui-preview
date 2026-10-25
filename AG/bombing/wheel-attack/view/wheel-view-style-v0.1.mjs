import { BDP_VIEW_COLORS, bdpViewTitle } from "../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";
import { BOX_VIEW_COLORS } from "../../box-pattern/view/box-view-style-v0.1.mjs";

// Wheel-BOX view style — Wheel-owned colours, titles and legend items for the Wheel-BOX Top View / Z-Diagram
// (common/diagram/SPEC.md V2 unified view grammar G5, G10; the Wheel SPEC owns the content). The segments Wheel-BOX
// shares with BOX (Abeam Extension, Base Turn, Base Leg) keep BOX's hues; Roll-in, Tracking and Target are BDP
// segments in the BDP colours; the Wheel circle has its own hue.
export const WHEEL_VIEW_STYLE_V0_1 = Object.freeze({ id: "wheel-view-style-v0.1", version: "0.1.0" });

export const WHEEL_VIEW_COLORS = Object.freeze({
  wheel: "#0f766e",
  wheelText: "#115e59",
  abeam: BOX_VIEW_COLORS.abeam,
  abeamText: BOX_VIEW_COLORS.abeamText,
  baseLeg: BOX_VIEW_COLORS.baseLeg,
  baseLegText: BOX_VIEW_COLORS.baseLegText,
  roll: BDP_VIEW_COLORS.rollIn,
  rollText: BDP_VIEW_COLORS.rollInText,
  attack: BDP_VIEW_COLORS.map,
  attackText: BDP_VIEW_COLORS.mapText,
  target: BDP_VIEW_COLORS.target,
  rollInTarget: BDP_VIEW_COLORS.rollInTarget,
  orbit: "#64748b",
  reference: BOX_VIEW_COLORS.reference,
  invalid: BOX_VIEW_COLORS.invalid,
  guide: BOX_VIEW_COLORS.guide,
});

export const WHEEL_TOP_VIEW_LEGEND = Object.freeze([
  Object.freeze({ label: "Wheel", color: WHEEL_VIEW_COLORS.wheel }),
  Object.freeze({ label: "Tracking", color: WHEEL_VIEW_COLORS.attack }),
  Object.freeze({ label: "Abeam Extension / Base Turn", color: WHEEL_VIEW_COLORS.abeam }),
  Object.freeze({ label: "Base Leg", color: WHEEL_VIEW_COLORS.baseLeg }),
  Object.freeze({ label: "Roll-in", color: WHEEL_VIEW_COLORS.roll }),
]);

// docs/TERMINOLOGY.md "Diagram titles": the Wheel-BOX views are titled `Wheel-BOX #n …` (Wheel SPEC Status).
export function wheelViewTitle(view, { aircraftNumber = 1 } = {}) {
  const number = Number(aircraftNumber);
  return bdpViewTitle("Wheel-BOX", view, { aircraftNumber: Number.isInteger(number) && number > 0 ? number : 1 });
}

export const wheelTopViewTitle = (options) => wheelViewTitle("Top View", options);
export const wheelZDiagramTitle = (options) => wheelViewTitle("Z-Diagram", options);
