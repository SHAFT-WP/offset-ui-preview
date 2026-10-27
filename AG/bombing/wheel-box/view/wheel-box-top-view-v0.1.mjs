import {
  appendAlignedDimension,
  appendDirectedLine,
  applyTextHalo,
  clamp,
  createOpenArrowMarker,
  scopeSvgMarkerIds,
  SVG_DIAGRAM_COLORS_V0_1,
  SVG_DIAGRAM_STYLE_V0_1,
  svgNode,
} from "../../../../common/diagram/svg-primitives-v0.1.mjs?v=0.1.6";
import { createSmartLabelLayout } from "../../../../common/diagram/svg-smart-label-v0.1.mjs?v=0.1.5";
import { createSvgAutoCanvas } from "../../../../common/diagram/svg-viewport-v0.1.mjs?v=0.1.5";
import { formatDeg, formatG, formatKt, formatNm, formatSec } from "../../../../common/ui/display-precision-v0.1.mjs";
import { WHEEL_TOP_VIEW_ADVANCED_LEGEND, WHEEL_TOP_VIEW_LEGEND, WHEEL_VIEW_COLORS as C, wheelTopViewTitle } from "./wheel-view-style-v0.1.mjs";
import { formatWheelRadiusNm } from "../../wheel-attack/wheel-box-geometry-v0.6.mjs";

// Wheel-BOX #n Top View — Wheel-owned view in the V2 unified view grammar (common/diagram/SPEC.md; Wheel SPEC
// "Wheel-BOX v0.8 views"), drawn on the BOX Top View's layout (box-top-view-v0.5) for the Wheel-BOX v0.8 / v0.9 route
// (wheel-box-geometry-v0.6 / v0.7, BE); this module only projects it:
//   Wheel (Target-centred circle; the quarter flown to Abeam drawn solid) → Abeam → Abeam Extension (Downwind heading)
//   → Base Turn → Base Leg → Roll-in → Tracking, with the Target abeam line, the Roll-in Point → Target line and the
//   Roll-in label `Roll-in Range NM/Roll-in Lead Angle °` (as BOX).
// - Attack Heading up. RIGHT: the Wheel side is right of the attack run; LEFT mirrors it.
// - Advanced: the MAP circle and the Roll-in Distance (as BOX), the Min Wheel Radius circle when the Wheel is larger,
//   and the Orbit circle when an Orbit is given (a waiting circle, never part of the route).
// - Formation (options.formation): each aircraft at its BE place, a triangle on its heading.
// - 0.1.1 (Wheel-BOX v0.9): a Base Turn G the BE raised to fit Base Distance reads `requested → flown G` (no radius).
// - 0.2.0 (Wheel-BOX v0.10): the SEM from Release and the Return to Abeam (geometry v0.8), both in the fit; with a
//   Return the Wheel circle is a reference (thin) and its quarter is not drawn as flown. Return label: the turn's G
//   (Return Turn G → Join G), time, distance, the Extension when flown. OA2, the Base Turn start (the Abeam Extension is
//   flown to it), with its range / angle as the Roll-in's: `OA2 Range NM/OA2 angle °` (the angle off the reciprocal of
//   the Attack Heading, as the Roll-in Lead Angle).
//   The SEM and the Return are Advanced (owner 2026-10-27: "advanced tab을 눌렀을 때 보이게 하자. 그전에는 그냥 제일 처음
//   그렸었던 sem을 반영하지 않은 그래프로"): Advanced off is the first Wheel drawing (the Wheel quarter flown to Abeam,
//   no SEM, no Return, the fit without them); Advanced on adds them, in the fit. OA2 is drawn in both.
// - Self-contained: fills an empty <svg>; every stroke, fill and text halo is an attribute.
export const WHEEL_BOX_TOP_VIEW_V0_1 = Object.freeze({
  id: "wheel-box-top-view-v0.1",
  version: "0.2.0",
  owner: "AG/bombing/wheel-attack/SPEC.md",
  subject: "Wheel-BOX",
  view: "Top View",
  orientation: "ATTACK_HEADING_UP",
  canvas: Object.freeze({ width: 900, minHeight: 620, maxHeight: 1300 }),
  legend: WHEEL_TOP_VIEW_LEGEND,
  advancedLegend: WHEEL_TOP_VIEW_ADVANCED_LEGEND,
});

// The page shows radii as the views do (the Wheel Radius field's step, rounded up).
export { formatWheelRadiusNm as wheelRadiusText, wheelTopViewTitle };

const WIDTH = WHEEL_BOX_TOP_VIEW_V0_1.canvas.width;
const MIN_SEGMENT_NM = 1 / 1852;

const unit = (from, to) => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function lineCandidates(from, to, side = 1, distances = [16, 44, 80, -16, -44]) {
  const d = unit(from, to);
  const n = { x: -d.y * side, y: d.x * side };
  const anchorFor = (dx) => (dx > 6 ? "start" : dx < -6 ? "end" : "middle");
  return distances.map((distance) => ({ dx: n.x * distance, dy: n.y * distance + 5, anchor: anchorFor(n.x * distance) }));
}

function arcCandidates(center, middle) {
  const out = unit(center, middle);
  const anchor = out.x > 0.3 ? "start" : out.x < -0.3 ? "end" : "middle";
  return [18, 46, 84].map((distance) => ({ dx: out.x * distance, dy: out.y * distance + 5, anchor }));
}

// Station label candidates; `mirror` swaps left / right (LEFT pattern).
const stationCandidates = (preferred, mirror = false) => {
  const all = {
    left: { dx: -14, dy: 4, anchor: "end" },
    right: { dx: 14, dy: 4, anchor: "start" },
    above: { dx: 0, dy: -16, anchor: "middle" },
    below: { dx: 0, dy: 26, anchor: "middle" },
    upLeft: { dx: -16, dy: -14, anchor: "end" },
    upRight: { dx: 16, dy: -14, anchor: "start" },
    downLeft: { dx: -16, dy: 22, anchor: "end" },
    downRight: { dx: 16, dy: 22, anchor: "start" },
  };
  const swap = { left: "right", right: "left", upLeft: "upRight", upRight: "upLeft", downLeft: "downRight", downRight: "downLeft" };
  const keys = preferred.map((key) => (mirror ? swap[key] ?? key : key));
  return [...keys, ...Object.keys(all).filter((key) => !keys.includes(key))].map((key) => all[key]);
};

export function renderWheelBoxTopView(svg, wheelResult, options = {}) {
  if (!(svg instanceof SVGElement)) throw new TypeError("svg must be an SVGElement");
  const geometry = wheelResult?.geometry;
  if (!geometry?.stations?.abeam || !geometry?.paths?.wheel || !geometry?.validation || !wheelResult?.turns?.base) {
    throw new TypeError("wheelResult must be a Wheel-BOX v0.8 – v0.10 result with its route geometry");
  }
  const sign = wheelResult.direction === "LEFT" ? -1 : 1;
  // Attack frame → drawing frame: x = toward the Wheel side (mirrored for LEFT), y = along the Attack Heading (up).
  const w = (point) => ({ x: sign * point.sideNm, y: point.alongNm });
  const pattern = wheelResult.pattern;
  const wheel = wheelResult.wheel;
  const base = wheelResult.turns.base;
  const v = geometry.values;
  const textScale = clamp(Number(options.textScale) || 1, 0.5, 2);
  const advanced = options.advanced === true;
  const s = geometry.stations;
  // v0.10: the SEM and the Return (null when absent), drawn in Advanced only.
  const ret = wheelResult.return;
  const hasReturn = advanced && Array.isArray(geometry.paths.return) && geometry.paths.return.length > 1;
  const hasSem = advanced && Array.isArray(geometry.paths.sem) && geometry.paths.sem.length > 1;
  const RETURN_STATIONS = ["csemEnd", "returnTurnStart", "returnLevel", "returnJoin"];
  const fitStations = Object.entries(s).filter(([key]) => hasReturn || !RETURN_STATIONS.includes(key)).map(([, value]) => value);
  const pathKeys = ["wheel", "wheelArc", "baseTurn", "rollIn", ...(hasSem ? ["sem"] : []), ...(hasReturn ? ["return"] : [])];
  const W = Object.fromEntries(Object.entries(s).map(([key, value]) => [key, w(value)]));
  pathKeys.forEach((key) => { W[key] = geometry.paths[key].map(w); });
  const extentNm = Math.max(v.wheelRadiusNm, 1);
  W.abeamLineFrom = w({ alongNm: 0, sideNm: -1.25 * extentNm });
  W.abeamLineTo = w({ alongNm: 0, sideNm: 1.25 * extentNm });
  const errorLines = geometry.validation.valid ? [] : ["GEOMETRY ERROR", ...geometry.validation.errors];
  const headerSize = 15 * textScale;
  const errorSize = 12 * textScale;
  const headerBlockHeight = 22 + headerSize + errorLines.length * errorSize * 1.45;

  const formation = Array.isArray(options.formation) ? options.formation.filter((item) => Number.isFinite(item?.alongNm) && Number.isFinite(item?.sideNm)) : [];
  const fitPoints = [W.abeamLineFrom, W.abeamLineTo, ...fitStations.map(w), ...pathKeys.flatMap((key) => W[key]), ...formation.map(w)];
  const fit = createSvgAutoCanvas(fitPoints, {
    width: WIDTH,
    minHeight: WHEEL_BOX_TOP_VIEW_V0_1.canvas.minHeight,
    maxHeight: WHEEL_BOX_TOP_VIEW_V0_1.canvas.maxHeight,
    margins: { top: Math.max(86, headerBlockHeight + 40), bottom: 76, left: 190, right: 190 },
    minSpan: 0.3,
    flipY: true,
  });
  const HEIGHT = fit.height;
  const P = Object.fromEntries(Object.entries(W).map(([key, value]) => [key, Array.isArray(value) ? value.map(fit.project) : fit.project(value)]));
  const shown = (nm) => Math.abs(nm) > MIN_SEGMENT_NM;
  const labelled = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) >= 10;
  const pxPerNm = Math.hypot(fit.project({ x: 1, y: 0 }).x - fit.project({ x: 0, y: 0 }).x, fit.project({ x: 1, y: 0 }).y - fit.project({ x: 0, y: 0 }).y);

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.dataset.canvasHeight = String(HEIGHT);
  svg.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  const title = wheelTopViewTitle({ aircraftNumber: options.aircraftNumber });
  svg.setAttribute("aria-label", title);
  const defs = svgNode("defs");
  [["wheel", C.wheel], ["track", C.attack], ["abeam", C.abeam], ["base", C.baseLeg], ["roll", C.roll], ["ref", C.reference], ["red", C.rollInTarget], ["sem", C.sem]]
    .forEach(([name, color]) => defs.append(createOpenArrowMarker(`wheel-top-${name}`, color)));
  defs.append(createOpenArrowMarker("wheel-top-leader", SVG_DIAGRAM_COLORS_V0_1.helper, SVG_DIAGRAM_STYLE_V0_1.arrow.leader));
  const root = svgNode("g", { "data-view": WHEEL_BOX_TOP_VIEW_V0_1.id });
  svg.append(defs, root);
  root.append(svgNode("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: SVG_DIAGRAM_COLORS_V0_1.background }));

  const polyline = (points) => points.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const path = (points, color, { markerId, role, width = 3.5, dasharray, opacity } = {}) => root.append(svgNode("path", {
    d: polyline(points), fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round",
    "stroke-dasharray": dasharray, opacity, "marker-end": markerId ? `url(#${markerId})` : undefined, "data-top-view-role": role,
  }));
  const circle = (radiusNm, color, role, dasharray, width = 1.6) => root.append(svgNode("circle", {
    cx: P.target.x, cy: P.target.y, r: radiusNm * pxPerNm, fill: "none", stroke: color, "stroke-width": width, "stroke-dasharray": dasharray, "data-top-view-role": role,
  }));

  // Target abeam line (dashed guide, as BOX).
  root.append(svgNode("line", {
    x1: P.abeamLineFrom.x, y1: P.abeamLineFrom.y, x2: P.abeamLineTo.x, y2: P.abeamLineTo.y,
    stroke: C.wheel, "stroke-width": 1.3, "stroke-dasharray": "7 6", opacity: 0.6, "data-top-view-role": "abeam-line",
  }));

  // Advanced reference circles (never in the fit, so Advanced never resizes the canvas).
  const mapNm = wheelResult.bombDelivery.public.groundRangeNm;
  const showMap = advanced && Number.isFinite(mapNm) && mapNm > 0;
  if (showMap) circle(mapNm, C.attack, "map-circle", "9 7", 1.8);
  const showMinWheel = advanced && wheel.minWheelRadiusNm < v.wheelRadiusNm - MIN_SEGMENT_NM;
  if (showMinWheel) circle(wheel.minWheelRadiusNm, C.guide, "min-wheel-circle", "4 5", 1.4);
  const orbit = wheelResult.orbit;
  const showOrbit = advanced && orbit && Number.isFinite(orbit.orbitRadiusNm);
  if (showOrbit) circle(orbit.orbitRadiusNm, C.orbit, "orbit-circle", "12 6 2 6", 1.6);

  // The Wheel: the whole circle thin; without a Return, the quarter flown to Abeam solid; with one, the SEM and the
  // Return to Abeam instead.
  path(P.wheel, C.wheel, { role: "wheel", width: 1.6, opacity: 0.55 });
  if (!hasReturn) path(P.wheelArc, C.wheel, { markerId: "wheel-top-wheel", role: "wheel-arc", width: 3.5 });
  if (hasSem) path(P.sem, C.sem, { markerId: hasReturn ? undefined : "wheel-top-sem", role: "sem", width: 2.6 });
  if (hasReturn) path(P.return, C.wheel, { markerId: "wheel-top-wheel", role: "return", width: 3.5 });
  // The route in flight order.
  appendDirectedLine(root, P.trackPoint, P.release, { color: C.attack, width: 3.6, markerEndId: "wheel-top-track", fromGap: 7, toGap: 6 });
  if (shown(v.abeamExtensionDistanceNm)) appendDirectedLine(root, P.abeam, P.baseTurnStart, { color: C.abeam, width: 3.5, markerEndId: "wheel-top-abeam", fromGap: 7, toGap: 3 });
  path(P.baseTurn, C.abeam, { markerId: "wheel-top-abeam", role: "base-turn" });
  if (shown(v.baseLegNm)) appendDirectedLine(root, P.baseTurnEnd, P.oa1, { color: C.baseLeg, width: 3.5, markerEndId: "wheel-top-base", toGap: 10 });
  path(P.rollIn, C.roll, { markerId: "wheel-top-roll", role: "roll-in", width: 4.5 });
  appendDirectedLine(root, P.oa1, P.target, { color: C.rollInTarget, width: 2.4, markerEndId: "wheel-top-red", fromGap: 9, toGap: 8 });

  // Advanced: the Roll-in Distance (= Base Distance, square to the Initial heading) beside the Target on the side away
  // from the Wheel, as BOX; far enough out that the Track Point label keeps its place beside the Tracking line.
  let distanceDimension = null;
  if (advanced && Number.isFinite(v.baseDistanceNm)) {
    const level = { x: P.target.x, y: P.oa1.y };
    root.append(svgNode("line", { x1: P.oa1.x, y1: P.oa1.y, x2: level.x, y2: level.y, stroke: C.reference, "stroke-width": 1, "stroke-dasharray": "4 4", opacity: 0.8 }));
    distanceDimension = appendAlignedDimension(root, {
      from: level, to: P.target, offset: -140 * sign, color: C.reference, markerId: "wheel-top-ref",
      title: "Roll-in Distance", detail: `${formatNm(v.baseDistanceNm)} NM`,
      titleSize: SVG_DIAGRAM_STYLE_V0_1.font.dimensionTitlePx * textScale, detailSize: SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale,
    });
  }

  // Stations.
  const dot = (point, color, key, radius = 5.5, fill = "#ffffff") => root.append(svgNode("circle", {
    cx: point.x, cy: point.y, r: radius, fill, stroke: color, "stroke-width": 2.5, "data-wheel-station": key,
  }));
  dot(P.abeam, C.wheel, "abeam", 5.5, C.wheel);
  dot(P.oa1, C.roll, "oa1", 7);
  dot(P.trackPoint, C.attack, "track-point", 4.5);
  dot(P.release, C.attack, "release", 3.5);
  if (hasReturn) dot(P.csemEnd, C.sem, "csem-end", 4);
  const hasOa2 = Number.isFinite(v.oa2RangeNm) && Number.isFinite(v.oa2AngleDeg);
  if (hasOa2) dot(P.baseTurnStart, C.abeam, "oa2", 5);
  root.append(svgNode("circle", { cx: P.target.x, cy: P.target.y, r: 6, fill: C.target, stroke: "#ffffff", "stroke-width": 2, "data-wheel-station": "target" }));
  root.append(svgNode("line", { x1: P.target.x - 10, y1: P.target.y, x2: P.target.x + 10, y2: P.target.y, stroke: C.target, "stroke-width": 2 }));
  root.append(svgNode("line", { x1: P.target.x, y1: P.target.y - 10, x2: P.target.x, y2: P.target.y + 10, stroke: C.target, "stroke-width": 2 }));

  // Formation: an aircraft symbol (a triangle on its heading) per aircraft, in its colour.
  const aircraftPoints = formation.map((item) => {
    const at = fit.project(w(item));
    const relative = ((item.headingDeg - wheelResult.attackHeadingDeg) * Math.PI) / 180;
    // The heading in the drawing: up = along the Attack Heading, +x = right of it (for RIGHT and LEFT alike).
    const ahead = fit.project({ x: sign * item.sideNm + 0.1 * Math.sin(relative), y: item.alongNm + 0.1 * Math.cos(relative) });
    const length = Math.hypot(ahead.x - at.x, ahead.y - at.y) || 1;
    const u = { x: (ahead.x - at.x) / length, y: (ahead.y - at.y) / length };
    const n = { x: -u.y, y: u.x };
    const size = 11;
    const tip = { x: at.x + u.x * size, y: at.y + u.y * size };
    const left = { x: at.x - u.x * size * 0.7 + n.x * size * 0.75, y: at.y - u.y * size * 0.7 + n.y * size * 0.75 };
    const right = { x: at.x - u.x * size * 0.7 - n.x * size * 0.75, y: at.y - u.y * size * 0.7 - n.y * size * 0.75 };
    root.append(svgNode("path", {
      d: `M${tip.x.toFixed(1)},${tip.y.toFixed(1)} L${left.x.toFixed(1)},${left.y.toFixed(1)} L${right.x.toFixed(1)},${right.y.toFixed(1)} Z`,
      fill: item.color ?? C.reference, stroke: "#ffffff", "stroke-width": 1.5, "data-wheel-aircraft": String(item.number),
    }));
    return { item, at };
  });

  // In-plot header and GEOMETRY ERROR lines (as BOX).
  root.append(svgNode("text", {
    x: 22, y: 22 + headerSize, fill: C.reference, "font-size": headerSize, "font-weight": 850, "data-top-view-role": "header",
  }, `Angle-Off ${formatDeg(wheelResult.fixedAngleOffDeg)}° · ${wheelResult.direction}`));
  errorLines.forEach((line, index) => root.append(svgNode("text", {
    x: 22, y: 22 + headerSize + (index + 1) * errorSize * 1.45, fill: C.invalid, "font-size": errorSize, "font-weight": index ? 700 : 900,
    "data-top-view-role": "geometry-error",
  }, line)));

  // Labels: on their element, or joined to it by a leader (Common smart labels).
  const labels = createSmartLabelLayout(root, { width: WIDTH, height: HEIGHT, labelPad: 8, pathPad: 6, charWidthEm: 0.7 });
  [P.abeam, P.oa1, P.trackPoint, P.target].forEach((point) => labels.reservePoint(point, 11));
  aircraftPoints.forEach(({ at }) => labels.reservePoint(at, 12));
  labels.reservePoint(P.release, 7);
  if (hasReturn) labels.reservePoint(P.csemEnd, 7);
  if (hasOa2) labels.reservePoint(P.baseTurnStart, 9);
  const headerWidth = Math.max(240 * textScale, ...errorLines.map((line) => line.length * errorSize * 0.62));
  labels.reserveRect({ x: 16, y: 16, w: headerWidth, h: headerBlockHeight - 8 });
  const reserve = (points, pad = 6) => { for (let i = 1; i < points.length; i += 1) labels.reserveSegment(points[i - 1], points[i], pad); };
  reserve([P.trackPoint, P.release]);
  reserve(P.wheel, 3);
  if (!hasReturn) reserve(P.wheelArc);
  if (hasSem) reserve(P.sem, 4);
  if (hasReturn) reserve(P.return);
  reserve([P.abeam, P.baseTurnStart]);
  reserve(P.baseTurn);
  reserve([P.baseTurnEnd, P.oa1]);
  reserve(P.rollIn);
  reserve([P.abeamLineFrom, P.abeamLineTo], 3);
  reserve([P.oa1, P.target], 4);
  if (distanceDimension) {
    reserve([distanceDimension.a, distanceDimension.b], 4);
    reserve([P.oa1, { x: P.target.x, y: P.oa1.y }], 3);
    const labelLeft = sign > 0 ? distanceDimension.label.x - 150 * textScale : distanceDimension.label.x;
    labels.reserveRect({ x: labelLeft, y: distanceDimension.label.y - 18 * textScale, w: 150 * textScale, h: 36 * textScale });
  }
  const titleSize = SVG_DIAGRAM_STYLE_V0_1.font.lineTitlePx * textScale;
  const detailSize = SVG_DIAGRAM_STYLE_V0_1.font.detailPx * textScale;
  const stationSize = 12 * textScale;
  const mirror = sign < 0;
  const label = (point, text, labelOptions) => labels.append(point, text, {
    background: false,
    movable: options.movableLabels === true,
    fontSize: titleSize,
    detailFontSize: detailSize,
    leaderMarkerId: "wheel-top-leader",
    ...labelOptions,
  });
  const kcas = `${formatKt(v.patternSpeedKcas)} KCAS`;

  label(P.target, "Target", { labelKey: "target", color: C.target, fontSize: stationSize, candidates: stationCandidates(["downLeft", "left", "upLeft"], mirror) });
  label(P.release, "Bombs Away", { labelKey: "bombs-away", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "downLeft", "upLeft", "right"], mirror) });
  label(P.trackPoint, "Track Point", { labelKey: "track-point", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["left", "upLeft", "downLeft"], mirror) });
  const pub = wheelResult.bombDelivery.public;
  const rollInNote = Number.isFinite(pub.rollInRangeNm) && Number.isFinite(pub.leadAngleDeg) ? `${formatNm(pub.rollInRangeNm)}NM/${formatDeg(pub.leadAngleDeg)}°` : undefined;
  label(P.oa1, "Roll-in", { labelKey: "roll-in", color: C.rollText, fontSize: stationSize, detail: rollInNote, detailFontSize: stationSize, candidates: stationCandidates(["below", "downRight", "downLeft"], mirror) });
  if (hasReturn) label(P.csemEnd, "CSEM End", { labelKey: "csem-end", color: C.semText, fontSize: stationSize, candidates: stationCandidates(["left", "upLeft", "downLeft"], mirror) });
  label(P.abeam, "Abeam", { labelKey: "abeam", color: C.wheelText, fontSize: stationSize, candidates: stationCandidates(["upRight", "right", "downRight"], mirror) });
  if (hasOa2) label(P.baseTurnStart, "OA2", {
    labelKey: "oa2", color: C.abeamText, fontSize: stationSize, detail: `${formatNm(v.oa2RangeNm)}NM/${formatDeg(v.oa2AngleDeg)}°`, detailFontSize: stationSize,
    candidates: stationCandidates(["right", "downRight", "upRight", "left"], mirror),
  });
  // The Wheel: its radius, bank and 180° time on the flown quarter.
  const arcMiddle = P.wheelArc[Math.floor(P.wheelArc.length / 2)];
  label(arcMiddle, "Wheel", {
    labelKey: "wheel", color: C.wheelText,
    detail: `R ${formatWheelRadiusNm(v.wheelRadiusNm)} NM · ${formatKt(wheel.wheelSpeedKcas)} KCAS · ${formatDeg(wheel.wheelBankAngleDeg)}° · 180° ${formatSec(wheel.wheelTurn180TimeSec)} s`,
    candidates: arcCandidates(P.target, arcMiddle),
  });
  if (showMap) {
    const spot = { x: P.target.x - sign * pxPerNm * mapNm * 0.71, y: P.target.y - pxPerNm * mapNm * 0.71 };
    label(spot, `MAP: ${formatNm(mapNm)} NM`, { labelKey: "map", color: C.attackText, fontSize: stationSize, candidates: stationCandidates(["upLeft", "left", "upRight"], mirror) });
  }
  if (showOrbit) {
    const spot = { x: P.target.x - sign * pxPerNm * orbit.orbitRadiusNm * 0.71, y: P.target.y + pxPerNm * orbit.orbitRadiusNm * 0.71 };
    label(spot, "Orbit", { labelKey: "orbit", color: C.orbit, detail: `R ${formatNm(orbit.orbitRadiusNm)} NM · ${formatKt(orbit.orbitSpeedKcas)} KCAS · ${formatDeg(orbit.orbitBankAngleDeg)}°`, candidates: stationCandidates(["downLeft", "left", "downRight"], mirror) });
  }
  if (showMinWheel) {
    // On the far side from the pattern, ahead of the abeam line (the attack and the Roll-in are behind the Target).
    const spot = { x: P.target.x - sign * pxPerNm * wheel.minWheelRadiusNm * 0.87, y: P.target.y - pxPerNm * wheel.minWheelRadiusNm * 0.5 };
    label(spot, "Min Wheel", { labelKey: "min-wheel", color: C.reference, fontSize: stationSize, detail: `${formatWheelRadiusNm(wheel.minWheelRadiusNm)} NM`, detailFontSize: stationSize, candidates: stationCandidates(["left", "upLeft", "downLeft"], mirror) });
  }
  if (hasReturn) {
    // On the Return's farthest point ahead: the turn's G (90° bank → level Join G), time, distance and any Extension.
    const farthest = P.return.reduce((best, point) => (point.y < best.y ? point : best), P.return[0]);
    const extension = ret.extensionNm > 0 ? ` · Ext ${formatNm(ret.extensionNm)} NM` : "";
    label(farthest, "Return", {
      labelKey: "return", color: C.wheelText,
      detail: `${formatG(ret.inputs.turnG)} → ${formatG(ret.joinLoadFactorG)} G · ${formatSec(ret.timeSec)} s · ${formatNm(ret.distanceNm)} NM${extension}`,
      candidates: stationCandidates(["above", "upRight", "upLeft"], mirror),
    });
  }
  if (shown(v.abeamExtensionDistanceNm) && labelled(P.abeam, P.baseTurnStart)) label(mid(P.abeam, P.baseTurnStart), "Abeam Extension", {
    labelKey: "abeam-extension", color: C.abeamText,
    detail: `${formatNm(v.abeamExtensionDistanceNm)} NM · ${kcas} · ${formatSec(v.abeamExtensionTimeSec)} s${pattern.downwindAngleDeg ? ` · Downwind ${formatDeg(pattern.downwindAngleDeg)}°` : ""}`,
    // Outside the Wheel first, then inside; each also lower along the leg, clear of the abeam line it starts on.
    candidates: [0, 18, 36].flatMap((shift) => lineCandidates(P.abeam, P.baseTurnStart, -sign, [16, 44, 80, -16, -44, -80]).map((candidate) => ({ ...candidate, dy: candidate.dy + shift }))),
  });
  const baseMiddle = P.baseTurn[Math.floor(P.baseTurn.length / 2)];
  // Label direction: out from the turn's inside corner (BOX's (start along, end side)).
  const baseInside = fit.project(w({ alongNm: s.baseTurnStart.alongNm, sideNm: s.baseTurnEnd.sideNm }));
  label(baseMiddle, "Base Turn", {
    labelKey: "base-turn", color: C.abeamText,
    // A raised G reads `requested → flown` in place of the turn radius (the label keeps its length; the Result has both).
    detail: base.autoRaised
      ? `${kcas} · ${formatG(base.requestedLoadFactorG)} → ${formatG(base.loadFactorG)} G · ${formatDeg(base.bankAngleDeg)}°`
      : `${kcas} · ${formatG(base.loadFactorG)} G · ${formatDeg(base.bankAngleDeg)}° · R ${formatNm(base.instantaneous.radiusNm)} NM`,
    candidates: arcCandidates(baseInside, baseMiddle),
  });
  if (shown(v.baseLegNm) && labelled(P.baseTurnEnd, P.oa1)) label(mid(P.baseTurnEnd, P.oa1), "Base Leg", {
    labelKey: "base-leg", color: C.baseLegText, detail: `${formatNm(v.baseLegNm)} NM · ${formatSec(v.baseLegTimeSec)} s`,
    candidates: lineCandidates(P.baseTurnEnd, P.oa1, -sign),
  });

  aircraftPoints.forEach(({ item, at }) => label(at, `#${item.number}`, {
    labelKey: `aircraft-${item.number}`, color: item.color ?? C.reference, fontSize: stationSize * 1.15,
    candidates: stationCandidates(["right", "left", "upRight", "downRight"], mirror),
  }));

  applyTextHalo(root);
  scopeSvgMarkerIds(svg, options.scope ?? "wheel-top");
  return {
    title,
    orientation: WHEEL_BOX_TOP_VIEW_V0_1.orientation,
    canvas: { width: WIDTH, height: HEIGHT },
    geometry,
    screen: Object.fromEntries(Object.keys(s).map((key) => [key, P[key]])),
  };
}
