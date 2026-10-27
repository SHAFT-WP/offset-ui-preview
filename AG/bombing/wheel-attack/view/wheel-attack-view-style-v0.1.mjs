import { BDP_VIEW_COLORS, bdpViewTitle } from "../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";
import { BOX_VIEW_COLORS } from "../../box-pattern/view/box-view-style-v0.1.mjs";

// Wheel view style — Wheel-owned colours, titles and legend items for the Wheel Top View / Z-Diagram (common/diagram
// SPEC V2 unified view grammar G5, G10; the Wheel SPEC §20 owns the content). The Wheel circle has the Wheel-BOX Wheel's
// hue; Roll-in, Tracking and Target are BDP segments in the BDP colours.
export const WHEEL_ATTACK_VIEW_STYLE_V0_1 = Object.freeze({ id: "wheel-attack-view-style-v0.1", version: "0.1.0" });

export const WHEEL_ATTACK_VIEW_COLORS = Object.freeze({
  wheel: "#0f766e",
  wheelText: "#115e59",
  roll: BDP_VIEW_COLORS.rollIn,
  rollText: BDP_VIEW_COLORS.rollInText,
  attack: BDP_VIEW_COLORS.map,
  attackText: BDP_VIEW_COLORS.mapText,
  target: BDP_VIEW_COLORS.target,
  aircraft: "#64748b",
  reference: BOX_VIEW_COLORS.reference,
  invalid: BOX_VIEW_COLORS.invalid,
  guide: BOX_VIEW_COLORS.guide,
});

export const WHEEL_ATTACK_TOP_VIEW_LEGEND = Object.freeze([
  Object.freeze({ label: "Wheel", color: WHEEL_ATTACK_VIEW_COLORS.wheel }),
  Object.freeze({ label: "Roll-in", color: WHEEL_ATTACK_VIEW_COLORS.roll }),
  Object.freeze({ label: "Tracking", color: WHEEL_ATTACK_VIEW_COLORS.attack }),
]);
export const WHEEL_ATTACK_TOP_VIEW_ADVANCED_LEGEND = Object.freeze([
  ...WHEEL_ATTACK_TOP_VIEW_LEGEND,
  Object.freeze({ label: "MAP", color: WHEEL_ATTACK_VIEW_COLORS.attack }),
]);

// docs/TERMINOLOGY.md "Diagram titles": the Wheel views are titled `Wheel #n …`.
export function wheelAttackViewTitle(view, { aircraftNumber = 1 } = {}) {
  const number = Number(aircraftNumber);
  return bdpViewTitle("Wheel", view, { aircraftNumber: Number.isInteger(number) && number > 0 ? number : 1 });
}

export const wheelAttackTopViewTitle = (options) => wheelAttackViewTitle("Top View", options);
export const wheelAttackZDiagramTitle = (options) => wheelAttackViewTitle("Z-Diagram", options);
