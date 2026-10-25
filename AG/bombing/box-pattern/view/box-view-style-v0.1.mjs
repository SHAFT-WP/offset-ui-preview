import { BDP_VIEW_COLORS, bdpViewTitle } from "../../bomb-delivery-planner/view/bdp-view-style-v0.1.mjs";

// BOX view style — BOX-owned colours, titles and legend items for the BOX Top View / Z-Diagram
// (common/diagram/SPEC.md V2 unified view grammar G5, G10; the BOX SPEC owns the content). The
// pattern segments use colours kept apart from the BDP set; Roll-in, Tracking (Track Point → Bombs
// Away, the MAP colour) and Target are BDP segments and use the BDP colours.

export const BOX_VIEW_STYLE_V0_1 = Object.freeze({
  id: "box-view-style-v0.1",
  // 0.1.1 (2026-09-29): Rev1.5 racetrack segments (OUT, Crosswind, Downwind) in Rev1.5-derived hues.
  version: "0.1.1",
});

// Pattern hues follow Rev1.5 where they do not collide with the BDP set drawn in the same view
// (Abeam Extension / Base Turn move from Rev1.5 amber to orange so they stay apart from the BDP MAP
// amber of the Tracking run).
export const BOX_VIEW_COLORS = Object.freeze({
  out: "#2563eb",
  outText: "#1d4ed8",
  crosswind: "#0891b2",
  crosswindText: "#0e7490",
  downwind: "#15803d",
  downwindText: "#166534",
  abeam: "#c2410c",
  abeamText: "#9a3412",
  baseLeg: "#7c3aed",
  baseLegText: "#6d28d9",
  roll: BDP_VIEW_COLORS.rollIn,
  rollText: BDP_VIEW_COLORS.rollInText,
  attack: BDP_VIEW_COLORS.map,
  attackText: BDP_VIEW_COLORS.mapText,
  target: BDP_VIEW_COLORS.target,
  reference: "#5b6f82",
  invalid: "#bd3333",
  guide: "#b1bbc4",
});

export const BOX_TOP_VIEW_LEGEND = Object.freeze([
  Object.freeze({ label: "Tracking", color: BOX_VIEW_COLORS.attack }),
  Object.freeze({ label: "OUT Maneuver", color: BOX_VIEW_COLORS.out }),
  Object.freeze({ label: "Crosswind", color: BOX_VIEW_COLORS.crosswind }),
  Object.freeze({ label: "Downwind", color: BOX_VIEW_COLORS.downwind }),
  Object.freeze({ label: "Abeam Extension / Base Turn", color: BOX_VIEW_COLORS.abeam }),
  Object.freeze({ label: "Base Leg", color: BOX_VIEW_COLORS.baseLeg }),
  Object.freeze({ label: "Roll-in", color: BOX_VIEW_COLORS.roll }),
]);

// docs/TERMINOLOGY.md "Diagram titles": pattern views always carry the aircraft number (#1 included).
export function boxViewTitle(view, { aircraftNumber = 1 } = {}) {
  const number = Number(aircraftNumber);
  return bdpViewTitle("BOX", view, { aircraftNumber: Number.isInteger(number) && number > 0 ? number : 1 });
}

export const boxTopViewTitle = (options) => boxViewTitle("Top View", options);
export const boxZDiagramTitle = (options) => boxViewTitle("Z-Diagram", options);
