// BDP view style — the BDP-owned colours, legend items and titles shared by every view that draws
// BDP-derived geometry (common/diagram/SPEC.md V2 unified view grammar G5, G10). Roll-in Top View,
// Dive Profile and the Full BDP panel use it; pattern views (Offset, BOX, Wheel-BOX) import these
// colours for the BDP segments they draw instead of copying hex values.
import { formatDeg, formatNm } from "../../../../common/ui/display-precision-v0.1.mjs";

export const BDP_VIEW_STYLE_V0_1 = Object.freeze({
  id: "bdp-view-style-v0.1",
  // 0.1.1 (2026-10-03): rollInAngleRangeText — the "NN°/N.NNM" Roll-in Point note.
  version: "0.1.1",
});

// Roll-in Point note (user 2026-10-03): "NN°/N.NNM" = Roll-in Angle Off (public.rollInAngleOffDeg,
// nose → Target at the Roll-in Point) / Roll-in Range. Shared by the Roll-in Top View and the
// pattern Top Views (Offset). undefined when the BDP result lacks either value.
export function rollInAngleRangeText(profilePublic) {
  const angle = profilePublic?.rollInAngleOffDeg;
  const range = profilePublic?.rollInRangeNm;
  if (!Number.isFinite(angle) || !Number.isFinite(range)) return undefined;
  return `${formatDeg(angle)}°/${formatNm(range)}NM`;
}

export const BDP_VIEW_COLORS = Object.freeze({
  // Roll-in Top View
  initialTrack: "#2f6fc2",
  rollIn: "#c85ac8",
  rollInText: "#a443aa",
  map: "#d59400",
  mapText: "#b77d00",
  rollInTarget: "#d64b4b",
  target: "#d64b4b",
  aimOff: "#087b4c",
  frame: "#203a63",
  groundRangeFill: "#f5f8fd",
  // Dive Profile
  flightPath: "#176dac",
  release: "#a35d00",
  los: "#a35d00",
  bomb: "#087b4c",
  impact: "#087b4c",
  verticalTracking: "#7a4cb1",
  ground: "#14202c",
});

export const BDP_TOP_VIEW_LEGEND = Object.freeze([
  Object.freeze({ label: "Initial track", color: BDP_VIEW_COLORS.initialTrack }),
  Object.freeze({ label: "Roll-in", color: BDP_VIEW_COLORS.rollIn }),
  Object.freeze({ label: "MAP", color: BDP_VIEW_COLORS.map }),
  Object.freeze({ label: "Roll-in / Target", color: BDP_VIEW_COLORS.rollInTarget }),
  Object.freeze({ label: "Aim-off", color: BDP_VIEW_COLORS.aimOff }),
]);

export const BDP_PROFILE_LEGEND = Object.freeze([
  Object.freeze({ label: "Flight path (FPM line)", color: BDP_VIEW_COLORS.flightPath }),
  Object.freeze({ label: "Bomb trajectory", color: BDP_VIEW_COLORS.bomb }),
  Object.freeze({ label: "Target LOS", color: BDP_VIEW_COLORS.los, dashed: true }),
]);

// docs/TERMINOLOGY.md "Diagram titles": <Subject>[ #n] <View>.
export function bdpViewTitle(subject, view, { aircraftNumber } = {}) {
  const number = Number(aircraftNumber);
  return Number.isInteger(number) && number > 0 ? `${subject} #${number} ${view}` : `${subject} ${view}`;
}

export const bdpTopViewTitle = (options) => bdpViewTitle("Roll-in", "Top View", options);
export const bdpProfileTitle = (options) => bdpViewTitle("Dive", "Profile", options);
export const bdpZDiagramTitle = (options) => bdpViewTitle("Dive", "Z-Diagram", options);
